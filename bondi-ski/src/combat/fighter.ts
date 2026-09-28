import { WEAPONS, WeaponState, type WeaponId } from "./weapons";

export interface HealthSettings {
  maxHealth: number;
  /** Seconds without taking damage before health comes back, and how fast (hp/s). */
  regenDelay: number;
  regenRate: number;
  /** Seconds dead before respawning. */
  respawnTime: number;
}

export const defaultHealth: HealthSettings = { maxHealth: 900, regenDelay: 8, regenRate: 60, respawnTime: 3 };

/** One combatant's state: health, weapons, and whether they're alive. */
export class Fighter {
  health: number;
  alive = true;
  /** Seconds until respawn while dead. */
  respawnIn = 0;
  sinceHurt = Infinity;
  readonly weapons: Record<WeaponId, WeaponState>;
  current: WeaponId = "disc";

  constructor(public settings: HealthSettings = defaultHealth) {
    this.health = settings.maxHealth;
    // The shared definitions, so tuning a weapon changes it for everyone.
    this.weapons = { disc: new WeaponState(WEAPONS.disc), rifle: new WeaponState(WEAPONS.rifle) };
  }

  get weapon(): WeaponState {
    return this.weapons[this.current];
  }

  /** Take damage; returns true if this killed them. */
  hurt(amount: number): boolean {
    if (!this.alive || amount <= 0) return false;
    this.health = Math.max(this.health - amount, 0);
    this.sinceHurt = 0;
    if (this.health <= 0) {
      this.alive = false;
      this.respawnIn = this.settings.respawnTime;
      return true;
    }
    return false;
  }

  /** Per tick: regeneration and the respawn countdown. Returns true when it's time to respawn. */
  tick(dt: number): boolean {
    if (!this.alive) {
      this.respawnIn -= dt;
      return this.respawnIn <= 0;
    }
    this.sinceHurt += dt;
    if (this.sinceHurt > this.settings.regenDelay) {
      this.health = Math.min(this.health + this.settings.regenRate * dt, this.settings.maxHealth);
    }
    return false;
  }

  respawn(): void {
    this.alive = true;
    this.health = this.settings.maxHealth;
    this.sinceHurt = Infinity;
    for (const w of Object.values(this.weapons)) w.reset();
  }
}
