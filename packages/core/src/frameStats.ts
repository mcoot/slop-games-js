/** Rolling frame-time statistics for the debug HUD. */
export class FrameStats {
  private readonly samples: number[] = [];
  private index = 0;

  constructor(private readonly size = 120) {}

  push(frameDt: number): void {
    if (this.samples.length < this.size) this.samples.push(frameDt);
    else this.samples[this.index] = frameDt;
    this.index = (this.index + 1) % this.size;
  }

  get averageMs(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return (sum / this.samples.length) * 1000;
  }

  get worstMs(): number {
    let worst = 0;
    for (const s of this.samples) worst = Math.max(worst, s);
    return worst * 1000;
  }

  get fps(): number {
    const avg = this.averageMs;
    return avg > 0 ? 1000 / avg : 0;
  }
}
