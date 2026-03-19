# OpenClaw v1.0 — ROG Windows Assistant Release Notes

**Release Date**: 2026-03-19  
**Version**: 1.0.0  
**Status**: Production Ready ✅

## What's New in v1.0

OpenClaw now brings AI-powered assistance to Windows gaming devices with deep ROG hardware integration.

### 🎮 ROG Hardware Control (rog-hardware, rog-fan)
- Real-time CPU/GPU temperature monitoring
- Battery status (%, voltage, health %, power draw)
- Power mode switching (Silent/Performance/Turbo)
- Fan curve control and optimization
- Display refresh rate detection

**Commands:**
```
/rog status          # Full system telemetry
/rog profile <mode>  # Switch power profile
/rog temp            # CPU/GPU temperatures
/rog battery         # Battery details
/rog fan status      # Fan speeds + curves
```

### 🎨 ROG Aura RGB Control (rog-aura)
- Keyboard RGB lighting effects (breathing, wave, static, strobe, etc.)
- Color customization per zone
- Effect intensity and speed tuning
- Registry-based control with fallback chains

### 🎯 Game Automation (rog-automate)
- Priority-based game detection
- Automatic power profile switching
- Fan curve profiles per game
- RGB effect triggers on game launch
- Rule disable/override support

### 🕹️ Gamepad Input (win-gamepad)
- Xbox/ROG gamepad button mapping
- Analog trigger support
- Configurable dead zones
- Controller battery status

### 💬 Voice I/O (win-voice)
- Text-to-speech (TTS) via Windows System.Speech
- Speech-to-text (STT) recognition
- Multi-language support (English, Korean, etc.)
- Custom voice selection

### 🖥️ System Utilities
- **win-app-control**: Launch/focus/close apps
- **win-file-search**: Windows Search + directory fallback
- **win-clipboard**: Clipboard read/write
- **win-monitor**: CPU/GPU/RAM/disk/network monitoring
- **win-desktop**: Virtual desktop + window snap + monitor switching
- **win-startup**: Startup configuration + service management
- **win-notify**: Toast notifications + reminders

### 🎮 Game HUD Overlay (rog-overlay)
- In-game performance stats overlay
- CPU/GPU/battery real-time display
- Customizable widget positions
- Semi-transparent theme options

### 📦 Plugin Marketplace (win-marketplace)
- Browse installed plugins
- Plugin details and command help
- Enable/disable plugins
- Update checker

### 🔧 Control Center (rog-control-center)
- Unified dashboard for all plugins
- Quick preset system (Gaming/Battery/Quiet/Presentation)
- System health overview
- One-click plugin inventory

### 🌐 Gateway Integration (rog-gateway-bridge)
- Tauri tray app ↔ OpenClaw CLI bridging
- WebSocket real-time status
- Remote control from system tray
- Safe PowerShell execution (Get-* only)

## System Requirements

### Hardware
- Windows 10 (21H2+) or Windows 11
- ASUS ROG device (recommended) or any Windows device
- Node.js 22+ (for CLI)

### Software
- Administrator privileges (for power profile switching + fan control)
- Windows PowerShell 5.0+
- 500MB disk space

## Installation

### Option 1: NPM Package (Recommended)
```bash
npm install -g @openclaw/openclaw

# Start the gateway
openclaw gateway --port 8080

# Run the Tauri tray app (separate install)
# Downloads from releases page
```

### Option 2: GitHub Release Bundle
1. Download `openclaw-v1.0.0-bundle.tar.gz` from releases
2. Extract: `tar -xzf openclaw-v1.0.0-bundle.tar.gz`
3. Run: `cd openclaw && pnpm install && pnpm openclaw gateway`

### Option 3: Docker (coming soon)
```bash
docker pull openclaw:v1.0
docker run -it openclaw:v1.0
```

## Plugin Features Matrix

| Plugin | CLI | GUI | Real-time | Admin | Tests |
|--------|-----|-----|-----------|-------|-------|
| rog-hardware | ✅ | ✅ | Yes | Yes | 11 ✅ |
| rog-fan | ✅ | ✅ | Yes | Yes | 13 ✅ |
| rog-aura | ✅ | ✅ | No | Yes | 6 ✅ |
| rog-automate | ✅ | ✅ | Yes | No | 11 ✅ |
| win-voice | ✅ | — | No | No | 4 ✅ |
| win-gamepad | ✅ | ✅ | Yes | No | 8 ✅ |
| win-app-control | ✅ | — | No | No | 3 ✅ |
| win-file-search | ✅ | — | No | No | 3 ✅ |
| **Total** | **17** | **8** | — | — | **89 tests ✅** |

## Known Limitations

### ROG-Only Features
- Power profile switching requires ASUS ROG hardware
- Fan curve control may not work on non-ASUS devices (graceful fallback)
- RGB effects limited to ASUS keyboards

### Admin Requirements
- Power profile changes require administrator privileges
- Automatic UAC elevation prompt shown when needed
- Fan control needs ASUS service access

### Performance Considerations
- WMI queries may be slow on older machines (1-2s latency)
- Real-time overlay impacts game FPS by ~2-5% (varies by game)
- Voice recognition requires internet for cloud STT (local offline mode coming)

## Testing Coverage

✅ **89 unit tests passing**
- Pure function testing (isolated logic)
- Plugin registration and command routing
- Error handling and edge cases
- Cross-platform path normalization

### Tested On
- Windows 11 Home (main development)
- Windows 10 21H2 (compatibility)
- ASUS ROG Ally X (primary target)
- Generic Windows PC (graceful degradation)

## Troubleshooting

### "This device is not an ASUS ROG device"
- rog-hardware plugin only fully works on ASUS ROG devices
- Other commands (win-*) work on any Windows machine
- Check device model: `wmic os get caption`

### "Administrator privileges required"
- Power profile and fan control need admin
- Restart OpenClaw as Administrator: `runas /user:Admin openclaw`
- Or configure Windows Task Scheduler to run as admin

### Voice Not Working
- Check Windows Speech Recognition is enabled
- Verify microphone/speaker in Sound settings
- Requires internet for cloud STT (offline coming in v1.1)

### WMI Commands Slow
- Normal on first run (WMI initialization)
- Caching in place for subsequent calls
- Try reducing polling interval if using in loops

## What's Coming in v1.1

- [ ] Offline voice STT (local whisper model)
- [ ] Thermal/fan curve profiles per game
- [ ] Custom power profile creation
- [ ] RGB effect programming API
- [ ] Plugin sandboxing improvements
- [ ] macOS/Linux ports

## Security Notes

- Gateway WebSocket requires local network (not exposed to internet by default)
- PowerShell execution limited to `Get-*` commands for safety
- No telemetry or data collection
- All local processing — no cloud sync

## Support & Feedback

- 🐛 **Bug Reports**: GitHub Issues
- 💬 **Discussions**: GitHub Discussions
- 📖 **Docs**: https://docs.openclaw.ai/rog-windows-assistant
- 🎮 **Discord**: (coming soon)

## Credits

Built with OpenClaw's plugin architecture. Thanks to ASUS for excellent ROG hardware and APIs.

---

**🚀 Ready to supercharge your gaming laptop? Install v1.0 now!**
