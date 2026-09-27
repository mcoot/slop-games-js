export interface FixedLoopOptions {
  /** Simulation ticks per second. Source defaults to 66.67 (a 15 ms tick). */
  tickRate: number;
  /** Longest frame gap we try to catch up on, so a stalled tab doesn't spiral. */
  maxFrameTime?: number;
  tick(dt: number): void;
  /** Called once per animation frame. `alpha` is how far we are between the last two ticks (0..1). */
  render(alpha: number, frameDt: number): void;
}

/**
 * Fixed-timestep simulation with interpolated rendering: movement behaves the
 * same at 60 Hz and 240 Hz, and rendering stays smooth between ticks.
 */
export class FixedLoop {
  tickRate: number;
  private accumulator = 0;
  private last = 0;
  private handle = 0;
  private running = false;
  private readonly maxFrameTime: number;

  constructor(private readonly opts: FixedLoopOptions) {
    this.tickRate = opts.tickRate;
    this.maxFrameTime = opts.maxFrameTime ?? 0.25;
  }

  get dt(): number {
    return 1 / this.tickRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.handle = requestAnimationFrame(frame);
      this.advance(Math.min((now - this.last) / 1000, this.maxFrameTime));
      this.last = now;
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** Advance by a frame of `frameDt` seconds. Exposed for tests and manual stepping. */
  advance(frameDt: number): void {
    const dt = this.dt;
    this.accumulator += frameDt;
    while (this.accumulator >= dt) {
      this.opts.tick(dt);
      this.accumulator -= dt;
    }
    this.opts.render(this.accumulator / dt, frameDt);
  }
}
