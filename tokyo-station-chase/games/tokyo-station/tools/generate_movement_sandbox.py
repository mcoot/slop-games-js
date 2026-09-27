"""Build movement_sandbox.blend from the JSON written by generate-movement-sandbox.ts.

The game is Y-up with the player facing -Z; Blender is Z-up. The glTF exporter
maps Blender (x, y, z) to game (x, z, -y), so game (x, y, z) goes in as (x, -z, y).
"""
import json
import math
import sys

import bmesh
import bpy

json_path, out_path = sys.argv[sys.argv.index("--") + 1 :]
with open(json_path) as f:
    level = json.load(f)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"


def to_blender(v):
    x, y, z = v
    return (x, -z, y)


def collection(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(surface):
    rgb = level["surfaceColors"][surface]
    color = tuple(srgb_to_linear(((rgb >> s) & 0xFF) / 255) for s in (16, 8, 0)) + (1.0,)
    mat = bpy.data.materials.new(surface)
    mat.diffuse_color = color  # viewport solid colour
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.node_tree else None
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = 0.9
    return mat


def box_mesh(name, size):
    """A box of the given game-space size, centred on its origin."""
    sx, sy, sz = size
    hx, hy, hz = sx / 2, sz / 2, sy / 2  # game Y (height) is Blender Z
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= hx * 2
        v.co.y *= hy * 2
        v.co.z *= hz * 2
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def box_object(name, center, size, coll, pitch_deg=0.0):
    obj = bpy.data.objects.new(name, box_mesh(name, size))
    obj.location = to_blender(center)
    # Game X is Blender X, so a pitch about X carries over unchanged.
    obj.rotation_euler = (math.radians(pitch_deg), 0.0, 0.0)
    coll.objects.link(obj)
    return obj


geometry = collection("geometry")
materials = {}
for b in level["boxes"]:
    surface = b["surface"]
    if surface not in materials:
        materials[surface] = material(surface)
    obj = box_object(b["name"], b["center"], b["size"], geometry, b.get("pitchDeg") or 0.0)
    obj.data.materials.append(materials[surface])
    obj["surface"] = surface

triggers = collection("triggers")
for t in level["triggers"]:
    obj = box_object("TRIG_" + t["name"], t["center"], t["size"], triggers)
    obj.display_type = "WIRE"
    obj.hide_render = True

markers = collection("markers")
spawn = bpy.data.objects.new("SPAWN_player", None)
spawn.empty_display_type = "ARROWS"  # +Y (green) is the facing direction
spawn.location = to_blender((level["spawn"]["x"], level["spawn"]["y"], level["spawn"]["z"]))
markers.objects.link(spawn)

for i, label in enumerate(level["labels"]):
    obj = bpy.data.objects.new(f"LABEL_{i:02d}", None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.3
    obj.location = to_blender(label["position"])
    obj["label"] = label["text"]
    markers.objects.link(obj)

bpy.ops.wm.save_as_mainfile(filepath=out_path)
print(f"wrote {out_path}: {len(level['boxes'])} boxes, {len(level['triggers'])} triggers, {len(level['labels'])} labels")
