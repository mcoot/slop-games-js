import * as THREE from "three";

/**
 * Wayfinding signs placed in Blender as empties with `type` = "sign" and flat custom
 * properties (glTF extras):
 *
 *   style         a style name the game defines (e.g. "yellow", "black")
 *   width, height size in metres (default 2.4 x 0.6)
 *   double_sided  true for signs hanging over a corridor
 *   row1_ja, row1_en, row1_to    first line: Japanese, English, and what it points to
 *   row2_ja, row2_en, row2_to    optional second line
 *
 * The sign's face points along the empty's forward axis (+Y in Blender). `to` names a
 * destination the game resolves (e.g. a marker-name prefix); the game then picks each
 * row's arrow from the route there, per side for double-sided signs, so signs stay
 * right when the layout changes.
 */
export type Arrow = "up" | "left" | "right" | "down" | "none";

export interface SignRow {
  ja: string;
  en: string;
  /** Destination to point at (resolved by the game), or "" for no arrow. */
  to: string;
}

export interface SignSpec {
  style: string;
  width: number;
  height: number;
  doubleSided: boolean;
  rows: SignRow[];
}

export function parseSign(props: Record<string, unknown>): SignSpec | null {
  const rows: SignRow[] = [];
  for (let i = 1; i <= 4; i++) {
    const ja = str(props[`row${i}_ja`]);
    const en = str(props[`row${i}_en`]);
    if (!ja && !en) continue;
    rows.push({ ja, en, to: str(props[`row${i}_to`]) });
  }
  if (rows.length === 0) return null;
  return {
    style: str(props.style) || "black",
    width: num(props.width, 2.4),
    height: num(props.height, 0.6),
    doubleSided: props.double_sided === true || props.double_sided === 1 || props.double_sided === "true",
    rows,
  };
}

/**
 * Which arrow tells a reader to go in `direction`. The reader faces the sign, so
 * straight on is `-signForward`. Directions are on the ground plane (x, z).
 */
export function arrowFor(signForward: { x: number; z: number }, direction: { x: number; z: number }): Arrow {
  const len = Math.hypot(direction.x, direction.z);
  if (len < 1e-6) return "none";
  // Reader's forward and right (three.js: right = forward rotated -90° about Y).
  const fx = -signForward.x;
  const fz = -signForward.z;
  const rx = -fz;
  const rz = fx;
  const ahead = (direction.x * fx + direction.z * fz) / len;
  const right = (direction.x * rx + direction.z * rz) / len;
  if (ahead >= Math.abs(right)) return "up";
  if (-ahead >= Math.abs(right)) return "down";
  return right > 0 ? "right" : "left";
}

export interface SignStyle {
  background: string;
  text: string;
  /** Secondary (English) text colour. */
  subtext: string;
  border?: string;
  font?: string;
}

/** Draw one side of a sign. Rows are stacked; each has an arrow box on the side it points. */
export function drawSign(rows: (SignRow & { arrow: Arrow })[], style: SignStyle, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const font = style.font ?? `"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif`;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);
  if (style.border) {
    ctx.strokeStyle = style.border;
    ctx.lineWidth = height * 0.03;
    ctx.strokeRect(0, 0, width, height);
  }
  const rowH = height / rows.length;
  rows.forEach((row, i) => {
    const top = i * rowH;
    const pad = rowH * 0.12;
    const arrowBox = row.arrow === "none" ? 0 : rowH - pad * 2;
    const arrowLeft = row.arrow === "left";
    const textX = pad + (arrowLeft ? arrowBox + pad : 0);
    const textW = width - pad * 2 - (arrowBox ? arrowBox + pad : 0);
    if (i > 0) {
      ctx.fillStyle = style.subtext;
      ctx.fillRect(pad, top, width - pad * 2, Math.max(1, height * 0.01));
    }
    // Japanese large, English below.
    ctx.fillStyle = style.text;
    ctx.textBaseline = "alphabetic";
    fitText(ctx, row.ja, textX, top + rowH * 0.56, textW, `700 ${Math.round(rowH * 0.42)}px ${font}`);
    ctx.fillStyle = style.subtext;
    fitText(ctx, row.en, textX, top + rowH * 0.88, textW, `600 ${Math.round(rowH * 0.24)}px ${font}`);
    if (arrowBox) {
      const ax = arrowLeft ? pad : width - pad - arrowBox;
      drawArrow(ctx, row.arrow, ax, top + pad, arrowBox, style.text);
    }
  });
  return canvas;
}

/** A sign as a mesh: one plane, or two back to back (each drawn for its own side). */
export function signMesh(
  spec: SignSpec,
  style: SignStyle,
  arrows: { front: Arrow[]; back?: Arrow[] },
  pixelsPerMetre = 200,
): THREE.Group {
  const group = new THREE.Group();
  const w = Math.round(spec.width * pixelsPerMetre);
  const h = Math.round(spec.height * pixelsPerMetre);
  const side = (arrowList: Arrow[], flip: boolean) => {
    const canvas = drawSign(spec.rows.map((r, i) => ({ ...r, arrow: arrowList[i] ?? "none" })), style, w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.width, spec.height),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    );
    // PlaneGeometry faces +Z; the sign faces the marker's forward (-Z).
    mesh.rotation.y = flip ? 0 : Math.PI;
    mesh.position.z = flip ? 0.01 : -0.01;
    mesh.userData.collider = "none";
    group.add(mesh);
  };
  side(arrows.front, false);
  if (spec.doubleSided) side(arrows.back ?? arrows.front, true);
  // Backing box so a single-sided sign isn't paper-thin from behind.
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width + 0.04, spec.height + 0.04, 0.012),
    new THREE.MeshBasicMaterial({ color: 0x222222 }),
  );
  backing.userData.collider = "none";
  group.add(backing);
  return group;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, font: string) {
  if (!text) return;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  if (w > maxWidth) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxWidth / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(text, x, y);
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, arrow: Arrow, x: number, y: number, size: number, color: string) {
  const angle = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2, none: 0 }[arrow];
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  const s = size * 0.42;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.85, s * 0.05);
  ctx.lineTo(s * 0.28, s * 0.05);
  ctx.lineTo(s * 0.28, s);
  ctx.lineTo(-s * 0.28, s);
  ctx.lineTo(-s * 0.28, s * 0.05);
  ctx.lineTo(-s * 0.85, s * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
