import * as THREE from "three";
import { WALL_SEGMENTS } from "../course/physics";

/** Across one hexagon of the pattern (m, roughly: adjusted so the ring closes without a seam). */
const HEX_SIZE = 3.5;

/**
 * An arena's force-field wall, Tribes: Ascend style: nearly invisible from across the
 * arena (a faint hex grid, so you can see where it is), lighting up as you get close.
 */
export class ForceField {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(centre: { x: number; z: number }, radius: number, bottom: number, top: number) {
    const height = top - bottom;
    const ring = 2 * Math.PI * radius;
    const hex = ring / Math.round(ring / HEX_SIZE);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPlayer: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector2(centre.x, centre.z) },
        uRadius: { value: radius },
        uHex: { value: hex },
        uTop: { value: top },
        uColour: { value: new THREE.Color("#7fe3ff") },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uPlayer;
        uniform float uTime;
        uniform vec2 uCentre;
        uniform float uRadius;
        uniform float uHex;
        uniform float uTop;
        uniform vec3 uColour;
        varying vec3 vWorld;

        // Distance from p to the nearest edge of a unit hex grid (0 on an edge).
        float hexEdge(vec2 p) {
          vec2 r = vec2(1.0, 1.7320508);
          vec2 h = r * 0.5;
          vec2 a = mod(p, r) - h;
          vec2 b = mod(p - h, r) - h;
          vec2 g = dot(a, a) < dot(b, b) ? a : b;
          vec2 q = abs(g);
          return 0.5 - max(dot(q, vec2(0.5, 0.8660254)), q.x);
        }

        void main() {
          // Unroll the wall: arc length round the ring, and height.
          float arc = atan(vWorld.z - uCentre.y, vWorld.x - uCentre.x) * uRadius;
          vec2 p = vec2(arc, vWorld.y) / uHex;
          float edge = hexEdge(p);
          // Thin lines, fading out with distance before they shimmer into noise.
          float w = fwidth(edge);
          float lines = (1.0 - smoothstep(0.0, 0.03 + w, edge)) * (1.0 - smoothstep(0.15, 0.4, w));
          float d = distance(vWorld, uPlayer);
          float near = 1.0 - smoothstep(4.0, 38.0, d);
          float shimmer = 0.85 + 0.15 * sin(uTime * 2.2 + vWorld.y * 0.35 + arc * 0.08);
          float alpha = 0.015 + lines * 0.03 + near * (0.05 + lines * 0.4) * shimmer;
          // Fade out towards the top so it doesn't end in a hard line in the sky.
          alpha *= 1.0 - smoothstep(uTop - 25.0, uTop, vWorld.y);
          gl_FragColor = vec4(uColour * (0.7 + near * 0.6), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const geom = new THREE.CylinderGeometry(radius, radius, height, WALL_SEGMENTS * 2, 1, true);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.set(centre.x, bottom + height / 2, centre.z);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  /** Light the wall up around the player. */
  update(player: THREE.Vector3, time: number): void {
    this.material.uniforms.uPlayer!.value.copy(player);
    this.material.uniforms.uTime!.value = time;
  }
}
