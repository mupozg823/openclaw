/**
 * Spatial navigation — move focus between focusable elements
 * based on directional input (D-pad / left stick).
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

export function moveFocus(direction: "up" | "down" | "left" | "right"): void {
  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null); // visible only

  if (focusable.length === 0) {
    return;
  }

  const current = document.activeElement as HTMLElement;
  if (!current || !focusable.includes(current)) {
    focusable[0]?.focus();
    return;
  }

  const rect = current.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let best: HTMLElement | null = null;
  let bestDist = Infinity;

  for (const el of focusable) {
    if (el === current) {
      continue;
    }
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const dx = ex - cx;
    const dy = ey - cy;

    // Filter candidates by direction
    let valid = false;
    switch (direction) {
      case "up":
        valid = dy < -5;
        break;
      case "down":
        valid = dy > 5;
        break;
      case "left":
        valid = dx < -5;
        break;
      case "right":
        valid = dx > 5;
        break;
    }
    if (!valid) {
      continue;
    }

    // Weighted distance: primary axis matters more
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
