# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is OpenClaw?

OpenClaw is a multi-channel personal AI assistant gateway. It connects to messaging channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, IRC, MS Teams, Matrix, and many more) and routes conversations through AI model providers. It runs locally on the user's devices with a CLI + macOS/iOS/Android companion apps.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Build (type-check + compile to dist/)
pnpm build

# Type-check only (fast)
pnpm tsgo

# Lint + format check
pnpm check

# Format fix
pnpm format:fix

# Run all tests
pnpm test

# Run a specific test
pnpm test -- src/commands/onboard-search.test.ts -t "shows registered plugin providers"

# Test coverage
pnpm test:coverage

# Run CLI in dev mode (TypeScript directly via tsx)
pnpm openclaw ...
# or
pnpm dev

# Dev loop with auto-reload
pnpm gateway:watch

# Build UI (required before first build)
pnpm ui:build

# Extension-specific tests
pnpm test:extension <extension-name>
pnpm test:extension --list          # list valid extension ids
pnpm test:contracts                  # shared plugin/channel surface tests

# Pre-commit hooks
prek install
```

**Runtime**: Node 22+ required. Bun supported for dev/scripts (`bun <file.ts>`).
**Package manager**: pnpm (keep `pnpm-lock.yaml` in sync). Bun install also supported.

## Architecture Overview

### Core Source (`src/`)

| Directory | Purpose |
|-----------|---------|
| `cli/` | CLI wiring, option parsing, progress bars (`progress.ts`) |
| `commands/` | CLI command implementations |
| `gateway/` | WebSocket control plane (sessions, presence, config, cron, webhooks) |
| `agents/` | Agent runtime, multi-agent routing |
| `providers/` | AI model provider integrations |
| `channels/` | Core channel routing logic |
| `routing/` | Message routing between channels and agents |
| `sessions/` | Session model (main, group isolation, activation modes) |
| `config/` | Configuration management |
| `plugins/` | Plugin loading and lifecycle |
| `plugin-sdk/` | SDK exported for extension authors |
| `media/` | Media pipeline (images/audio/video, transcription, size caps) |
| `media-understanding/` | Media analysis (vision, audio understanding) |
| `hooks/` | Event hooks system |
| `cron/` | Scheduled task system |
| `browser/` | Browser automation tools |
| `canvas-host/` | Live Canvas / A2UI visual workspace |
| `tts/` | Text-to-speech |
| `web-search/` | Web search tool integration |
| `memory/` | Memory subsystem |
| `security/` | Security, DM pairing, allowlists |
| `pairing/` | Channel pairing flow |
| `terminal/` | Terminal UI: tables (`table.ts`), themes (`theme.ts`), palette (`palette.ts`) |
| `infra/` | Shared infrastructure utilities (time formatting, etc.) |
| `wizard/` | Onboarding wizard |
| `daemon/` | Daemon (launchd/systemd) management |
| `context-engine/` | Context/compaction engine |
| `acp/` | Agent Communication Protocol |

### Built-in Channel Code (`src/`)

`src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`, `src/whatsapp`, `src/line`

### Extensions (`extensions/`)

Workspace packages under `extensions/*` — each is an independent plugin with its own `package.json`. ~67 extensions covering additional model providers (OpenAI, Anthropic, Ollama, Google, Mistral, etc.) and messaging channels (MS Teams, Matrix, Mattermost, etc.).

- Plugin-only deps go in the extension's `package.json`, not root.
- Use `openclaw` as `devDependencies` or `peerDependencies` (not `workspace:*` in `dependencies`).
- Runtime deps must be in `dependencies` (npm install runs `--omit=dev`).

### Apps (`apps/`)

| Directory | Platform |
|-----------|----------|
| `apps/macos/` | macOS menu bar app (Swift/SwiftUI) |
| `apps/ios/` | iOS app (Swift/SwiftUI) |
| `apps/android/` | Android app (Kotlin) |
| `apps/shared/` | Shared app code |

### Other

- `packages/clawdbot/`, `packages/moltbot/` — legacy package names
- `Swabble/` — Swift package (SwabbleCore)
- `ui/` — Control UI (Lit with legacy decorators)
- `vendor/a2ui/` — A2UI specification and renderers
- `docs/` — Mintlify docs (hosted at docs.openclaw.ai)
- `skills/` — Bundled skills

## Coding Conventions

- **TypeScript ESM** with strict typing. Avoid `any` (`no-explicit-any` is enforced).
- **Formatting/linting**: Oxlint + Oxfmt. Run `pnpm check` before commits.
- **Import style**: use `.js` extensions for ESM imports. Use `import type { X }` for type-only.
- **Tests**: colocated `*.test.ts` files. Vitest with V8 coverage (70% threshold). E2E tests: `*.e2e.test.ts`.
- **File size**: aim for ~500-700 LOC max; split when it improves clarity.
- **No `@ts-nocheck`**, no disabling `no-explicit-any`.
- **American English** in code, comments, docs, and UI strings.
- **Product name**: "OpenClaw" in prose/headings; `openclaw` for CLI/package/paths/config.
- **Commits**: use `scripts/committer "<msg>" <file...>` instead of manual `git add`/`git commit`.

## Key Patterns

- **CLI progress**: use `src/cli/progress.ts` (osc-progress + @clack/prompts spinner). Don't hand-roll.
- **Terminal tables**: use `src/terminal/table.ts` (`renderTable`). Keep ANSI-safe.
- **Colors/themes**: use `src/terminal/palette.ts` shared palette. No hardcoded colors.
- **Time formatting**: import from `src/infra/format-time`. Never create local `formatAge`/`formatDuration`.
- **Dependency injection**: use `createDefaultDeps` pattern.
- **Dynamic imports**: don't mix `await import("x")` and static `import ... from "x"` for the same module.
- **Tool schemas**: avoid `Type.Union` / `anyOf`/`oneOf`/`allOf` in tool input schemas. Use `stringEnum`/`optionalStringEnum`.
- **SwiftUI** (iOS/macOS): prefer `Observation` framework (`@Observable`) over `ObservableObject`.
- **Control UI**: Lit with legacy decorators (`@state()`, `@property()`). Do not use standard decorator syntax.

## Testing Notes

- Wrapper: always use `pnpm test -- <path> [args]`, not raw `pnpm vitest run`.
- Low-memory hosts: `OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test`.
- Live tests: `CLAWDBOT_LIVE_TEST=1 pnpm test:live` or `LIVE=1 pnpm test:live`.
- Don't set test workers above 16.

## Dependency Rules

- Any dependency with `pnpm.patchedDependencies` must use an exact version (no `^`/`~`).
- Patching dependencies requires explicit approval.
- Never update the Carbon dependency.

## Docs

- Hosted on Mintlify at `docs.openclaw.ai`.
- Internal doc links: root-relative, no `.md`/`.mdx` suffix (e.g., `[Config](/configuration)`).
- `docs/zh-CN/` is generated — do not edit directly.
- Docs content must be generic (no personal device names/hostnames).
- Order services/providers alphabetically in docs and UI unless describing runtime behavior.

## Security

- Treat inbound DMs as untrusted input.
- Do not edit files covered by `CODEOWNERS` security rules unless a listed owner asked.
- Read `SECURITY.md` before security advisory analysis.
- Never commit real phone numbers, API keys, or live config values.
