import * as THREE from "three";

/** A gradient sky dome with a soft sun, drawn behind everything and following the camera. */
export function createSky(sunDirection: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: sunDirection.clone().normalize() },
      zenith: { value: new THREE.Color("#2f7fd8") },
      horizon: { value: new THREE.Color("#bfe3f5") },
      haze: { value: new THREE.Color("#f7e6c8") },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, zenith, horizon, haze;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        float s = max(dot(d, sunDir), 0.0);
        col = mix(col, haze, pow(s, 6.0) * 0.45 * (1.0 - max(h, 0.0)));
        col += vec3(1.0, 0.95, 0.8) * (pow(s, 900.0) * 4.0 + pow(s, 60.0) * 0.25);
        // Below the horizon: fade to the sea's far colour.
        col = mix(col, vec3(0.16, 0.42, 0.6), smoothstep(0.0, -0.08, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.scale.setScalar(3000);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  return sky;
}
