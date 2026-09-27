import * as THREE from "three";

/**
 * Baked lighting (tools/bake-lighting.mjs): one atlas per level, `<level>.lightmap.jpg`
 * next to the .glb, mapped by each mesh's second UV set. Stored as value / RANGE with
 * an sRGB curve, so load it as sRGB and multiply by RANGE.
 */
export const LIGHTMAP_RANGE = 4;

export function lightmapUrl(levelUrl: string): string {
  return levelUrl.replace(/\.glb(\?.*)?$/, ".lightmap.jpg$1");
}

/** Does this mesh have lightmap UVs (i.e. was it there when the lighting was baked)? */
export function hasLightmapUv(mesh: THREE.Mesh): boolean {
  return mesh.geometry.getAttribute("uv1") !== undefined;
}

/** Load a level's lightmap, or null if it has none. */
export async function loadLightmap(url: string): Promise<THREE.Texture | null> {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    return prepareLightmap(texture);
  } catch {
    return null;
  }
}

export function prepareLightmap(texture: THREE.Texture): THREE.Texture {
  texture.flipY = false; // glTF UV convention
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.channel = 1;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Multiplier for a material's lightMapIntensity. three.js scales lightmaps by 1/π in
 * its lighting maths, and the bake stored value / RANGE.
 */
export function lightmapIntensity(exposure = 1): number {
  return LIGHTMAP_RANGE * Math.PI * exposure;
}

/**
 * Reads baked light back out of a lightmap, so moving things (characters, pickups)
 * can be lit to match the static level: `sample(p)` finds the surface under `p` and
 * returns the irradiance baked there. Browser only (needs a canvas to read pixels).
 */
export class LightmapProbe {
  private readonly pixels: Uint8ClampedArray;
  private readonly width: number;
  private readonly height: number;
  private readonly raycaster = new THREE.Raycaster();
  private readonly down = new THREE.Vector3(0, -1, 0);

  constructor(
    texture: THREE.Texture,
    private readonly meshes: THREE.Mesh[],
  ) {
    const image = texture.image as HTMLImageElement | ImageBitmap;
    this.width = image.width;
    this.height = image.height;
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    this.pixels = ctx.getImageData(0, 0, this.width, this.height).data;
    this.raycaster.far = 6;
  }

  /** Linear irradiance (as baked) on the floor below `p`, or null if there's nothing lightmapped there. */
  sample(p: THREE.Vector3Like, out = new THREE.Color()): THREE.Color | null {
    this.raycaster.set(new THREE.Vector3(p.x, p.y + 0.5, p.z), this.down);
    const hit = this.raycaster.intersectObjects(this.meshes, false).find((h) => h.uv1);
    if (!hit?.uv1) return null;
    // flipY = false: v runs down the image.
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(hit.uv1.x * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(hit.uv1.y * this.height)));
    const i = (y * this.width + x) * 4;
    const decode = (v: number) => srgbToLinear(v / 255) * LIGHTMAP_RANGE;
    return out.setRGB(decode(this.pixels[i]!), decode(this.pixels[i + 1]!), decode(this.pixels[i + 2]!));
  }
}

function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
