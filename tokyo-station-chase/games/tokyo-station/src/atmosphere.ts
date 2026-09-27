import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import { LightmapProbe, hasLightmapUv, lightmapIntensity, type Level } from "@slop/level-loader";
import { bakedGridMaterial, gridMaterial } from "./gridMaterial";
import { surfaceColors, type Surface } from "./levels/surfaces";

export interface AtmosphereSettings {
  /** Overall exposure (tone mapping). */
  exposure: number;
  /** Brightness of the baked lighting. */
  bakedLight: number;
  /** How hard the light fixtures glow (and bloom). */
  fixtureGlow: number;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  /** Indoor haze (exponential fog density). */
  haze: number;
}

export const defaultAtmosphere: AtmosphereSettings = {
  exposure: 1.1,
  bakedLight: 1,
  fixtureGlow: 4,
  bloom: true,
  bloomStrength: 0.45,
  bloomThreshold: 0.9,
  haze: 0.008,
};

/** Where the baked sun comes from (matches tools/blender/bake_lightmap.py). */
const SUN_DIRECTION = new THREE.Vector3(0.439, 0.643, 0.627).normalize();

/**
 * How the level is lit and finished. With a baked lightmap: static geometry is unlit
 * and multiplied by the bake (no real-time lights or shadows to pay for), fixtures
 * glow and bloom, and moving things get a hemisphere light tinted by the bake around
 * the player. Without one (the older levels): the original sun-and-sky lighting.
 */
export class Atmosphere {
  readonly settings: AtmosphereSettings;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly hemi = new THREE.HemisphereLight(0xeef3ff, 0x6b6250, 1.6);
  private readonly sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  private readonly sky = new Sky();
  private readonly fog = new THREE.FogExp2(0x4d535a, 0.011);
  private readonly materials = new Map<string, THREE.Material>();
  private baked: THREE.MeshBasicMaterial[] = [];
  private fixtures: THREE.MeshBasicMaterial[] = [];
  private probe: LightmapProbe | null = null;
  private probeTimer = 0;
  private readonly ambient = new THREE.Color(1, 1, 1);
  private readonly ambientTarget = new THREE.Color(1, 1, 1);
  private lit = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    settings: AtmosphereSettings = { ...defaultAtmosphere },
  ) {
    this.settings = settings;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(60);
    this.sun.target.position.set(0, 0, -40);
    this.sun.position.add(this.sun.target.position);
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 200 });
    this.sun.shadow.bias = -0.0005;
    scene.add(this.hemi, this.sun, this.sun.target);

    this.sky.scale.setScalar(350);
    const u = this.sky.material.uniforms;
    u.turbidity!.value = 4;
    u.rayleigh!.value = 1.2;
    u.mieCoefficient!.value = 0.004;
    u.mieDirectionalG!.value = 0.8;
    u.sunPosition!.value.copy(SUN_DIRECTION);
    scene.add(this.sky);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.35, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.apply();
  }

  /**
   * Set up materials for a freshly loaded level. Meshes with a `surface` get the grid
   * material (baked if the level has a lightmap and the mesh has lightmap UVs);
   * fixtures (`emissive`) glow.
   */
  dress(level: Level, lightmap: THREE.Texture | null): void {
    this.baked = [];
    this.fixtures = [];
    this.materials.clear();
    this.lit = lightmap === null;
    level.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const emissive = obj.userData.emissive;
      if (typeof emissive === "string") {
        const mat = this.material(`fixture ${emissive}`, () => {
          const m = new THREE.MeshBasicMaterial({ color: emissive, fog: false });
          m.userData.base = new THREE.Color(emissive);
          this.fixtures.push(m);
          return m;
        });
        obj.material = mat;
        return;
      }
      const surface = obj.userData.surface as Surface | undefined;
      if (!surface || !(surface in surfaceColors)) return;
      if (lightmap && hasLightmapUv(obj)) {
        obj.material = this.material(`baked ${surface}`, () => {
          const m = bakedGridMaterial(surfaceColors[surface], lightmap, lightmapIntensity());
          this.baked.push(m);
          return m;
        });
      } else {
        obj.material = this.material(`lit ${surface}`, () => gridMaterial(surfaceColors[surface]));
        obj.castShadow = surface !== "floor";
        obj.receiveShadow = true;
      }
    });
    this.probe = lightmap ? new LightmapProbe(lightmap, level.solids) : null;
    this.apply();
  }

  /** Re-read the settings (after tuning). */
  apply(): void {
    const s = this.settings;
    this.renderer.toneMappingExposure = s.exposure;
    for (const m of this.baked) m.lightMapIntensity = lightmapIntensity(s.bakedLight);
    for (const m of this.fixtures) m.color.copy(m.userData.base as THREE.Color).multiplyScalar(s.fixtureGlow);
    this.bloom.enabled = s.bloom;
    this.bloom.strength = s.bloomStrength;
    this.bloom.threshold = s.bloomThreshold;
    this.fog.density = s.haze;
    this.renderer.shadowMap.enabled = this.lit;
    this.sun.castShadow = this.lit;
    if (this.lit) {
      // Original daylight greybox.
      this.scene.fog = new THREE.Fog(0xc9d6e3, 60, 180);
      this.scene.background = new THREE.Color(0xc9d6e3);
      this.sky.visible = false;
      this.hemi.intensity = 1.6;
      this.hemi.color.set(0xeef3ff);
      this.sun.intensity = 1.8;
    } else {
      this.scene.fog = this.fog;
      this.scene.background = null;
      this.sky.visible = true;
      this.sun.intensity = 0.4;
    }
  }

  /** Per frame: follow the baked light around the player for moving things. */
  update(frameDt: number): void {
    if (this.probe) {
      this.probeTimer -= frameDt;
      if (this.probeTimer <= 0) {
        this.probeTimer = 0.2;
        const c = this.probe.sample(this.camera.position);
        // Irradiance -> a hemisphere light that gives similar brightness on moving things.
        if (c) this.ambientTarget.copy(c).multiplyScalar(this.settings.bakedLight * 0.9);
      }
      this.ambient.lerp(this.ambientTarget, Math.min(1, frameDt * 3));
      this.hemi.color.copy(this.ambient);
      this.hemi.groundColor.copy(this.ambient).multiplyScalar(0.45);
      this.hemi.intensity = 1;
    }
  }

  render(): void {
    this.composer.render();
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(width / 2, height / 2);
  }

  private material<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.materials.get(key) as T | undefined;
    if (!m) {
      m = make();
      this.materials.set(key, m);
    }
    return m;
  }
}
