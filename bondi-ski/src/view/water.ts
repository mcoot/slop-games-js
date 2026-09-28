import * as THREE from "three";
import type { Terrain } from "../course/data";

/**
 * The Pacific: a big plane at sea level. Depth comes from the terrain heights (as a
 * texture), so it's turquoise over the rock shelves and sand, deep blue further out,
 * with foam where swell meets the shore. Waves are only in the shading.
 */
export function createWater(terrain: Terrain, sunDirection: THREE.Vector3): { mesh: THREE.Mesh; update(time: number): void } {
  const { cols, rows, cell, x0, z0 } = terrain;
  // Water depth in 10 cm steps up to 25.5 m (bytes filter everywhere; floats don't always).
  const bytes = new Uint8Array(cols * rows);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.min(255, Math.max(0, Math.round(-terrain.heights[i]! * 10)));
  const depth = new THREE.DataTexture(bytes, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        depthMap: { value: null },
        terrainOrigin: { value: new THREE.Vector2(x0, z0) },
        terrainSize: { value: new THREE.Vector2((cols - 1) * cell, (rows - 1) * cell) },
        sunDir: { value: sunDirection.clone().normalize() },
        shallow: { value: new THREE.Color("#35c6c9") },
        deep: { value: new THREE.Color("#0c4f86") },
        far: { value: new THREE.Color("#1a5f93") },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform sampler2D depthMap;
      uniform vec2 terrainOrigin, terrainSize;
      uniform vec3 sunDir, shallow, deep, far;
      varying vec3 vWorld;
      #include <fog_pars_fragment>

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      // Sum of travelling waves: returns height and its gradient.
      vec3 waves(vec2 p) {
        vec3 r = vec3(0.0);
        vec2 dirs[4];
        dirs[0] = normalize(vec2(-0.8, 0.6)); dirs[1] = normalize(vec2(-0.5, 0.9));
        dirs[2] = normalize(vec2(-0.95, 0.2)); dirs[3] = normalize(vec2(0.3, 1.0));
        float amp = 0.35, freq = 0.08;
        for (int i = 0; i < 4; i++) {
          float ph = dot(dirs[i], p) * freq + time * (1.2 + float(i) * 0.35);
          r.x += amp * sin(ph);
          r.yz += amp * freq * cos(ph) * dirs[i];
          amp *= 0.55; freq *= 2.1;
        }
        return r;
      }
      void main() {
        vec2 uv = (vWorld.xz - terrainOrigin) / terrainSize;
        bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
        float d = inside ? texture2D(depthMap, uv).r * 25.5 : 12.0;

        vec3 w = waves(vWorld.xz);
        vec2 ripple = vec2(noise(vWorld.xz * 0.9 + time * 0.7), noise(vWorld.xz * 0.9 - time * 0.6)) - 0.5;
        vec3 n = normalize(vec3(-w.y - ripple.x * 0.12, 1.0, -w.z - ripple.y * 0.12));

        vec3 col = mix(shallow, deep, smoothstep(0.5, 9.0, d));
        col = mix(col, far, smoothstep(300.0, 900.0, length(vWorld.xz - cameraPosition.xz)));
        vec3 view = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 4.0);
        col = mix(col, vec3(0.75, 0.88, 0.95), fresnel * 0.6);
        vec3 h = normalize(sunDir + view);
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 180.0) * 1.6;

        // Foam: at the shore, pulsing with the swell, broken up by noise.
        float swell = 0.5 + 0.5 * sin(time * 0.9 - d * 1.6);
        float foam = smoothstep(1.6, 0.0, d) * smoothstep(0.35, 0.75, noise(vWorld.xz * 0.35 + vec2(time * 0.15, 0.0)) * 0.6 + swell * 0.6);
        foam += smoothstep(0.35, 0.0, d);
        col = mix(col, vec3(0.96, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.9);

        gl_FragColor = vec4(col, mix(0.82, 0.96, smoothstep(0.0, 4.0, d)));
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  material.uniforms.depthMap!.value = depth;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), material);
  mesh.position.set(x0 + ((cols - 1) * cell) / 2, 0, z0 + ((rows - 1) * cell) / 2);
  return {
    mesh,
    update(time: number) {
      material.uniforms.time!.value = time;
    },
  };
}
