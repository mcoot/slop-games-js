/**
 * Weapons, Tribes: Ascend style: projectiles that take time to arrive and inherit some of
 * your own velocity, so you lead your targets and your speed matters. Numbers are a
 * starting point modelled on T:A (all live in the Tuning panel).
 */
export type WeaponId = "disc" | "rifle";

export interface WeaponDef {
  /** "edge" is the arena boundary, for the kill feed. */
  id: WeaponId | "edge";
  name: string;
  /** Muzzle speed (m/s). */
  speed: number;
  /** How much of the shooter's velocity the projectile keeps (Tribes inheritance). */
  inherit: number;
  /** Projectile gravity (m/s²); 0 flies straight. */
  gravity: number;
  /** Seconds before a projectile fizzles out. */
  lifetime: number;
  /** Collision radius of the projectile (m). */
  radius: number;
  /** Damage on a direct hit, and at the centre of the blast. */
  damage: number;
  /** Blast radius (m); 0 for no splash. */
  splashRadius: number;
  /** Full damage within this distance of the blast (m), then a linear falloff to the edge. */
  splashInner: number;
  /** Fraction of `damage` at the edge of the blast. */
  splashFalloff: number;
  /** Multiplier on a direct hit against someone in the air (a "midair"). */
  midairBonus: number;
  /** Fraction of damage you take from your own blast. */
  selfDamage: number;
  /** Knockback at the centre of the blast (m/s), fading to 0 at the edge. Disc jumps. */
  impulse: number;
  /** Shots per trigger pull, and the gap between them (s). */
  burst: number;
  burstInterval: number;
  /** Wait after a shot (or burst) before the next (s). */
  cooldown: number;
  /** Rounds per magazine (0: unlimited) and reload time (s). */
  magazine: number;
  reload: number;
  /** Random spread (radians). */
  spread: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // Spinfusor: the Tribes disc. Slow, splashy, one per second; a midair direct hit does
  // 770, close to a kill from full health but not quite.
  disc: {
    id: "disc",
    name: "Spinfusor",
    speed: 62,
    inherit: 0.5,
    gravity: 0,
    lifetime: 4,
    radius: 0.3,
    damage: 700,
    splashRadius: 7,
    splashInner: 2,
    splashFalloff: 0.25,
    midairBonus: 1.1,
    selfDamage: 0.35,
    impulse: 14,
    burst: 1,
    burstInterval: 0,
    cooldown: 1.1,
    magazine: 0,
    reload: 0,
    spread: 0,
  },
  // Assault rifle: three-round bursts of fast projectiles, no splash.
  rifle: {
    id: "rifle",
    name: "Assault Rifle",
    speed: 230,
    inherit: 0.3,
    gravity: 0,
    lifetime: 1.4,
    radius: 0.1,
    damage: 80,
    splashRadius: 0,
    splashInner: 0,
    splashFalloff: 1,
    midairBonus: 1,
    selfDamage: 0,
    impulse: 0.4,
    burst: 3,
    burstInterval: 0.075,
    cooldown: 0.3,
    magazine: 24,
    reload: 1.7,
    spread: 0.008,
  },
};

/** A weapon in someone's hands: cooldowns, bursts, ammo and reloading. */
export class WeaponState {
  ammo: number;
  /** Seconds until the next shot may fire. */
  wait = 0;
  /** Shots left in the current burst. */
  burstLeft = 0;
  reloading = 0;

  constructor(public def: WeaponDef) {
    this.ammo = def.magazine;
  }

  get ready(): boolean {
    return this.wait <= 0 && this.reloading <= 0 && this.burstLeft === 0;
  }

  reset(): void {
    this.ammo = this.def.magazine;
    this.wait = this.burstLeft = this.reloading = 0;
  }

  startReload(): void {
    if (this.def.magazine > 0 && this.ammo < this.def.magazine && this.reloading <= 0) {
      this.reloading = this.def.reload;
      this.burstLeft = 0;
    }
  }

  /** Advance by a tick with the trigger held or not; returns how many shots to fire now. */
  tick(held: boolean, dt: number): number {
    const d = this.def;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = d.magazine;
      }
      return 0;
    }
    this.wait -= dt;
    let shots = 0;
    if (this.burstLeft === 0 && held && this.wait <= 0) this.burstLeft = d.burst;
    // Fire as many shots as this tick covers (bursts are faster than some tick rates).
    while (this.burstLeft > 0 && this.wait <= 0) {
      if (d.magazine > 0 && this.ammo <= 0) {
        this.burstLeft = 0;
        this.startReload();
        break;
      }
      shots++;
      if (d.magazine > 0) this.ammo--;
      this.burstLeft--;
      this.wait += this.burstLeft > 0 ? d.burstInterval : d.cooldown;
    }
    if (this.wait < -dt) this.wait = 0;
    if (d.magazine > 0 && this.ammo <= 0 && this.burstLeft === 0) this.startReload();
    return shots;
  }
}
