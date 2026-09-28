/**
 * Pointer-locked mouse look using Source's conventions:
 * degrees turned = raw counts * sensitivity * m_yaw (0.022 by default),
 * so players can bring their usual Source/CS sensitivity across.
 */
export interface MouseLookSettings {
  sensitivity: number;
  mYaw: number;
  mPitch: number;
  invertY: boolean;
}

export const defaultMouseLookSettings: MouseLookSettings = {
  sensitivity: 2,
  mYaw: 0.022,
  mPitch: 0.022,
  invertY: false,
};

const DEG = Math.PI / 180;
const PITCH_LIMIT = 89 * DEG;

export class MouseLook {
  /** Radians. Yaw 0 looks down -Z (three.js forward); positive yaw turns left. */
  yaw = 0;
  pitch = 0;
  rawInput = false;
  private locked = false;
  private readonly listeners = new Set<(locked: boolean) => void>();

  constructor(
    private readonly element: HTMLElement,
    public settings: MouseLookSettings = { ...defaultMouseLookSettings },
  ) {
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  get isLocked(): boolean {
    return this.locked;
  }

  onLockChanged(fn: (locked: boolean) => void): void {
    this.listeners.add(fn);
  }

  /** Request pointer lock, preferring raw (unaccelerated) mouse input where the browser supports it. */
  async lock(): Promise<void> {
    type LockFn = (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    const request = this.element.requestPointerLock.bind(this.element) as LockFn;
    try {
      await request({ unadjustedMovement: true });
      this.rawInput = true;
    } catch {
      this.rawInput = false;
      try {
        await request();
      } catch {
        // The browser refused (e.g. too soon after exiting); the next click retries.
      }
    }
  }

  unlock(): void {
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }

  dispose(): void {
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
  }

  private readonly onLockChange = () => {
    this.locked = document.pointerLockElement === this.element;
    for (const fn of this.listeners) fn(this.locked);
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    const s = this.settings;
    this.yaw -= e.movementX * s.sensitivity * s.mYaw * DEG;
    const dy = e.movementY * s.sensitivity * s.mPitch * DEG * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy));
  };
}
