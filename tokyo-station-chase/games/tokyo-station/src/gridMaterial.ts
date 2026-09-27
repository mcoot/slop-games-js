import * as THREE from "three";

/** The grid pattern, applied to `diffuseColor` in the fragment shader. Needs vGridPos and vGridNormal. */
const GRID = `{
  vec3 n = abs(vGridNormal);
  vec2 p = n.y > n.x && n.y > n.z ? vGridPos.xz : (n.x > n.z ? vGridPos.zy : vGridPos.xy);
  vec2 fw = fwidth(p);
  vec2 g1 = abs(fract(p - 0.5) - 0.5) / fw;
  vec2 g5 = abs(fract(p / 5.0 - 0.5) - 0.5) / fwidth(p / 5.0);
  float line1 = 1.0 - min(min(g1.x, g1.y), 1.0);
  float line5 = 1.0 - min(min(g5.x, g5.y) * 0.5, 1.0);
  diffuseColor.rgb *= 1.0 - 0.18 * line1 - 0.3 * line5;
}`;

/**
 * Greybox material: flat colour with a world-space 1 m / 5 m grid, so distances
 * and speed read clearly without any textures or UVs. Lit by the scene's lights.
 */
export function gridMaterial(color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGridNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;")
      .replace("#include <color_fragment>", `#include <color_fragment>\n${GRID}`);
  };
  return mat;
}

/**
 * The same grid, lit only by a baked lightmap (on the second UV set): unlit and cheap,
 * so static geometry costs no real-time lights at all.
 */
export function bakedGridMaterial(color: THREE.ColorRepresentation, lightMap: THREE.Texture, intensity: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color, lightMap, lightMapIntensity: intensity });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGridPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGridPos;")
      // Basic materials have no normals: take the face normal from screen-space derivatives.
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nvec3 vGridNormal = normalize(cross(dFdx(vGridPos), dFdy(vGridPos)));\n${GRID}`,
      );
  };
  return mat;
}
