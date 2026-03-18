/**
 * GamepadController — Xbox / ROG Ally X gamepad input handler.
 * Uses requestAnimationFrame polling with edge-trigger detection
 * so each button press fires exactly once.
 */

export type GamepadCallbacks = {
  onConfirm: () => void; // A button
  onBack: () => void; // B button
  onPalette: () => void; // Y button
  onMic: () => void; // X button
  onPrevTab: () => void; // LB
  onNextTab: () => void; // RB
  onDpad: (dir: "up" | "down" | "left" | "right") => void;
};

export class GamepadController {
  private rafId: number | null = null;
  private prevButtons: boolean[] = [];
  private stickDebounce = 0;
  private readonly STICK_DEBOUNCE_MS = 200;

  start(callbacks: GamepadCallbacks): void {
    // Add gamepad-active class on first gamepad input
    const addGamepadClass = () => {
      document.body.classList.add("gamepad-active");
    };
    window.addEventListener("gamepadconnected", addGamepadClass, { once: true });

    // Check if a gamepad is already connected (e.g. ROG Ally X built-in controller)
    // Gamepad API requires a button press before getGamepads() returns data,
    // but we can still prepare by checking on the next animation frame
    const checkExistingGamepads = () => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (gp && gp.connected) {
          document.body.classList.add("gamepad-active");
          break;
        }
      }
    };
    requestAnimationFrame(checkExistingGamepads);

    // Remove gamepad-active on mouse/touch
    const removeGamepadClass = () => {
      document.body.classList.remove("gamepad-active");
    };
    window.addEventListener("mousemove", removeGamepadClass);
    window.addEventListener("touchstart", removeGamepadClass);

    this.poll(callbacks);
  }

  stop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  private poll(cb: GamepadCallbacks): void {
    this.rafId = requestAnimationFrame(() => this.poll(cb));
    const gp = navigator.getGamepads()?.[0];
    if (!gp) {
      return;
    }

    // Edge-trigger: fire only on press, not hold
    for (let i = 0; i < gp.buttons.length; i++) {
      const pressed = gp.buttons[i]?.pressed ?? false;
      const wasPressed = this.prevButtons[i] ?? false;
      if (pressed && !wasPressed) {
        document.body.classList.add("gamepad-active");
        this.handleButton(i, cb);
      }
      this.prevButtons[i] = pressed;
    }

    // Left stick → spatial navigation (debounced)
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

  private handleButton(idx: number, cb: GamepadCallbacks): void {
    switch (idx) {
      case 0:
        cb.onConfirm();
        break; // A
      case 1:
        cb.onBack();
        break; // B
      case 2:
        cb.onMic();
        break; // X
      case 3:
        cb.onPalette();
        break; // Y
      case 4:
        cb.onPrevTab();
        break; // LB
      case 5:
        cb.onNextTab();
        break; // RB
      case 12:
        cb.onDpad("up");
        break;
      case 13:
        cb.onDpad("down");
        break;
      case 14:
        cb.onDpad("left");
        break;
      case 15:
        cb.onDpad("right");
        break;
    }
  }
}
