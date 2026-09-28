import { WEAPONS, WeaponState, type WeaponId } from "./weapons";

export interface HealthSettings {
  maxHealth: number;
  /** Seconds without taking damage before health comes back, and how fast (hp/s). */
  regenDelay: number;
  regenRate: number;
  /** Seconds dead before respawning. */
  respawnTime: number;
  /** Seconds after switching weapons before the new one can fire. */
  switchTime: number;
  /** A weapon put away for this long (s) is reloaded for you. */
  stowedReload: number;
}

export const defaultHealth: HealthSettings = { maxHealth: 900, regenDelay: 8, regenRate: 60, respawnTime: 3, switchTime: 0.4, stowedReload: 3 };

/** One combatant's state: health, weapons, and whether they're alive. */
export class Fighter {
  health: number;
  alive = true;
  /** Seconds until respawn while dead. */
  respawnIn = 0;
  sinceHurt = Infinity;
  readonly weapons: Record<WeaponId, WeaponState>;
  current: WeaponId = "disc";
  /** Seconds left of drawing the current weapon (it can't fire until then). */
  switching = 0;
  /** How long each weapon has been put away (s). */
  private readonly stowed: Record<WeaponId, number> = { disc: 0, rifle: 0 };

  constructor(public settings: HealthSettings = defaultHealth) {
    this.health = settings.maxHealth;
    // The shared definitions, so tuning a weapon changes it for everyone.
    this.weapons = { disc: new WeaponState(WEAPONS.disc), rifle: new WeaponState(WEAPONS.rifle) };
  }

  get weapon(): WeaponState {
    return this.weapons[this.current];
  }

  /** Put the current weapon away and draw another: it takes `switchTime` before it can fire. */
  switchTo(id: WeaponId): boolean {
    if (id === this.current) return false;
    // Putting a weapon away abandons its reload; the stowed timer reloads it later.
    const put = this.weapon;
    put.reloading = 0;
    put.burstLeft = 0;
    this.stowed[this.current] = 0;
    this.current = id;
    this.switching = this.settings.switchTime;
    return true;
  }

  /** Per tick, with the trigger held or not: returns how many shots the weapon in hand fires. */
  tickWeapons(held: boolean, dt: number): number {
    for (const [id, w] of Object.entries(this.weapons) as [WeaponId, WeaponState][]) {
      if (id === this.current) continue;
      // Stowed: cool down, and after a while it's reloaded for you.
      w.wait = Math.max(w.wait - dt, 0);
      this.stowed[id] += dt;
      if (this.stowed[id] >= this.settings.stowedReload && w.def.magazine > 0) w.ammo = w.def.magazine;
    }
    if (this.switching > 0) {
      this.switching = Math.max(this.switching - dt, 0);
      this.weapon.tick(false, dt);
      return 0;
    }
    return this.weapon.tick(held, dt);
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
    this.switching = 0;
    for (const w of Object.values(this.weapons)) w.reset();
  }
}
