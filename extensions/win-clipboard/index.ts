import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { definePluginEntry } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

const execFileAsync = promisify(execFile);

// ── PowerShell ───────────────────────────────────────────────

const PS_OPTS = { shell: false, timeout: 15_000 } as const;

async function runPs(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    PS_OPTS,
  );
  return stdout.trim();
}

// ── Clipboard Read ───────────────────────────────────────────

async function readClipboardText(): Promise<string | null> {
  try {
    const text = await runPs(
      `Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()`,
    );
    return text || null;
  } catch {
    return null;
  }
}

async function getClipboardFormat(): Promise<string> {
  try {
    const raw = await runPs(`
Add-Type -Assembly System.Windows.Forms
$d = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($d -eq $null) { "empty" }
elseif ($d.ContainsImage()) { "image" }
elseif ($d.ContainsText()) { "text" }
elseif ($d.ContainsFileDropList()) { "files" }
else { "other" }
`.trim());
    return raw || "empty";
  } catch {
    return "empty";
  }
}

async function getClipboardFiles(): Promise<string[]> {
  try {
    const raw = await runPs(`
Add-Type -Assembly System.Windows.Forms
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
$files | ForEach-Object { $_ }
`.trim());
    return raw.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ── Screenshot ───────────────────────────────────────────────

function resolveScreenshotDir(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  return path.join(home, "Pictures", "OpenClaw");
}

async function captureScreenshot(): Promise<{ ok: boolean; path: string; message: string }> {
  const dir = resolveScreenshotDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `screenshot-${timestamp}.png`;
  const filepath = path.join(dir, filename);

  try {
    await runPs(`
Add-Type -Assembly System.Windows.Forms
Add-Type -Assembly System.Drawing
New-Item -ItemType Directory -Path '${dir.replace(/'/g, "''")}' -Force | Out-Null
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${filepath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
"OK"
`.trim());
    return { ok: true, path: filepath, message: `Screenshot saved: ${filepath}` };
  } catch (e) {
    return { ok: false, path: "", message: `Screenshot failed: ${e}` };
  }
}

// ── Clipboard Image Save ─────────────────────────────────────

async function saveClipboardImage(): Promise<{ ok: boolean; path: string; message: string }> {
  const dir = resolveScreenshotDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `clipboard-${timestamp}.png`;
  const filepath = path.join(dir, filename);

  try {
    const result = await runPs(`
Add-Type -Assembly System.Windows.Forms
Add-Type -Assembly System.Drawing
New-Item -ItemType Directory -Path '${dir.replace(/'/g, "''")}' -Force | Out-Null
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -eq $null) { "NO_IMAGE" } else {
  $img.Save('${filepath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  "OK"
}
`.trim());
    if (result === "NO_IMAGE") {
      return { ok: false, path: "", message: "No image in clipboard." };
    }
    return { ok: true, path: filepath, message: `Clipboard image saved: ${filepath}` };
  } catch (e) {
    return { ok: false, path: "", message: `Save failed: ${e}` };
  }
}

// ── Formatting ───────────────────────────────────────────────

function formatHelp(): string {
  return [
    "Clipboard & Screenshot commands:",
    "",
    "/clip — Show clipboard content (text) or format info",
    "/clip paste — Read clipboard text",
    "/clip files — List files in clipboard",
    "/clip image — Save clipboard image to file",
    "/clip screenshot — Capture full screen screenshot",
    "/clip info — Show clipboard data format",
  ].join("\n");
}

// ── Plugin Entry ─────────────────────────────────────────────

export default definePluginEntry({
  id: "win-clipboard",
  name: "Windows Clipboard & Screenshot",
  description: "Read clipboard, capture screenshots, save clipboard images",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "clip",
      description: "Clipboard and screenshot operations (paste, image, screenshot, files).",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim().toLowerCase() ?? "";

        if (args === "help") return { text: formatHelp() };

        if (args === "info" || args === "format") {
          const fmt = await getClipboardFormat();
          return { text: `Clipboard format: ${fmt}` };
        }

        if (args === "paste" || args === "text") {
          const text = await readClipboardText();
          if (!text) return { text: "Clipboard is empty or contains no text." };
          const preview = text.length > 2000 ? `${text.slice(0, 2000)}...(truncated)` : text;
          return { text: `Clipboard text (${text.length} chars):\n\n${preview}` };
        }

        if (args === "files") {
          const files = await getClipboardFiles();
          if (files.length === 0) return { text: "No files in clipboard." };
          return { text: `Clipboard files (${files.length}):\n${files.join("\n")}` };
        }

        if (args === "image" || args === "save") {
          const result = await saveClipboardImage();
          return { text: result.message };
        }

        if (args === "screenshot" || args === "screen" || args === "ss") {
          const result = await captureScreenshot();
          return { text: result.message };
        }

        // Default: show clipboard content
        const fmt = await getClipboardFormat();
        if (fmt === "text") {
          const text = await readClipboardText();
          const preview = text && text.length > 500 ? `${text.slice(0, 500)}...` : (text ?? "");
          return { text: `Clipboard [text]: ${preview}` };
        }
        if (fmt === "image") {
          return { text: "Clipboard contains an image. Use /clip image to save it." };
        }
        if (fmt === "files") {
          const files = await getClipboardFiles();
          return { text: `Clipboard [files]: ${files.join(", ")}` };
        }
        return { text: `Clipboard: ${fmt}` };
      },
    });
  },
});
