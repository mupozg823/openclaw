# OpenClaw v1.0 Release Checklist

**Target Date**: 2026-03-19  
**Version**: 1.0.0  
**Status**: In Progress

## Pre-Release (Code Quality)

### Code & Tests
- [x] All 89 unit tests passing
- [x] TSC type checking clean
- [x] Oxlint/Oxfmt passing on ROG plugins
- [x] Build succeeds (dist/ 61MB)
- [x] No regressions from Phase 2
- [x] Path normalization working (Windows/Unix)

### Documentation
- [x] Release notes created (RELEASE_v1.0.md)
- [x] Installation guide complete (INSTALLATION.md)
- [x] Plugin API documentation up-to-date
- [x] Troubleshooting guide written
- [x] Architecture docs updated

### Security Review
- [x] No API keys in code
- [x] PowerShell restricted to Get-* (safety)
- [x] No telemetry/tracking code
- [x] Admin privilege checks in place
- [x] Error messages don't leak sensitive data

## Release Build Preparation

### GitHub Release Assets
- [ ] Create GitHub release: v1.0.0
- [ ] Upload dist/ as `openclaw-v1.0.0.tar.gz` (61MB)
- [ ] Generate release checksums (SHA256)
- [ ] Create release notes from RELEASE_v1.0.md
- [ ] Tag commit as v1.0.0

### NPM Package Publishing
- [ ] Verify package.json version: 1.0.0
- [ ] Check CHANGELOG.md is updated
- [ ] Build final distribution
- [ ] Publish to npm registry

### Windows Tauri App
- [ ] Build Tauri app: `cargo build --release`
- [ ] Sign executable (if code signing available)
- [ ] Test on clean Windows system
- [ ] Upload as release asset: `rog-assistant-tray.exe`

### Docker Image (Optional for v1.0)
- [ ] Build Docker image
- [ ] Push to Docker Hub
- [ ] Document in README

## Post-Release Verification

### Installation Testing
- [ ] Test: `npm install -g @openclaw/openclaw`
- [ ] Test: `openclaw --version`
- [ ] Test: `openclaw gateway --port 8080`
- [ ] Test: Basic commands (`/rog status`, `/win-monitor`)

### Platform Testing
- [x] Windows 11 Home (primary)
- [ ] Windows 10 21H2 (compatibility)
- [ ] Generic Windows PC (graceful degradation)
- [ ] ASUS ROG Ally X (hardware validation)

### Feature Smoke Tests
- [ ] `/rog status` returns telemetry
- [ ] `/rog profile turbo` requires admin
- [ ] `/win-voice` TTS works
- [ ] `/win-monitor` shows system stats
- [ ] Gateway WebSocket connects

## Communication

### Announcements
- [ ] GitHub Discussions post
- [ ] Twitter/X announcement
- [ ] Discord server message (if exists)
- [ ] Email to early testers

### Marketing Assets
- [ ] Create demo GIF for README
- [ ] Write blog post
- [ ] Create quick-start video
- [ ] Update docs.openclaw.ai

## Monitoring (Post-Release)

### First Week
- [ ] Monitor GitHub issues for bugs
- [ ] Respond to user feedback
- [ ] Track npm install stats
- [ ] Check error logs from Sentry (if integrated)

### First Month
- [ ] Collect usage metrics
- [ ] Plan v1.1 features based on feedback
- [ ] Create community guidelines
- [ ] Set up Discussions categories

---

## Sign-Off

**Release Manager**: _____________  
**QA Approval**: _____________  
**Product Owner**: _____________  

**Release Date**: ___/___/______

---

## Notes

### Known Issues (v1.0)
- Voice STT requires internet (offline coming v1.1)
- WMI may be slow on older machines
- Overlay may impact game FPS by 2-5%

### Deferred Features (v1.1)
- [ ] Custom power profiles
- [ ] Offline voice recognition
- [ ] macOS/Linux ports
- [ ] Plugin sandboxing v2

