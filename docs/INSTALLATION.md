# OpenClaw Installation Guide

Complete step-by-step installation and setup for OpenClaw ROG Windows Assistant.

## Prerequisites Checklist

- [ ] Windows 10 (21H2+) or Windows 11
- [ ] Node.js 22+ ([download](https://nodejs.org/))
- [ ] Administrator account (for some features)
- [ ] Internet connection (initial download + voice STT)
- [ ] ~500MB free disk space

### Optional
- ASUS ROG device (for full hardware integration)
- Microphone (for voice commands)

## Installation Methods

### Method 1: NPM Global Install ⭐ (Recommended)

```bash
# Install globally
npm install -g @openclaw/openclaw

# Verify installation
openclaw --version

# Start the gateway
openclaw gateway --port 8080

# In another terminal, test a command
openclaw rog status
```

**Pros:**
- ✅ Easiest setup
- ✅ Automatic updates via npm
- ✅ Global CLI access

**Cons:**
- ⚠️ Requires Node.js installed globally

---

### Method 2: Local Project Install

```bash
# Create project directory
mkdir openclaw-assistant && cd openclaw-assistant

# Initialize npm project
npm init -y

# Install as local dependency
npm install @openclaw/openclaw

# Run via npx
npx openclaw --version
npx openclaw gateway --port 8080

# Or create a run script in package.json:
# "scripts": { "start": "openclaw gateway --port 8080" }
npm start
```

---

### Method 3: GitHub Release Bundle

1. **Download Bundle**
   - Go to [GitHub Releases](https://github.com/anthropics/openclaw/releases/tag/v1.0.0)
   - Download `openclaw-v1.0.0-bundle.tar.gz`

2. **Extract**
   ```bash
   tar -xzf openclaw-v1.0.0-bundle.tar.gz
   cd openclaw-v1.0.0
   ```

3. **Install Dependencies**
   ```bash
   pnpm install  # or: npm install
   ```

4. **Run**
   ```bash
   pnpm openclaw gateway --port 8080
   # or: npm run openclaw -- gateway --port 8080
   ```

---

## First Run

### 1. Start the Gateway

```bash
openclaw gateway --port 8080
```

Expected output:
```
🚀 OpenClaw Gateway starting...
📡 WebSocket server listening on ws://localhost:8080
✅ Plugin loader initialized
✅ 17 plugins loaded
Ready to accept connections.
```

### 2. Test Basic Commands

In another terminal:

```bash
# Test ROG hardware (if on ASUS ROG device)
openclaw rog status

# Get help
openclaw rog help

# List all available commands
openclaw help
```

### 3. Start Tauri Tray App (Optional)

The system tray app provides GUI access to commands:

```bash
# From releases page: download rog-assistant-tray.exe
# Or build from source:
cd apps/windows
cargo build --release
# Runs at: target/release/rog_assistant.exe
```

---

## Configuration

### Environment Variables

```bash
# Set listen port
export OPENCLAW_GATEWAY_PORT=8080

# Enable verbose logging
export OPENCLAW_BUILD_VERBOSE=1

# Set config directory
export OPENCLAW_CONFIG_DIR=~/.openclaw
```

### Config File

Create `~/.openclaw/config.json`:

```json
{
  "gateway": {
    "port": 8080,
    "host": "localhost"
  },
  "plugins": {
    "rog-hardware": { "enabled": true },
    "win-voice": { "enabled": true },
    "rog-aura": { "enabled": true }
  },
  "rog-control-center": {
    "defaultPreset": "gaming"
  }
}
```

---

## Running as Windows Service

### Option A: Task Scheduler (Recommended)

1. Open Task Scheduler: `Win+R` → `taskschd.msc`

2. Create Basic Task:
   - Name: `OpenClaw Gateway`
   - Trigger: `At startup`
   - Action: `Start a program`
     - Program: `C:\Users\<username>\AppData\Roaming\npm\openclaw.cmd`
     - Arguments: `gateway --port 8080`
   - Check: "Run with highest privileges"

3. Save and test:
   ```bash
   # Manual trigger in Task Scheduler
   # Or test: openclaw gateway
   ```

### Option B: Windows Service (Advanced)

Use NSSM (Non-Sucking Service Manager):

```bash
# Download nssm from https://nssm.cc
# Install service
nssm install OpenClawGateway "C:\Path\To\node.exe" "C:\Path\To\openclaw.js gateway"
nssm start OpenClawGateway

# Check status
nssm status OpenClawGateway

# Remove service
nssm remove OpenClawGateway
```

---

## Enabling ROG-Only Features

### Admin Privileges Check

Some plugins require administrator privileges. Test:

```bash
# Run as Administrator
# Then test:
openclaw rog profile turbo
```

If you see: `"Administrator privileges required..."`
- Right-click PowerShell → "Run as Administrator"
- Then run the command again

### Granting Persistent Admin Access

**Option 1: Task Scheduler (Recommended)**
Configure the scheduled task to "Run with highest privileges" (see section above)

**Option 2: Create Admin Batch Script**

Create `openclaw-admin.bat`:
```batch
@echo off
cd %USERPROFILE%
node "%APPDATA%\npm\openclaw.cmd" %*
```

Then run via `runas`:
```bash
runas /user:Administrator openclaw-admin.bat rog profile turbo
```

---

## Troubleshooting

### "Command not found: openclaw"

**Solution 1:** NPM path issue
```bash
# Check if npm bin is in PATH
npm bin -g

# Add to PATH if needed (Windows):
# Environment Variables → System Variables → PATH
# Add: C:\Users\<username>\AppData\Roaming\npm
```

**Solution 2:** Reinstall
```bash
npm uninstall -g @openclaw/openclaw
npm install -g @openclaw/openclaw
```

---

### "Administrator privileges required"

Only appears when running commands that need admin access. Three solutions:

**Option 1:** Open PowerShell as Admin
```bash
# Right-click PowerShell → "Run as Administrator"
openclaw rog profile turbo
```

**Option 2:** Use Task Scheduler (see section above)

**Option 3:** Use runas
```bash
runas /user:Administrator "openclaw rog profile turbo"
```

---

### "This device is not an ASUS ROG device"

This is **not an error** — it's expected on non-ROG devices.

- ✅ Windows utilities (`win-*` plugins) still work
- ✅ General commands (`help`, `list`) work
- ❌ ROG-specific commands (`/rog`, `/fan`, `/aura`) disabled

To check device model:
```bash
wmic os get caption

# For ASUS ROG devices, output will contain "ROG" or "Ally"
```

---

### Gateway fails to start

**Error:** `Port already in use`
```bash
# Change port
openclaw gateway --port 8081

# Or find and kill existing process
netstat -ano | findstr :8080
taskkill /PID <process_id> /F
```

**Error:** `Cannot load plugins`
```bash
# Check installation
npm list -g @openclaw/openclaw

# Reinstall
npm install -g @openclaw/openclaw
```

---

### Voice commands not working

Check Windows Speech Settings:

```bash
# Open Settings
# Settings → Time & Language → Speech → Microphone

# Test microphone:
# Settings → Sound → Volume mixer → Microphone
```

Requires:
- ✅ Microphone enabled
- ✅ Speech recognition enabled
- ✅ Internet (for cloud STT in v1.0)

---

## Uninstallation

### If installed globally

```bash
npm uninstall -g @openclaw/openclaw

# Remove config directory
rm -r ~/.openclaw
```

### If installed locally

```bash
rm -rf openclaw-v1.0.0/
```

### Clean up services

```bash
# Remove Task Scheduler task
# Open Task Scheduler → delete "OpenClaw Gateway"

# Or remove service if using NSSM
nssm remove OpenClawGateway
```

---

## Next Steps

After installation:

1. ✅ **Test basic commands:** `openclaw rog status`
2. ✅ **Configure plugins:** Edit `~/.openclaw/config.json`
3. ✅ **Enable auto-start:** Set up as Windows service
4. ✅ **Install Tauri app:** Download from releases
5. ✅ **Explore plugins:** `openclaw help` or `openclaw marketplace`

---

## Getting Help

- 📖 **Full Documentation:** https://docs.openclaw.ai/rog-windows-assistant
- 🐛 **Report Bugs:** https://github.com/anthropics/openclaw/issues
- 💬 **Discussions:** https://github.com/anthropics/openclaw/discussions
- ⚡ **Status Updates:** Check GitHub releases for latest info

---

**Enjoy your fully-featured Windows gaming assistant!** 🚀
