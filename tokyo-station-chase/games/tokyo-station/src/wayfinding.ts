import * as THREE from "three";
import type { Level, LevelMarker } from "@slop/level-loader";
import type { Navigation, Vec3 } from "@slop/ai";
import { arrowFor, parseSign, signMesh, type Arrow, type SignStyle } from "@slop/signage";
import type { TargetTrain } from "./round/stationRound";
import { destination } from "./round/fares";

/** JR-style wayfinding colours (no logos): yellow for exits and Shinkansen, black for everything else. */
export const SIGN_STYLES: Record<string, SignStyle> = {
  yellow: { background: "#f4c300", text: "#111111", subtext: "#2a2a2a" },
  black: { background: "#17191c", text: "#f4c300", subtext: "#e9e9e9" },
  track: { background: "#17191c", text: "#ffffff", subtext: "#f4c300", border: "#f4c300" },
};

/** Marker names a sign's `to` can refer to: a name prefix, matched against every marker. */
function targetsFor(level: Level, to: string): Vec3[] {
  const out: Vec3[] = [];
  for (const list of level.markers.values()) {
    for (const m of list) if (m.name.startsWith(to)) out.push(m.position);
  }
  return out;
}

/** Arrow on a sign for the route from `from` to the nearest of `targets`. */
function arrowTowards(nav: Navigation, from: Vec3, targets: Vec3[], signForward: { x: number; z: number }): Arrow {
  let best: Vec3[] | null = null;
  let bestLength = Infinity;
  for (const t of targets) {
    const path = nav.path(from, t);
    const end = path.at(-1);
    if (!end || Math.hypot(end.x - t.x, end.z - t.z) > 3) continue;
    let length = 0;
    for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
    if (length < bestLength) {
      bestLength = length;
      best = path;
    }
  }
  if (!best) return "none";
  // First bit of the route that actually goes somewhere.
  const next = best.find((p) => Math.hypot(p.x - from.x, p.z - from.z) > 1.5) ?? best.at(-1)!;
  if (bestLength < 2.5) return "none"; // you're there
  return arrowFor(signForward, { x: next.x - from.x, z: next.z - from.z });
}

/** A sign's spec and the arrows for each side, from the navmesh route under it. */
export function signArrows(level: Level, nav: Navigation, marker: LevelMarker) {
  const spec = parseSign(marker.object.userData);
  if (!spec) return null;
  const forward = { x: -Math.sin(marker.yaw), z: -Math.cos(marker.yaw) };
  const floor = nav.closestPoint({ x: marker.position.x, y: marker.position.y - 2.5, z: marker.position.z }) ?? marker.position;
  const arrows = (dir: { x: number; z: number }) =>
    spec.rows.map((row) => (row.to ? arrowTowards(nav, floor, targetsFor(level, row.to), dir) : "none"));
  return { spec, front: arrows(forward), back: arrows({ x: -forward.x, z: -forward.z }) };
}

/**
 * Build every `sign` marker in the level. Each row's arrow follows the navmesh route
 * from the floor under the sign to the row's destination, separately for each side.
 */
export function buildSigns(level: Level, nav: Navigation): THREE.Group {
  const group = new THREE.Group();
  group.name = "signs";
  for (const marker of level.markers.get("sign") ?? []) {
    const resolved = signArrows(level, nav, marker);
    if (!resolved) continue;
    const style = SIGN_STYLES[resolved.spec.style] ?? SIGN_STYLES.black!;
    const mesh = signMesh(resolved.spec, style, { front: resolved.front, back: resolved.back });
    placeAt(mesh, marker);
    group.add(mesh);
  }
  return group;
}

function placeAt(obj: THREE.Object3D, marker: LevelMarker) {
  obj.position.set(marker.position.x, marker.position.y, marker.position.z);
  obj.rotation.y = marker.yaw;
}

// --- Departure boards.

export interface Departure {
  /** Minutes since midnight. */
  time: number;
  service: { ja: string; en: string };
  number: number;
  destination: string;
  track: number;
}

const NOZOMI = { ja: "のぞみ", en: "Nozomi" };
const HIKARI = { ja: "ひかり", en: "Hikari" };
const KODAMA = { ja: "こだま", en: "Kodama" };

