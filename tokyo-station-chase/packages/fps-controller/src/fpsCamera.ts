import * as THREE from "three";
import type { PlayerController } from "./playerController";

export interface CameraFeelSettings {
  /** Horizontal FOV measured at 4:3, like Source's `fov`. Wider screens see more at the sides (Hor+). */
  sourceFov: number;
  /** Seconds for most of a stair step's view jump to be smoothed out. 0 disables. */
  stepSmoothTime: number;
  /** Dip the view on hard landings. */
  landingDip: boolean;
  /** Vertical head-bob amplitude at run speed (m). 0 disables. */
  headBob: number;
}

export const defaultCameraFeel: CameraFeelSettings = {
  sourceFov: 90,
  stepSmoothTime: 0.08,
  landingDip: true,
  headBob: 0,
};

/** Vertical FOV (degrees) for a Source-style horizontal 4:3 FOV. */
export function verticalFovFromSource(sourceFov: number): number {
  const h = (sourceFov * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) * 0.75) * 180) / Math.PI;
}

/**
 * Places the camera at the player's eye: interpolated between simulation ticks,
 * with stair smoothing, landing dip and optional head bob. Look direction comes
 * straight from the mouse every frame, so aiming never waits for a tick.
 */
export class FpsCameraRig {
  private stepOffset = 0;
  /** The last tick's step, which the smoothing offset already covers, so interpolation must skip it. */
  private tickStep = 0;
  private dip = 0;
  private dipVelocity = 0;
  private bobPhase = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    public settings: CameraFeelSettings = { ...defaultCameraFeel },
  ) {
    camera.rotation.order = "YXZ";
  }

  /** Call once per simulation tick, after the controller's tick. */
  afterTick(player: PlayerController): void {
    const ev = player.events;
    this.tickStep = this.settings.stepSmoothTime > 0 ? ev.stepDelta : 0;
    this.stepOffset -= this.tickStep;
    if (this.settings.landingDip && ev.landedSpeed > 3) {
      this.dipVelocity -= Math.min((ev.landedSpeed - 3) * 0.25, 2.2);
    }
  }

  /** Call once per rendered frame. */
  update(player: PlayerController, alpha: number, yaw: number, pitch: number, frameDt: number): void {
    const s = this.settings;
    const cam = this.camera;

    const vfov = verticalFovFromSource(s.sourceFov);
    if (Math.abs(cam.fov - vfov) > 1e-3) {
      cam.fov = vfov;
      cam.updateProjectionMatrix();
    }

    // Stair smoothing: decay the offset exponentially, clamped so tall snaps don't lag forever.
    if (s.stepSmoothTime > 0) {
      this.stepOffset *= Math.exp(-frameDt / (s.stepSmoothTime / 3));
      this.stepOffset = THREE.MathUtils.clamp(this.stepOffset, -0.5, 0.5);
    } else {
      this.stepOffset = 0;
    }

    // Landing dip: a critically damped spring back to zero.
    const k = 180;
    const c = 2 * Math.sqrt(k);
    this.dipVelocity += (-k * this.dip - c * this.dipVelocity) * frameDt;
    this.dip += this.dipVelocity * frameDt;

    let bob = 0;
    if (s.headBob > 0 && player.grounded) {
      const speed = player.horizontalSpeed;
      this.bobPhase += speed * frameDt * 1.6;
      bob = Math.sin(this.bobPhase * Math.PI) * s.headBob * Math.min(speed / player.settings.runSpeed, 1);
    }

    const p0 = player.prevFeet;
    const p1 = player.feet;
    // Interpolate as if the step had already happened at the start of the tick: the
    // offset eases it in. Lerping across it as well would drop the view by a whole
    // stair right after each step, which shakes the camera on stairs.
    const y0 = p0.y + this.tickStep;
    const eye = THREE.MathUtils.lerp(player.prevEyeHeight, player.eyeHeight, alpha);
    cam.position.set(
      THREE.MathUtils.lerp(p0.x, p1.x, alpha),
      THREE.MathUtils.lerp(y0, p1.y, alpha) + eye + this.stepOffset + this.dip + bob,
      THREE.MathUtils.lerp(p0.z, p1.z, alpha),
    );
    cam.rotation.set(pitch, yaw, 0);
  }
}
