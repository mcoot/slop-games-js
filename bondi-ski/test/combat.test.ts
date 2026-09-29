import { describe, expect, it } from "vitest";
import { RAPIER, createPhysicsWorld } from "@slop/physics";
import { blastOn, type Target } from "../src/combat/damage";
import { Fighter } from "../src/combat/fighter";
import { Projectiles, launchVelocity, type Impact } from "../src/combat/projectiles";
import { WEAPONS, WeaponState } from "../src/combat/weapons";

const DT = 0.015;
const target = (over: Partial<Target> = {}): Target => ({ id: "t", feet: { x: 0, y: 0, z: 0 }, height: 1.83, radius: 0.4, airborne: false, ...over });

describe("weapons", () => {
  it("fires a disc about once a second while the trigger is held", () => {
    const w = new WeaponState({ ...WEAPONS.disc });
    let shots = 0;
    for (let i = 0; i < 3 / DT; i++) shots += w.tick(true, DT);
    expect(shots).toBe(3);
  });

  it("fires the rifle in bursts of three, then reloads an empty magazine", () => {
    const w = new WeaponState({ ...WEAPONS.rifle });
    const times: number[] = [];
    for (let i = 0; i < 0.5 / DT; i++) if (w.tick(true, DT) > 0) times.push(i * DT);
    // First burst: three shots within ~0.2 s, then a pause.
    expect(times.filter((t) => t < 0.2)).toHaveLength(3);
    let fired = 0;
    const w2 = new WeaponState({ ...WEAPONS.rifle });
    for (let i = 0; i < 3.7 / DT; i++) fired += w2.tick(true, DT);
    // 24 rounds in eight bursts, then a reload...
    expect(fired).toBe(24);
    expect(w2.reloading).toBeGreaterThan(0);
    for (let i = 0; i < 2.5 / DT; i++) fired += w2.tick(true, DT);
    // ...then more.
    expect(fired).toBeGreaterThan(24);
  });
});

describe("switching weapons", () => {
  it("takes a moment before the new weapon fires", () => {
    const f = new Fighter();
    f.switchTo("rifle");
    let first = -1;
    for (let i = 0; i < 1 / DT && first < 0; i++) if (f.tickWeapons(true, DT) > 0) first = i * DT;
    expect(first).toBeGreaterThanOrEqual(f.settings.switchTime - DT);
    expect(first).toBeLessThan(f.settings.switchTime + 0.05);
  });

  it("reloads a weapon that's been put away for a few seconds", () => {
    const f = new Fighter();
    f.switchTo("rifle");
    for (let i = 0; i < 1.5 / DT; i++) f.tickWeapons(true, DT);
    const left = f.weapon.ammo;
    expect(left).toBeLessThan(24);
    f.switchTo("disc");
    for (let i = 0; i < 2 / DT; i++) f.tickWeapons(false, DT);
    expect(f.weapons.rifle.ammo).toBe(left);
    for (let i = 0; i < 1.2 / DT; i++) f.tickWeapons(false, DT);
    expect(f.weapons.rifle.ammo).toBe(24);
  });
});

describe("inheritance", () => {
  it("adds a share of your velocity to a shot, whichever way you're going", () => {
    const aim = { x: 0, y: 0, z: -1 };
    const moving = { x: 20, y: 4, z: -30 };
    for (const [w, share] of [[WEAPONS.disc, 0.5], [WEAPONS.rifle, 0.3], [WEAPONS.grenade, 0.5]] as const) {
      const v = launchVelocity(w, aim, moving, () => 0.5);
      expect(w.inherit).toBe(share);
      expect(v.x).toBeCloseTo(20 * share);
      expect(v.y).toBeCloseTo(4 * share);
      expect(v.z).toBeCloseTo(-w.speed - 30 * share);
    }
  });
});

describe("grenades", () => {
  it("three per life, thrown one press at a time, restocked on respawn", () => {
    const f = new Fighter();
    let thrown = 0;
    for (let i = 0; i < 10 / DT; i++) thrown += f.tickGrenade(i % 20 === 0, DT);
    expect(thrown).toBe(3);
    f.hurt(5000);
    f.respawn();
    expect(f.grenades.ammo).toBe(3);
  });
});

