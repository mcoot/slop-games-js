"""Bake a level's static lighting into one lightmap atlas.

Run headless (tools/bake-lighting.mjs does this):
    Blender -b level.blend --python-exit-code 1 --python bake_lightmap.py -- out.jpg [size] [samples]

- Every level mesh (not *_col / *_col_trigger, not light fixtures) gets a second UV
  set, "lightmap", unwrapped and packed into one atlas with even texel density. It's
  saved into the .blend, so the exported .glb carries it as TEXCOORD_1.
- Light comes from the fixtures (meshes with `emissive` and `light_power` custom
  properties, which become area lights for the bake), an afternoon sun and the sky.
- The bake is diffuse lighting without surface colour (irradiance), so the game
  multiplies it by its own materials. It's stored as an 8-bit PNG: value / RANGE,
  sRGB-encoded for precision in the darks, saved as a JPEG. The game loads it as an
  sRGB texture and multiplies by RANGE.
"""
import math
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1 :]
out = args[0]
size = int(args[1]) if len(args) > 1 else 2048
samples = int(args[2]) if len(args) > 2 else 128
RANGE = 4.0
UV = "lightmap"

scene = bpy.context.scene


def is_fixture(o):
    return "emissive" in o and "light_power" in o


def is_helper(o):
    n = o.name.split(".")[0]
    return n.endswith("_col") or n.endswith("_col_trigger")


targets = [o for o in scene.objects if o.type == "MESH" and not is_fixture(o) and not is_helper(o)]
fixtures = [o for o in scene.objects if o.type == "MESH" and is_fixture(o)]
print(f"baking {len(targets)} meshes lit by {len(fixtures)} fixtures at {size}px, {samples} samples")

# --- Lightmap UVs: fresh unwrap every bake, then one shared atlas.
for o in targets:
    if o.data.users > 1:
        o.data = o.data.copy()
    me = o.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name="UVMap")
    old = me.uv_layers.get(UV)
    if old:
        me.uv_layers.remove(old)
    me.uv_layers.new(name=UV)
    me.uv_layers.active = me.uv_layers[UV]

bpy.ops.object.select_all(action="DESELECT")
for o in targets:
    o.hide_set(False)
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(rotate=True, margin=4 / size)
bpy.ops.object.mode_set(mode="OBJECT")
for o in targets:
    # Rendering and export use the first UV set; the lightmap stays second.
    o.data.uv_layers.active_index = 0
    for i, uv in enumerate(o.data.uv_layers):
        uv.active_render = i == 0

# --- Bake target image on every material.
image = bpy.data.images.new("lightmap-bake", size, size, float_buffer=True)
image.colorspace_settings.name = "Non-Color"
temp_nodes = []
for m in {s.material for o in targets for s in o.material_slots if s.material}:
    m.use_nodes = True
    node = m.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    m.node_tree.nodes.active = node
    temp_nodes.append((m, node))
for o in targets:
    if not o.material_slots:
        m = bpy.data.materials.new(f"bake-{o.name}")
        m.use_nodes = True
        o.data.materials.append(m)
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        m.node_tree.nodes.active = node
        temp_nodes.append((m, node))

# --- Lights: fixtures become downward area lights; plus sun and sky.
temp_objects = []
for f in fixtures:
    f.hide_render = True
    dims = f.dimensions
    light = bpy.data.lights.new(f"bake-{f.name}", "AREA")
    light.shape = "RECTANGLE"
    light.size, light.size_y = max(dims.x, 0.05), max(dims.y, 0.05)
    c = f["emissive"]
    light.color = tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    light.energy = float(f["light_power"])
    lo = bpy.data.objects.new(light.name, light)
    lo.location = f.matrix_world.translation - f.matrix_world.to_3x3().col[2].normalized() * 0.04
    scene.collection.objects.link(lo)
    temp_objects.append(lo)

sun = bpy.data.lights.new("bake-sun", "SUN")
sun.energy = 2.5
sun.color = (1.0, 0.95, 0.86)
sun.angle = math.radians(2)
so = bpy.data.objects.new("bake-sun", sun)
so.rotation_euler = (math.radians(50), 0, math.radians(35))
scene.collection.objects.link(so)
temp_objects.append(so)

old_world = scene.world
world = bpy.data.worlds.new("bake-sky")
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
bg.inputs["Strength"].default_value = 0.8
scene.world = world

# --- Cycles on the GPU if there is one.
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for kind in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            print("bake device", kind)
            break
    except TypeError:
        continue
scene.cycles.samples = samples
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = False
scene.render.bake.margin = 8

bpy.ops.object.select_all(action="DESELECT")
for o in targets:
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, uv_layer=UV, margin=8, use_clear=True, target="IMAGE_TEXTURES")

# --- Encode and save: value / RANGE, sRGB curve, 8-bit.
px = np.empty(size * size * 4, dtype=np.float32)
image.pixels.foreach_get(px)
px = px.reshape(-1, 4)

# Light denoise: a small blur that only mixes texels the bake covered, so islands
# (and the black gaps between them) don't bleed into each other.
rgb = px[:, :3].reshape(size, size, 3)
mask = (rgb.sum(axis=2) > 1e-6).astype(np.float32)
kernel = np.array([1, 4, 6, 4, 1], dtype=np.float32) / 16
def blur(a):
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (2, 2)
        p = np.pad(a, pad, mode="edge")
        a = sum(kernel[k] * np.take(p, range(k, k + a.shape[axis]), axis=axis) for k in range(5))
    return a
for _ in range(2):
    num = blur(rgb * mask[..., None])
    den = blur(mask)[..., None]
    rgb = np.where((mask[..., None] > 0) & (den > 1e-4), num / np.maximum(den, 1e-4), rgb)
px[:, :3] = rgb.reshape(-1, 3)
v = np.clip(px[:, :3] / RANGE, 0.0, 1.0)
px[:, :3] = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
px[:, 3] = 1.0
image.pixels.foreach_set(px.ravel())
# JPEG: lightmaps are smooth, so this is ~10x smaller than PNG with no visible loss.
image.file_format = "JPEG"
image.save(filepath=out, quality=92)
print(f"wrote {out}")

# --- Clean up everything but the UVs, and save the .blend.
for m, node in temp_nodes:
    m.node_tree.nodes.remove(node)
for o in temp_objects:
    bpy.data.objects.remove(o)
for f in fixtures:
    f.hide_render = False
scene.world = old_world
bpy.data.worlds.remove(world)
bpy.data.images.remove(image)
bpy.ops.wm.save_mainfile()
