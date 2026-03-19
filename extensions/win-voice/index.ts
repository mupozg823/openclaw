import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── PowerShell ───────────────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 30_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── TTS ─────────────────────────────────────────────────────

interface VoiceInfo {
  name: string;
  culture: string;
  gender: string;
}

async function getInstalledVoices(): Promise<VoiceInfo[]> {
  try {
    const raw = await runPs(`
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.GetInstalledVoices() | ForEach-Object {
  "$($_.VoiceInfo.Name)|$($_.VoiceInfo.Culture)|$($_.VoiceInfo.Gender)"
}
$synth.Dispose()
`.trim());
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, culture, gender] = line.split("|");
        return { name: name ?? "", culture: culture ?? "", gender: gender ?? "" };
      });
  } catch {
    return [];
  }
}

async function speak(text: string, voiceName?: string, rate = 0): Promise<boolean> {
  const escaped = text.replace(/'/g, "''").replace(/\n/g, " ");
  const voiceSelect = voiceName
    ? `$synth.SelectVoice('${voiceName.replace(/'/g, "''")}')`
    : "";
  const clampedRate = Math.max(-10, Math.min(10, rate));
  try {
    await runPs(`
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voiceSelect}
$synth.Rate = ${clampedRate}
$synth.Speak('${escaped}')
$synth.Dispose()
`.trim());
    return true;
  } catch {
    return false;
  }
}

async function speakToFile(
  text: string,
  voiceName?: string,
): Promise<{ ok: boolean; path: string; message: string }> {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const dir = path.join(home, "Documents", "OpenClaw", "voice");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filepath = path.join(dir, `tts-${timestamp}.wav`);
  const escaped = text.replace(/'/g, "''").replace(/\n/g, " ");
  const voiceSelect = voiceName
    ? `$synth.SelectVoice('${voiceName.replace(/'/g, "''")}')`
    : "";
  try {
    await runPs(`
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Path '${dir.replace(/'/g, "''")}' -Force | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voiceSelect}
$synth.SetOutputToWaveFile('${filepath.replace(/'/g, "''")}')
$synth.Speak('${escaped}')
$synth.Dispose()
`.trim());
    return { ok: true, path: filepath, message: `Audio saved: ${filepath}` };
  } catch (e) {
    return { ok: false, path: "", message: `TTS file save failed: ${e}` };
  }
}

// ── STT ─────────────────────────────────────────────────────

async function listenOnce(timeoutSec = 10): Promise<{ ok: boolean; text: string; confidence: number }> {
  try {
    const raw = await runPs(`
Add-Type -AssemblyName System.Speech
$stt = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$stt.SetInputToDefaultAudioDevice()
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$stt.LoadGrammar($grammar)
$stt.InitialSilenceTimeout = [TimeSpan]::FromSeconds(${timeoutSec})
$stt.EndSilenceTimeout = [TimeSpan]::FromSeconds(2)
try {
  $result = $stt.Recognize()
  if ($result -ne $null) {
    "$($result.Text)|$($result.Confidence)"
  } else {
    "NO_SPEECH|0"
  }
} finally {
  $stt.Dispose()
}
`.trim());
    const [text, conf] = raw.split("|");
    if (!text || text === "NO_SPEECH") {
      return { ok: false, text: "", confidence: 0 };
    }
    return { ok: true, text, confidence: Number(conf) || 0 };
  } catch (e) {
    return { ok: false, text: `Recognition error: ${e}`, confidence: 0 };
  }
}

// ── WAV Recording ───────────────────────────────────────────

async function recordAudio(durationSec = 5): Promise<{ ok: boolean; path: string; message: string }> {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const dir = path.join(home, "Documents", "OpenClaw", "voice");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filepath = path.join(dir, `recording-${timestamp}.wav`);
  const escapedDir = dir.replace(/'/g, "''");
  const escapedPath = filepath.replace(/'/g, "''");
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Path '${escapedDir}' -Force | Out-Null
$stt = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$stt.SetInputToDefaultAudioDevice()
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$stt.LoadGrammar($grammar)
$stt.InitialSilenceTimeout = [TimeSpan]::FromSeconds(${durationSec})
$stt.EndSilenceTimeout = [TimeSpan]::FromSeconds(${durationSec})
$result = $stt.Recognize()
$stt.Dispose()
if ($result -ne $null) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SetOutputToWaveFile('${escapedPath}')
  $synth.Speak($result.Text)
  $synth.Dispose()
  Write-Host "OK"
} else {
  Write-Host "NO_AUDIO"
}
`.trim(),
      ],
      { shell: false, timeout: (durationSec + 15) * 1000 },
    );
    return { ok: true, path: filepath, message: `Recording saved: ${filepath}` };
  } catch (e) {
    return { ok: false, path: "", message: `Recording failed: ${e}` };
  }
}

// ── Formatting ──────────────────────────────────────────────

function formatVoiceList(voices: VoiceInfo[]): string {
  if (voices.length === 0) return "No TTS voices installed.";
  const lines = voices.map(
    (v, i) => `  ${i + 1}. ${v.name} (${v.culture}, ${v.gender})`,
  );
  return `Installed voices (${voices.length}):\n${lines.join("\n")}`;
}

function formatHelp(): string {
  return [
    "Voice I/O commands:",
    "",
    "/voice — Show available voices",
    "/voice say <text> — Speak text aloud (TTS)",
    "/voice listen — Listen for speech (STT, 10s timeout)",
    "/voice listen <seconds> — Listen with custom timeout",
    "/voice save <text> — Save speech to WAV file",
    "/voice voices — List installed TTS voices",
    '/voice use <voice-name> — Set default voice (e.g., "Microsoft Zira Desktop")',
    "/voice rate <-10..10> — Set speech rate (0=normal)",
  ].join("\n");
}

// ── State Persistence ────────────────────────────────────────

interface VoiceConfig {
  defaultVoice?: string;
  speechRate: number;
}

function loadState<T>(filepath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveState<T>(filepath: string, data: T): void {
  try {
    const dir = path.dirname(filepath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // silent fail
  }
}

// ── Plugin Entry ────────────────────────────────────────────

let defaultVoice: string | undefined;
let speechRate = 0;

export default definePluginEntry({
  id: "win-voice",
  name: "Windows Voice I/O",
  description: "Speech-to-text and text-to-speech using Windows System.Speech",
  register(api: OpenClawPluginApi) {
    const stateDir = api.runtime.state.resolveStateDir();
    const configFile = path.join(stateDir, "win-voice-config.json");

    // Restore saved voice settings from disk
    const savedConfig = loadState<VoiceConfig>(configFile, { speechRate: 0 });
    defaultVoice = savedConfig.defaultVoice;
    speechRate = savedConfig.speechRate;

    api.registerCommand({
      name: "voice",
      description: "Voice I/O — speak text (TTS) and listen for speech (STT).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        if (action === "help") return { text: formatHelp() };

        // /voice voices
        if (action === "voices" || action === "list") {
          const voices = await getInstalledVoices();
          return { text: formatVoiceList(voices) };
        }

        // /voice say <text>
        if (action === "say" || action === "speak") {
          const text = tokens.slice(1).join(" ");
          if (!text) return { text: "Usage: /voice say <text to speak>" };
          const ok = await speak(text, defaultVoice, speechRate);
          return {
            text: ok
              ? `Speaking: "${text.length > 80 ? `${text.slice(0, 77)}...` : text}"`
              : "TTS failed. Check audio output device.",
          };
        }

        // /voice save <text>
        if (action === "save" || action === "export") {
          const text = tokens.slice(1).join(" ");
          if (!text) return { text: "Usage: /voice save <text to save as WAV>" };
          const result = await speakToFile(text, defaultVoice);
          return { text: result.message };
        }

        // /voice listen [seconds]
        if (action === "listen" || action === "stt" || action === "hear") {
          const timeout = Number(tokens[1]) || 10;
          const clamped = Math.max(3, Math.min(30, timeout));
          const result = await listenOnce(clamped);
          if (!result.ok) {
            return { text: "No speech detected. Ensure microphone is connected and try again." };
          }
          return {
            text: `Recognized (${Math.round(result.confidence * 100)}% confidence):\n\n${result.text}`,
          };
        }

        // /voice use <voice-name>
        if (action === "use" || action === "voice") {
          const name = tokens.slice(1).join(" ");
          if (!name) {
            const voices = await getInstalledVoices();
            return { text: `Usage: /voice use <voice-name>\n\n${formatVoiceList(voices)}` };
          }
          const voices = await getInstalledVoices();
          const match = voices.find(
            (v) => v.name.toLowerCase() === name.toLowerCase(),
          );
          if (!match) {
            return {
              text: `Voice "${name}" not found.\n\n${formatVoiceList(voices)}`,
            };
          }
          defaultVoice = match.name;
          saveState(configFile, { defaultVoice, speechRate });
          return { text: `Default voice set to: ${match.name}` };
        }

        // /voice rate <-10..10>
        if (action === "rate" || action === "speed") {
          const rate = Number(tokens[1]);
          if (Number.isNaN(rate) || rate < -10 || rate > 10) {
            return { text: `Usage: /voice rate <-10..10> (current: ${speechRate})` };
          }
          speechRate = Math.round(rate);
          saveState(configFile, { defaultVoice, speechRate });
          return { text: `Speech rate set to ${speechRate} (0=normal, negative=slower, positive=faster)` };
        }

        // Default: show voices + current settings
        const voices = await getInstalledVoices();
        const lines = [
          `Default voice: ${defaultVoice ?? "(system default)"}`,
          `Speech rate: ${speechRate}`,
          "",
          formatVoiceList(voices),
          "",
          'Type "/voice help" for all commands.',
        ];
        return { text: lines.join("\n") };
      },
    });
  },
});

export { formatHelp, formatVoiceList };
export type { VoiceInfo };
