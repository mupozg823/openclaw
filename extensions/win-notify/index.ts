import { execFile } from "node:child_process";
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

// ── Toast Notification ──────────────────────────────────────

interface ToastOptions {
  title: string;
  body: string;
  tag?: string;
  sound?: boolean;
  actions?: Array<{ label: string; argument: string }>;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function sendToast(opts: ToastOptions): Promise<boolean> {
  const actionXml = (opts.actions ?? [])
    .map(
      (a) =>
        `<action content="${escapeXml(a.label)}" arguments="${escapeXml(a.argument)}" />`,
    )
    .join("\n      ");
  const actionsBlock =
    actionXml.length > 0 ? `<actions>${actionXml}</actions>` : "";
  const soundAttr = opts.sound === false ? ' silent="true"' : "";
  const tagAttr = opts.tag ? ` tag="${escapeXml(opts.tag)}"` : "";

  try {
    await runPs(`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$template = @'
<toast${tagAttr}>
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(opts.title)}</text>
      <text>${escapeXml(opts.body)}</text>
    </binding>
  </visual>
  <audio${soundAttr} />
  ${actionsBlock}
</toast>
'@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenClaw').Show($toast)
Write-Host 'OK'
`.trim());
    return true;
  } catch {
    return false;
  }
}

// ── Scheduled Toast (Reminder) ──────────────────────────────

interface Reminder {
  id: string;
  title: string;
  body: string;
  fireAt: Date;
  timer: ReturnType<typeof setTimeout>;
}

const reminders: Map<string, Reminder> = new Map();
let reminderCounter = 0;

function scheduleReminder(
  title: string,
  body: string,
  delaySec: number,
  logger: { info: (msg: string) => void },
): Reminder {
  reminderCounter++;
  const id = `rem-${reminderCounter}`;
  const fireAt = new Date(Date.now() + delaySec * 1000);
  const timer = setTimeout(() => {
    sendToast({ title, body, tag: id }).then((ok) => {
      if (ok) logger.info(`[notify] Reminder fired: ${title}`);
    });
    reminders.delete(id);
  }, delaySec * 1000);
  const reminder = { id, title, body, fireAt, timer };
  reminders.set(id, reminder);
  return reminder;
}

function cancelReminder(id: string): boolean {
  const r = reminders.get(id);
  if (!r) return false;
  clearTimeout(r.timer);
  reminders.delete(id);
  return true;
}

// ── Notification History ────────────────────────────────────

interface NotifyRecord {
  timestamp: number;
  title: string;
  body: string;
}

const history: NotifyRecord[] = [];
const MAX_HISTORY = 50;

function recordNotification(title: string, body: string): void {
  history.push({ timestamp: Date.now(), title, body });
  if (history.length > MAX_HISTORY) history.shift();
}

// ── System Notification Settings ────────────────────────────

async function getDoNotDisturb(): Promise<boolean | null> {
  try {
    const raw = await runPs(
      `(Get-ItemProperty 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings' -Name NOC_GLOBAL_SETTING_TOASTS_ENABLED -ErrorAction SilentlyContinue).NOC_GLOBAL_SETTING_TOASTS_ENABLED`,
    );
    return raw.trim() === "0";
  } catch {
    return null;
  }
}

// ── Duration Parsing ────────────────────────────────────────

function parseDuration(input: string): number | null {
  const match = input.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  if (unit.startsWith("s")) return value;
  if (unit.startsWith("m")) return value * 60;
  if (unit.startsWith("h")) return value * 3600;
  return null;
}

// ── Formatting ──────────────────────────────────────────────

function formatHelp(): string {
  return [
    "Notification commands:",
    "",
    '/notify <message> — Send a toast notification (title: "OpenClaw")',
    "/notify title <title> | <body> — Send with custom title",
    "/notify remind <delay> <message> — Set a reminder (e.g., 5m, 30s, 1h)",
    "/notify reminders — List active reminders",
    "/notify cancel <id> — Cancel a reminder",
    "/notify history — Show recent notifications",
    "/notify dnd — Check Do Not Disturb status",
    "/notify test — Send a test notification",
  ].join("\n");
}

function formatReminders(): string {
  if (reminders.size === 0) return "No active reminders.";
  const lines: string[] = [];
  for (const [id, r] of reminders) {
    const remaining = Math.max(
      0,
      Math.round((r.fireAt.getTime() - Date.now()) / 1000),
    );
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    lines.push(`  ${id}: "${r.title}" — in ${mins}m ${secs}s`);
  }
  return `Active reminders (${reminders.size}):\n${lines.join("\n")}`;
}

function formatHistory(): string {
  if (history.length === 0) return "No notification history.";
  const lines = history
    .slice(-10)
    .reverse()
    .map((n) => {
      const time = new Date(n.timestamp).toLocaleTimeString();
      return `  [${time}] ${n.title}: ${n.body.slice(0, 60)}`;
    });
  return `Recent notifications (${Math.min(history.length, 10)} of ${history.length}):\n${lines.join("\n")}`;
}

// ── Plugin Entry ────────────────────────────────────────────

export default definePluginEntry({
  id: "win-notify",
  name: "Windows Notifications",
  description: "Send toast notifications, set reminders, manage notification center",
  register(api: OpenClawPluginApi) {
    api.registerCommand({
      name: "notify",
      description:
        "Windows notifications — send toasts, set reminders, check DND.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const tokens = args.split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() ?? "";

        if (action === "help") return { text: formatHelp() };

        // /notify test
        if (action === "test") {
          const ok = await sendToast({
            title: "OpenClaw",
            body: "Notification system working!",
          });
          recordNotification("OpenClaw", "Notification system working!");
          return {
            text: ok
              ? "Test notification sent."
              : "Failed to send notification.",
          };
        }

        // /notify dnd
        if (action === "dnd" || action === "donotdisturb") {
          const dnd = await getDoNotDisturb();
          if (dnd === null)
            return { text: "Could not check Do Not Disturb status." };
          return {
            text: `Do Not Disturb: ${dnd ? "ON (notifications silenced)" : "OFF"}`,
          };
        }

        // /notify history
        if (action === "history" || action === "log") {
          return { text: formatHistory() };
        }

        // /notify reminders
        if (
          action === "reminders" ||
          action === "pending" ||
          action === "list"
        ) {
          return { text: formatReminders() };
        }

        // /notify cancel <id>
        if (action === "cancel" || action === "remove") {
          const id = tokens[1];
          if (!id) return { text: "Usage: /notify cancel <reminder-id>" };
          const ok = cancelReminder(id);
          return {
            text: ok
              ? `Reminder ${id} cancelled.`
              : `Reminder "${id}" not found.`,
          };
        }

        // /notify remind <delay> <message>
        if (action === "remind" || action === "timer" || action === "alarm") {
          const delay = tokens[1];
          const message = tokens.slice(2).join(" ");
          if (!delay || !message) {
            return {
              text: 'Usage: /notify remind <delay> <message>\nExamples: /notify remind 5m "Take a break"',
            };
          }
          const delaySec = parseDuration(delay);
          if (!delaySec || delaySec < 5 || delaySec > 86400) {
            return {
              text: "Invalid duration. Use: 30s, 5m, 1h (min 5s, max 24h)",
            };
          }
          const reminder = scheduleReminder(
            "Reminder",
            message,
            delaySec,
            api.logger,
          );
          return {
            text: `Reminder set: "${message}" in ${delay} (id: ${reminder.id})`,
          };
        }

        // /notify title <title> | <body>
        if (action === "title") {
          const rest = tokens.slice(1).join(" ");
          const pipeIdx = rest.indexOf("|");
          if (pipeIdx === -1) {
            return {
              text: 'Usage: /notify title My Title | My message body',
            };
          }
          const title = rest.slice(0, pipeIdx).trim();
          const body = rest.slice(pipeIdx + 1).trim();
          if (!title || !body) {
            return {
              text: 'Usage: /notify title My Title | My message body',
            };
          }
          const ok = await sendToast({ title, body });
          if (ok) recordNotification(title, body);
          return {
            text: ok
              ? `Notification sent: "${title}"`
              : "Failed to send notification.",
          };
        }

        // Default: /notify <message>
        if (args.length > 0) {
          const ok = await sendToast({ title: "OpenClaw", body: args });
          if (ok) recordNotification("OpenClaw", args);
          return {
            text: ok ? "Notification sent." : "Failed to send notification.",
          };
        }

        return { text: formatHelp() };
      },
    });
  },
});

export { formatHelp, parseDuration, escapeXml, formatReminders };
