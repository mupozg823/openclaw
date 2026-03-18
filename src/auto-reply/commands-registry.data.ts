import { listChannelPlugins } from "../channels/plugins/index.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import { COMMAND_ARG_FORMATTERS } from "./commands-args.js";
import type {
  ChatCommandDefinition,
  CommandCategory,
  CommandScope,
} from "./commands-registry.types.js";
import { listThinkingLevels } from "./thinking.js";

type DefineChatCommandInput = {
  key: string;
  nativeName?: string;
  description: string;
  args?: ChatCommandDefinition["args"];
  argsParsing?: ChatCommandDefinition["argsParsing"];
  formatArgs?: ChatCommandDefinition["formatArgs"];
  argsMenu?: ChatCommandDefinition["argsMenu"];
  acceptsArgs?: boolean;
  textAlias?: string;
  textAliases?: string[];
  scope?: CommandScope;
  category?: CommandCategory;
};

function defineChatCommand(command: DefineChatCommandInput): ChatCommandDefinition {
  const aliases = (command.textAliases ?? (command.textAlias ? [command.textAlias] : []))
    .map((alias) => alias.trim())
    .filter(Boolean);
  const scope =
    command.scope ?? (command.nativeName ? (aliases.length ? "both" : "native") : "text");
  const acceptsArgs = command.acceptsArgs ?? Boolean(command.args?.length);
  const argsParsing = command.argsParsing ?? (command.args?.length ? "positional" : "none");
  return {
    key: command.key,
    nativeName: command.nativeName,
    description: command.description,
    acceptsArgs,
    args: command.args,
    argsParsing,
    formatArgs: command.formatArgs,
    argsMenu: command.argsMenu,
    textAliases: aliases,
    scope,
    category: command.category,
  };
}

type ChannelPlugin = ReturnType<typeof listChannelPlugins>[number];

function defineDockCommand(plugin: ChannelPlugin): ChatCommandDefinition {
  return defineChatCommand({
    key: `dock:${plugin.id}`,
    nativeName: `dock_${plugin.id}`,
    description: `Switch to ${plugin.id} for replies.`,
    textAliases: [`/dock-${plugin.id}`, `/dock_${plugin.id}`],
    category: "docks",
  });
}

function registerAlias(commands: ChatCommandDefinition[], key: string, ...aliases: string[]): void {
  const command = commands.find((entry) => entry.key === key);
  if (!command) {
    throw new Error(`registerAlias: unknown command key: ${key}`);
  }
  const existing = new Set(command.textAliases.map((alias) => alias.trim().toLowerCase()));
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) {
      continue;
    }
    const lowered = trimmed.toLowerCase();
    if (existing.has(lowered)) {
      continue;
    }
    existing.add(lowered);
    command.textAliases.push(trimmed);
  }
}

function assertCommandRegistry(commands: ChatCommandDefinition[]): void {
  const keys = new Set<string>();
  const nativeNames = new Set<string>();
  const textAliases = new Set<string>();
  for (const command of commands) {
    if (keys.has(command.key)) {
      throw new Error(`Duplicate command key: ${command.key}`);
    }
    keys.add(command.key);

    const nativeName = command.nativeName?.trim();
    if (command.scope === "text") {
      if (nativeName) {
        throw new Error(`Text-only command has native name: ${command.key}`);
      }
      if (command.textAliases.length === 0) {
        throw new Error(`Text-only command missing text alias: ${command.key}`);
      }
    } else if (!nativeName) {
      throw new Error(`Native command missing native name: ${command.key}`);
    } else {
      const nativeKey = nativeName.toLowerCase();
      if (nativeNames.has(nativeKey)) {
        throw new Error(`Duplicate native command: ${nativeName}`);
      }
      nativeNames.add(nativeKey);
    }

    if (command.scope === "native" && command.textAliases.length > 0) {
      throw new Error(`Native-only command has text aliases: ${command.key}`);
    }

    for (const alias of command.textAliases) {
      if (!alias.startsWith("/")) {
        throw new Error(`Command alias missing leading '/': ${alias}`);
      }
      const aliasKey = alias.toLowerCase();
      if (textAliases.has(aliasKey)) {
        throw new Error(`Duplicate command alias: ${alias}`);
      }
      textAliases.add(aliasKey);
    }
  }
}

let cachedCommands: ChatCommandDefinition[] | null = null;
let cachedRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;
let cachedNativeCommandSurfaces: Set<string> | null = null;
let cachedNativeRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;

