/** Greybox surface types, set on Blender objects with the `surface` custom property. */
export type Surface = "floor" | "wall" | "stairs" | "ramp" | "steep" | "platform" | "prop";

/** Greybox colour for each surface type (sRGB). */
export const surfaceColors: Record<Surface, number> = {
  floor: 0x8d9199,
  wall: 0xbdb5a4,
  stairs: 0x6f90b5,
  ramp: 0x80ad7c,
  steep: 0xc56c5c,
  platform: 0xa3aab6,
  prop: 0xd9b45a,
};
