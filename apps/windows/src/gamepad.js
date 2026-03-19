// OpenClaw ROG Dashboard — gamepad.js
// Ported from ui/src/ui/gamepad-controller.ts + spatial-nav.ts (pure JS)

// ── Spatial Navigation ───────────────────────────────────
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]';

function moveFocus(direction) {
  const focusable = Array.from(
    document.querySelectorAll(FOCUSABLE_SELECTOR)
  ).filter((el) => el.offsetParent !== null);

  if (focusable.length === 0) return;

  const current = document.activeElement;
  if (!current || !focusable.includes(current)) {
    focusable[0]?.focus();
    return;
  }

  const rect = current.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let best = null;
  let bestDist = Infinity;

  for (const el of focusable) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const dx = ex - cx;
    const dy = ey - cy;

    let valid = false;
    switch (direction) {
      case "up":    valid = dy < -5; break;
      case "down":  valid = dy > 5;  break;
      case "left":  valid = dx < -5; break;
      case "right": valid = dx > 5;  break;
    }
    if (!valid) continue;

    const isVertical = direction === "up" || direction === "down";
    const primary = isVertical ? Math.abs(dy) : Math.abs(dx);
    const secondary = isVertical ? Math.abs(dx) : Math.abs(dy);
    const dist = primary + secondary * 2;

    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }

  if (best) {
    best.focus();
    best.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ── Gamepad Controller ───────────────────────────────────
class GamepadController {
  constructor() {
    this.rafId = null;
    this.prevButtons = [];
    this.stickDebounce = 0;
    this.STICK_DEBOUNCE_MS = 200;
    this.gamepadConnected = false;
  }

  start(callbacks) {
    const addGamepadClass = () => {
      document.body.classList.add("gamepad-active");
      this.gamepadConnected = true;
    };
    window.addEventListener("gamepadconnected", addGamepadClass);
    window.addEventListener("gamepaddisconnected", () => {
      this.gamepadConnected = false;
    });

    requestAnimationFrame(() => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (gp && gp.connected) {
          document.body.classList.add("gamepad-active");
          this.gamepadConnected = true;
          break;
        }
      }
    });

    const removeGamepadClass = () => document.body.classList.remove("gamepad-active");
    window.addEventListener("mousemove", removeGamepadClass);
    window.addEventListener("touchstart", removeGamepadClass);

    this._poll(callbacks);
  }

  stop() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  _poll(cb) {
    this.rafId = requestAnimationFrame(() => this._poll(cb));
    // Skip expensive getGamepads() call when no gamepad is connected
    if (!this.gamepadConnected) return;
    const gp = navigator.getGamepads()?.[0];
    if (!gp) return;

    for (let i = 0; i < gp.buttons.length; i++) {
      const pressed = gp.buttons[i]?.pressed ?? false;
      const wasPressed = this.prevButtons[i] ?? false;
      if (pressed && !wasPressed) {
        document.body.classList.add("gamepad-active");
        this._handleButton(i, cb);
      }
      this.prevButtons[i] = pressed;
    }

    const now = performance.now();
    if (now - this.stickDebounce > this.STICK_DEBOUNCE_MS) {
      const lx = gp.axes[0] ?? 0;
      const ly = gp.axes[1] ?? 0;
      const DEADZONE = 0.5;
      if (Math.abs(lx) > DEADZONE || Math.abs(ly) > DEADZONE) {
        this.stickDebounce = now;
        document.body.classList.add("gamepad-active");
        if (Math.abs(lx) > Math.abs(ly)) {
          cb.onDpad(lx > 0 ? "right" : "left");
        } else {
          cb.onDpad(ly > 0 ? "down" : "up");
        }
      }
    }
  }

  _handleButton(idx, cb) {
    switch (idx) {
      case 0:  cb.onConfirm();  break; // A
      case 1:  cb.onBack();     break; // B
      case 2:  cb.onMic();      break; // X
      case 3:  cb.onPalette();  break; // Y
      case 4:  cb.onPrevTab();  break; // LB
      case 5:  cb.onNextTab();  break; // RB
      case 12: cb.onDpad("up");    break;
      case 13: cb.onDpad("down");  break;
      case 14: cb.onDpad("left");  break;
      case 15: cb.onDpad("right"); break;
    }
  }
}

// Export to window for app.js consumption
window.GamepadController = GamepadController;
window.moveFocus = moveFocus;