describe("damage", () => {
  const disc = WEAPONS.disc;
  it("a direct disc hit takes most of someone's health; a midair takes 770, nearly all of it", () => {
    const standing = blastOn(disc, { x: 0, y: 1, z: 0.4 }, target(), true, false)!;
    const midair = blastOn(disc, { x: 0, y: 1, z: 0.4 }, target({ airborne: true }), true, false)!;
    expect(standing.damage).toBe(700);
    expect(midair.midair).toBe(true);
    expect(midair.damage).toBe(770);
  });

  it("splash falls off with distance and stops at the blast radius", () => {
    const near = blastOn(disc, { x: 1.5, y: 0.5, z: 0 }, target(), false, false)!;
    const far = blastOn(disc, { x: 6, y: 0.5, z: 0 }, target(), false, false)!;
    expect(near.damage).toBeGreaterThan(far.damage);
    expect(far.damage).toBeGreaterThan(0);
    expect(blastOn(disc, { x: 9, y: 0.5, z: 0 }, target(), false, false)).toBeNull();
  });

  it("splash does full damage inside the inner radius, then falls off linearly to the edge", () => {
    const w = { ...disc, damage: 400, splashRadius: 6, splashInner: 2, splashFalloff: 0.25 };
    const r = target().radius;
    // `dist` is measured from the blast to the surface of their capsule.
    const at = (dist: number) => blastOn(w, { x: dist + r, y: 1, z: 0 }, target(), false, false)!.damage;
    expect(at(0.5)).toBe(400);
    expect(at(1.9)).toBe(400);
    expect(at(4)).toBe(Math.round(400 * (1 - 0.5 * 0.75)));
    expect(at(5)).toBe(175);
  });

  it("your own disc barely hurts but throws you (disc jumping)", () => {
    const own = blastOn(disc, { x: 0, y: -0.2, z: 0 }, target(), false, true)!;
    expect(own.damage).toBeLessThan(300);
    expect(own.impulse.y).toBeGreaterThan(10);
  });

  it("your own disc throws you harder than the same blast throws someone else", () => {
    const at = { x: 0.6, y: 0.3, z: 0 };
    const own = blastOn(disc, at, target(), false, true)!;
    const other = blastOn(disc, at, target(), false, false)!;
    expect(own.impulse.x / other.impulse.x).toBeCloseTo(disc.selfImpulse);
    expect(disc.selfImpulse).toBeGreaterThan(1);
  });

  it("dies at zero health, respawns after a few seconds, regenerates after a while", () => {
    const f = new Fighter();
    expect(f.hurt(500)).toBe(false);
    for (let i = 0; i < 10 / DT; i++) f.tick(DT);
    expect(f.health).toBeGreaterThan(400);
    expect(f.hurt(2000)).toBe(true);
    expect(f.alive).toBe(false);
    let respawned = false;
    for (let i = 0; i < 4 / DT && !respawned; i++) respawned = f.tick(DT);
    expect(respawned).toBe(true);
  });
});

describe("projectiles", () => {
  it("fly, hit the ground or a target, and inherit the shooter's velocity", async () => {
    const world = await createPhysicsWorld();
    world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0));
    world.step();
    const p = new Projectiles(world, () => false);
    // Straight at a target 30 m away.
    const t = target({ feet: { x: 0, y: 0, z: -30 } });
    p.spawn({ id: "a", owner: "me", weapon: WEAPONS.disc, pos: { x: 0, y: 1, z: 0 }, vel: launchVelocity(WEAPONS.disc, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }) });
    let impacts: Impact[] = [];
    for (let i = 0; i < 2 / DT && impacts.length === 0; i++) impacts = p.step(DT, [t]);
    expect(impacts[0]!.target?.id).toBe("t");
    // Down into the ground.
    p.spawn({ id: "b", owner: "me", weapon: WEAPONS.disc, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: -60, z: 0 } });
    impacts = [];
    for (let i = 0; i < 1 / DT && impacts.length === 0; i++) impacts = p.step(DT, []);
    expect(impacts[0]!.target).toBeNull();
    expect(impacts[0]!.point.y).toBeCloseTo(0, 1);
    const v = launchVelocity(WEAPONS.disc, { x: 0, y: 0, z: -1 }, { x: 20, y: 0, z: 0 });
    expect(v.x).toBeCloseTo(20 * WEAPONS.disc.inherit);
  });
});