function buildChatCommands(): ChatCommandDefinition[] {
  const commands: ChatCommandDefinition[] = [
    defineChatCommand({
      key: "help",
      nativeName: "help",
      description: "사용 가능한 명령어 보기",
      textAlias: "/help",
      category: "status",
    }),
    defineChatCommand({
      key: "commands",
      nativeName: "commands",
      description: "전체 슬래시 명령어 목록",
      textAlias: "/commands",
      category: "status",
    }),
    defineChatCommand({
      key: "skill",
      nativeName: "skill",
      description: "스킬 실행 (이름 입력)",
      textAlias: "/skill",
      category: "tools",
      args: [
        {
          name: "name",
          description: "Skill name",
          type: "string",
          required: true,
        },
        {
          name: "input",
          description: "Skill input",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "status",
      nativeName: "status",
      description: "시스템 상태 확인",
      textAlias: "/status",
      category: "status",
    }),
    defineChatCommand({
      key: "allowlist",
      description: "허용 목록 관리",
      textAlias: "/allowlist",
      acceptsArgs: true,
      scope: "text",
      category: "management",
    }),
    defineChatCommand({
      key: "approve",
      nativeName: "approve",
      description: "실행 요청 승인/거부",
      textAlias: "/approve",
      acceptsArgs: true,
      category: "management",
    }),
    defineChatCommand({
      key: "context",
      nativeName: "context",
      description: "컨텍스트 구성 설명",
      textAlias: "/context",
      acceptsArgs: true,
      category: "status",
    }),
    defineChatCommand({
      key: "btw",
      nativeName: "btw",
      description: "세션 변경 없이 질문",
      textAlias: "/btw",
      acceptsArgs: true,
      category: "tools",
    }),
    defineChatCommand({
      key: "export-session",
      nativeName: "export-session",
      description: "세션을 HTML로 내보내기",
      textAliases: ["/export-session", "/export"],
      acceptsArgs: true,
      category: "status",
      args: [
        {
          name: "path",
          description: "Output path (default: workspace)",
          type: "string",
          required: false,
        },
      ],
    }),
    defineChatCommand({
      key: "tts",
      nativeName: "tts",
      description: "텍스트 음성 변환 (TTS) 제어",
      textAlias: "/tts",
      category: "media",
      args: [
        {
          name: "action",
          description: "TTS action",
          type: "string",
          choices: [
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
            { value: "status", label: "Status" },
            { value: "provider", label: "Provider" },
            { value: "limit", label: "Limit" },
            { value: "summary", label: "Summary" },
            { value: "audio", label: "Audio" },
            { value: "help", label: "Help" },
          ],
        },
        {
          name: "value",
          description: "Provider, limit, or text",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: {
        arg: "action",
        title:
          "TTS Actions:\n" +
          "• On – Enable TTS for responses\n" +
          "• Off – Disable TTS\n" +
          "• Status – Show current settings\n" +
          "• Provider – Set voice provider (edge, elevenlabs, openai)\n" +
          "• Limit – Set max characters for TTS\n" +
          "• Summary – Toggle AI summary for long texts\n" +
          "• Audio – Generate TTS from custom text\n" +
          "• Help – Show usage guide",
      },
    }),
    defineChatCommand({
      key: "whoami",
      nativeName: "whoami",
      description: "내 발신자 ID 확인",
      textAlias: "/whoami",
      category: "status",
    }),
    defineChatCommand({
      key: "session",
      nativeName: "session",
      description: "세션 설정 관리 (/session idle 등)",
      textAlias: "/session",
      category: "session",
      args: [
        {
          name: "action",
          description: "idle | max-age",
          type: "string",
          choices: ["idle", "max-age"],
        },
        {
          name: "value",
          description: "Duration (24h, 90m) or off",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "subagents",
      nativeName: "subagents",
      description: "서브에이전트 관리 (목록/실행/중지)",
      textAlias: "/subagents",
      category: "management",
      args: [
        {
          name: "action",
          description: "list | kill | log | info | send | steer | spawn",
          type: "string",
          choices: ["list", "kill", "log", "info", "send", "steer", "spawn"],
        },
        {
          name: "target",
          description: "Run id, index, or session key",
          type: "string",
        },
        {
          name: "value",
          description: "Additional input (limit/message)",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "acp",
      nativeName: "acp",
      description: "ACP 세션 및 런타임 관리",
      textAlias: "/acp",
      category: "management",
      args: [
        {
          name: "action",
          description: "Action to run",
          type: "string",
          preferAutocomplete: true,
          choices: [
            "spawn",
            "cancel",
            "steer",
            "close",
            "sessions",
            "status",
            "set-mode",
            "set",
            "cwd",
            "permissions",
            "timeout",
            "model",
            "reset-options",
            "doctor",
            "install",
            "help",
          ],
        },
        {
          name: "value",
          description: "Action arguments",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "focus",
      nativeName: "focus",
      description:
        "스레드를 세션에 바인딩",
      textAlias: "/focus",
      category: "management",
      args: [
        {
          name: "target",
          description: "Subagent label/index or session key/id/label",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "unfocus",
      nativeName: "unfocus",
      description: "스레드 바인딩 해제",
      textAlias: "/unfocus",
      category: "management",
    }),
    defineChatCommand({
      key: "agents",
      nativeName: "agents",
      description: "바인딩된 에이전트 목록",
      textAlias: "/agents",
      category: "management",
    }),
    defineChatCommand({
      key: "kill",
      nativeName: "kill",
      description: "서브에이전트 종료",
      textAlias: "/kill",
      category: "management",
      args: [
        {
          name: "target",
          description: "Label, run id, index, or all",
          type: "string",
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "steer",
      nativeName: "steer",
      description: "서브에이전트에 지시",
      textAlias: "/steer",
      category: "management",
      args: [
        {
          name: "target",
          description: "Label, run id, or index",
          type: "string",
        },
        {
          name: "message",
          description: "Steering message",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "config",
      nativeName: "config",
      description: "설정값 조회/변경",
      textAlias: "/config",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | get | set | unset",
          type: "string",
          choices: ["show", "get", "set", "unset"],
        },
        {
          name: "path",
          description: "Config path",
          type: "string",
        },
        {
          name: "value",
          description: "Value for set",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.config,
    }),
    defineChatCommand({
      key: "mcp",
      nativeName: "mcp",
      description: "MCP 서버 관리",
      textAlias: "/mcp",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | get | set | unset",
          type: "string",
          choices: ["show", "get", "set", "unset"],
        },
        {
          name: "path",
          description: "MCP server name",
          type: "string",
        },
        {
          name: "value",
          description: "JSON config for set",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.mcp,
    }),
    defineChatCommand({
      key: "plugins",
      nativeName: "plugins",
      description: "플러그인 관리",
      textAliases: ["/plugins", "/plugin"],
      category: "management",
      args: [
        {
          name: "action",
          description: "list | show | get | enable | disable",
          type: "string",
          choices: ["list", "show", "get", "enable", "disable"],
        },
        {
          name: "path",
          description: "Plugin id or name",
          type: "string",
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.plugins,
    }),
    defineChatCommand({
      key: "debug",
      nativeName: "debug",
      description: "디버그 설정",
      textAlias: "/debug",
      category: "management",
      args: [
        {
          name: "action",
          description: "show | reset | set | unset",
          type: "string",
          choices: ["show", "reset", "set", "unset"],
        },
        {
          name: "path",
          description: "Debug path",
          type: "string",
        },
        {
          name: "value",
          description: "Value for set",
          type: "string",
          captureRemaining: true,
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.debug,
    }),
    defineChatCommand({
      key: "usage",
      nativeName: "usage",
      description: "사용량 요약",
      textAlias: "/usage",
      category: "options",
      args: [
        {
          name: "mode",
          description: "off, tokens, full, or cost",
          type: "string",
          choices: ["off", "tokens", "full", "cost"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "stop",
      nativeName: "stop",
      description: "현재 실행 중지",
      textAlias: "/stop",
      category: "session",
    }),
    defineChatCommand({
      key: "restart",
      nativeName: "restart",
      description: "OpenClaw 재시작",
      textAlias: "/restart",
      category: "tools",
    }),
    defineChatCommand({
      key: "activation",
      nativeName: "activation",
      description: "그룹 활성화 모드",
      textAlias: "/activation",
      category: "management",
      args: [
        {
          name: "mode",
          description: "mention or always",
          type: "string",
          choices: ["mention", "always"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "send",
      nativeName: "send",
      description: "전송 정책 설정",
      textAlias: "/send",
      category: "management",
      args: [
        {
          name: "mode",
          description: "on, off, or inherit",
          type: "string",
          choices: ["on", "off", "inherit"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "reset",
      nativeName: "reset",
      description: "세션 초기화",
      textAlias: "/reset",
      acceptsArgs: true,
      category: "session",
    }),
    defineChatCommand({
      key: "new",
      nativeName: "new",
      description: "새 세션 시작",
      textAlias: "/new",
      acceptsArgs: true,
      category: "session",
    }),
    defineChatCommand({
      key: "compact",
      nativeName: "compact",
      description: "세션 컨텍스트 압축",
      textAlias: "/compact",
      category: "session",
      args: [
        {
          name: "instructions",
          description: "Extra compaction instructions",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    defineChatCommand({
      key: "think",
      nativeName: "think",
      description: "사고 수준 설정",
      textAlias: "/think",
      category: "options",
      args: [
        {
          name: "level",
          description: "off, minimal, low, medium, high, xhigh",
          type: "string",
          choices: ({ provider, model }) => listThinkingLevels(provider, model),
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "verbose",
      nativeName: "verbose",
      description: "상세 모드 전환",
      textAlias: "/verbose",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on or off",
          type: "string",
          choices: ["on", "off"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "fast",
      nativeName: "fast",
      description: "빠른 모드 전환",
      textAlias: "/fast",
      category: "options",
      args: [
        {
          name: "mode",
          description: "status, on, or off",
          type: "string",
          choices: ["status", "on", "off"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "reasoning",
      nativeName: "reasoning",
      description: "추론 표시 전환",
      textAlias: "/reasoning",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on, off, or stream",
          type: "string",
          choices: ["on", "off", "stream"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "elevated",
      nativeName: "elevated",
      description: "고급 모드 전환",
      textAlias: "/elevated",
      category: "options",
      args: [
        {
          name: "mode",
          description: "on, off, ask, or full",
          type: "string",
          choices: ["on", "off", "ask", "full"],
        },
      ],
      argsMenu: "auto",
    }),
    defineChatCommand({
      key: "exec",
      nativeName: "exec",
      description: "실행 기본값 설정",
      textAlias: "/exec",
      category: "options",
      args: [
        {
          name: "host",
          description: "sandbox, gateway, or node",
          type: "string",
          choices: ["sandbox", "gateway", "node"],
        },
        {
          name: "security",
          description: "deny, allowlist, or full",
          type: "string",
          choices: ["deny", "allowlist", "full"],
        },
        {
          name: "ask",
          description: "off, on-miss, or always",
          type: "string",
          choices: ["off", "on-miss", "always"],
        },
        {
          name: "node",
          description: "Node id or name",
          type: "string",
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.exec,
    }),
    defineChatCommand({
      key: "model",
      nativeName: "model",
      description: "모델 조회/변경",
      textAlias: "/model",
      category: "options",
      args: [
        {
          name: "model",
          description: "Model id (provider/model or id)",
          type: "string",
        },
      ],
    }),
    defineChatCommand({
      key: "models",
      nativeName: "models",
      description: "모델 프로바이더 목록",
      textAlias: "/models",
      argsParsing: "none",
      acceptsArgs: true,
      category: "options",
    }),
    defineChatCommand({
      key: "queue",
      nativeName: "queue",
      description: "큐 설정",
      textAlias: "/queue",
      category: "options",
      args: [
        {
          name: "mode",
          description: "queue mode",
          type: "string",
          choices: ["steer", "interrupt", "followup", "collect", "steer-backlog"],
        },
        {
          name: "debounce",
          description: "debounce duration (e.g. 500ms, 2s)",
          type: "string",
        },
        {
          name: "cap",
          description: "queue cap",
          type: "number",
        },
        {
          name: "drop",
          description: "drop policy",
          type: "string",
          choices: ["old", "new", "summarize"],
        },
      ],
      argsParsing: "none",
      formatArgs: COMMAND_ARG_FORMATTERS.queue,
    }),
    defineChatCommand({
      key: "bash",
      description: "Run host shell commands (host-only).",
      textAlias: "/bash",
      scope: "text",
      category: "tools",
      args: [
        {
          name: "command",
          description: "Shell command",
          type: "string",
          captureRemaining: true,
        },
      ],
    }),
    ...listChannelPlugins()
      .filter((plugin) => plugin.capabilities.nativeCommands)
      .map((plugin) => defineDockCommand(plugin)),
  ];

  registerAlias(commands, "whoami", "/id");
  registerAlias(commands, "think", "/thinking", "/t");
  registerAlias(commands, "verbose", "/v");
  registerAlias(commands, "reasoning", "/reason");
  registerAlias(commands, "elevated", "/elev");
  registerAlias(commands, "steer", "/tell");

  assertCommandRegistry(commands);
  return commands;
}

export function getChatCommands(): ChatCommandDefinition[] {
  const registry = getActivePluginRegistry();
  if (cachedCommands && registry === cachedRegistry) {
    return cachedCommands;
  }
  const commands = buildChatCommands();
  cachedCommands = commands;
  cachedRegistry = registry;
  cachedNativeCommandSurfaces = null;
  return commands;
}

export function getNativeCommandSurfaces(): Set<string> {
  const registry = getActivePluginRegistry();
  if (cachedNativeCommandSurfaces && registry === cachedNativeRegistry) {
    return cachedNativeCommandSurfaces;
  }
  cachedNativeCommandSurfaces = new Set(
    listChannelPlugins()
      .filter((plugin) => plugin.capabilities.nativeCommands)
      .map((plugin) => plugin.id),
  );
  cachedNativeRegistry = registry;
  return cachedNativeCommandSurfaces;
}
