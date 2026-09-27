export interface HudState {
  speed: number;
  speedUnits: number;
  topSpeed: number;
  grounded: boolean;
  ducked: boolean;
  fps: number;
  avgMs: number;
  worstMs: number;
  rawInput: boolean;
  tickRate: number;
  /** Trigger volumes the player is in. */
  zones: string[];
}

/** Debug HUD: speedometer bottom-centre, perf top-left. Updated at most ~15 times a second to keep DOM work cheap. */
export function createHud() {
  const speed = document.querySelector<HTMLElement>("#speed")!;
  const perf = document.querySelector<HTMLElement>("#perf")!;
  let last = 0;
  return {
    update(s: HudState) {
      const now = performance.now();
      if (now - last < 66) return;
      last = now;
      speed.textContent =
        `${s.speed.toFixed(2)} m/s  ·  ${Math.round(s.speedUnits)} u/s\n` +
        `top ${s.topSpeed.toFixed(2)} m/s  ·  ${s.grounded ? "ground" : "air"}${s.ducked ? " · crouched" : ""}` +
        (s.zones.length ? `\nzone ${s.zones.join(", ")}` : "");
      perf.textContent =
        `${Math.round(s.fps)} fps  avg ${s.avgMs.toFixed(1)} ms  worst ${s.worstMs.toFixed(1)} ms\n` +
        `tick ${s.tickRate.toFixed(1)} Hz  ·  mouse ${s.rawInput ? "raw" : "accelerated"}`;
    },
  };
}