/** A plausible (made-up) afternoon of Tōkaidō departures, including the round's target train. */
export function timetable(target: TargetTrain, departsInSeconds: number): Departure[] {
  const targetTime = target.clockStart + Math.round(departsInSeconds / 60);
  const others: Departure[] = [
    { time: 14 * 60 + 21, service: NOZOMI, number: 225, destination: "shin-osaka", track: 15 },
    { time: 14 * 60 + 27, service: KODAMA, number: 719, destination: "nagoya", track: 16 },
    { time: 14 * 60 + 30, service: NOZOMI, number: 227, destination: "shin-osaka", track: 17 },
    { time: 14 * 60 + 36, service: NOZOMI, number: 229, destination: "shin-osaka", track: 18 },
    { time: 14 * 60 + 39, service: KODAMA, number: 721, destination: "shizuoka", track: 16 },
    { time: 14 * 60 + 42, service: NOZOMI, number: 231, destination: "shin-osaka", track: 15 },
    { time: 14 * 60 + 45, service: HIKARI, number: 641, destination: "nagoya", track: 14 },
  ];
  const [ja, en] = [target.name.ja.replace(/[0-9０-９]+号$/, ""), target.name.en.replace(/\s*\d+$/, "")];
  const number = Number(target.name.en.match(/\d+/)?.[0] ?? 0);
  return [...others, { time: targetTime, service: { ja, en }, number, destination: target.destination, track: target.track }].sort(
    (a, b) => a.time - b.time,
  );
}

export interface BoardRow {
  time: string;
  train: string;
  destination: string;
  track: string;
  /** "departing" in the last minute before it leaves. */
  status: "" | "departing";
}

/** The next `count` departures at a station clock time (seconds since midnight). */
export function departureBoard(clockSeconds: number, departures: Departure[], count = 4): BoardRow[] {
  return departures
    .filter((d) => d.time * 60 > clockSeconds)
    .slice(0, count)
    .map((d) => {
      const dest = destination(d.destination);
      return {
        time: `${Math.floor(d.time / 60)}:${String(d.time % 60).padStart(2, "0")}`,
        train: `${d.service.ja}${d.number}号 ${d.service.en} ${d.number}`,
        destination: `${dest.ja} ${dest.en}`,
        track: `${d.track}番線 ${d.track}`,
        status: d.time * 60 - clockSeconds <= 60 ? "departing" : "",
      };
    });
}

/** A departure board mesh that redraws when its rows change. */
export class DepartureBoard {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private last = "";
  private blink = false;

  constructor(
    marker: LevelMarker,
    private readonly departures: Departure[],
  ) {
    const width = Number(marker.object.userData.width) || 3.2;
    const height = Number(marker.object.userData.height) || 1.2;
    this.canvas.width = Math.round(width * 320);
    this.canvas.height = Math.round(height * 320);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    // Plane faces +Z; the board faces the marker's forward (-Z).
    const holder = new THREE.Group();
    this.mesh.rotation.y = Math.PI;
    holder.add(this.mesh);
    const back = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    back.position.z = 0.06;
    holder.add(back);
    placeAt(holder, marker);
    this.mesh.userData.holder = holder;
  }

  get object(): THREE.Object3D {
    return this.mesh.userData.holder as THREE.Object3D;
  }

  update(clockSeconds: number): void {
    this.blink = Math.floor(clockSeconds * 2) % 2 === 0;
    const rows = departureBoard(clockSeconds, this.departures);
    const key = JSON.stringify(rows) + this.blink;
    if (key === this.last) return;
    this.last = key;
    this.draw(rows);
    this.texture.needsUpdate = true;
  }

  private draw(rows: BoardRow[]): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.canvas.getContext("2d")!;
    const font = `"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
    ctx.fillStyle = "#07090b";
    ctx.fillRect(0, 0, w, h);
    const headH = h * 0.16;
    ctx.fillStyle = "#123c7a";
    ctx.fillRect(0, 0, w, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(headH * 0.55)}px ${font}`;
    ctx.textBaseline = "middle";
    ctx.fillText("新幹線 のりば  Shinkansen departures", w * 0.02, headH / 2);
    const rowH = (h - headH) / 4;
    const cols = [0.02, 0.14, 0.5, 0.8];
    rows.forEach((r, i) => {
      const y = headH + rowH * (i + 0.5);
      const departing = r.status === "departing";
      ctx.fillStyle = departing ? (this.blink ? "#ff6a3d" : "#7a2a14") : "#ffb200";
      ctx.font = `700 ${Math.round(rowH * 0.42)}px ${font}`;
      ctx.fillText(r.time, w * cols[0]!, y);
      ctx.fillText(r.train, w * cols[1]!, y, w * 0.34);
      ctx.fillStyle = departing ? ctx.fillStyle : "#7cf07c";
      ctx.fillText(r.destination, w * cols[2]!, y, w * 0.28);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(departing ? "発車 Departing" : r.track, w * cols[3]!, y, w * 0.19);
    });
  }
}
