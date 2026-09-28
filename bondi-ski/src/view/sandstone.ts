import * as THREE from "three";

/**
 * Hawkesbury sandstone in a shader: horizontal bands of cream, ochre and rust that
 * wander a little, with a fine grain, computed from world position per pixel so even
 * big flat triangles (the cliffs) read as layered rock.
 *
 * `amount` is where to apply it: 1 everywhere, or per vertex from a `rock` attribute.
 */
export function sandstoneMaterial(options: { perVertex: boolean; vertexColors?: boolean }): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: options.vertexColors ?? false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vStrataPos;
        ${options.perVertex ? "attribute float rock; varying float vRock;" : ""}`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vStrataPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        ${options.perVertex ? "vRock = rock;" : ""}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vStrataPos;
        ${options.perVertex ? "varying float vRock;" : ""}
        float strataHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float strataNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(strataHash(i), strataHash(i + vec2(1, 0)), u.x), mix(strataHash(i + vec2(0, 1)), strataHash(i + vec2(1, 1)), u.x), u.y);
        }
        vec3 strata(vec3 p) {
          float wander = strataNoise(p.xz * 0.05) * 3.0 + strataNoise(p.xz * 0.21) * 0.8;
          float y = p.y + wander;
          float band = sin(y * 1.1) * 0.5 + 0.5;
          float thin = smoothstep(0.82, 1.0, sin(y * 4.3 + 1.7));
          float grain = strataNoise(p.xz * 1.7 + p.y * 2.3) * 0.5 + strataNoise(vec2(p.x + p.z, p.y) * 5.0) * 0.5;
          vec3 cream = vec3(0.93, 0.79, 0.57);
          vec3 ochre = vec3(0.84, 0.56, 0.3);
          vec3 rust = vec3(0.6, 0.3, 0.16);
          vec3 c = mix(ochre, cream, band);
          c = mix(c, rust, thin * 0.55);
          // Honeycomb weathering (tafoni): clusters of small dark hollows, thicker in
          // some bands than others.
          vec2 hp = vec2(p.x + p.z * 0.7, p.y * 1.6) * 1.3;
          vec2 cell = floor(hp);
          vec2 f = fract(hp) - 0.5;
          float r = strataHash(cell) * 0.25 + 0.18;
          float pit = smoothstep(r, r - 0.08, length(f + (vec2(strataHash(cell + 7.1), strataHash(cell + 3.3)) - 0.5) * 0.3));
          float where = smoothstep(0.45, 0.8, strataNoise(p.xz * 0.08 + p.y * 0.15)) * (0.4 + band * 0.6);
          c *= 1.0 - pit * where * 0.45;
          return c * (0.88 + grain * 0.2);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, strata(vStrataPos), ${options.perVertex ? "vRock" : "1.0"});`,
      );
  };
  return material;
}
