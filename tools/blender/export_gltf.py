"""Export the open .blend to a .glb for the game.

Run headless (tools/export-levels.mjs does this for every level):
    Blender -b level.blend --python-exit-code 1 --python export_gltf.py -- out.glb

Custom properties are exported as glTF extras, which three.js puts in `userData`.
Hidden objects are exported too: collision (COL_*) and trigger (TRIG_*) meshes are
often hidden while editing. Objects named `REF_*` are reference only (e.g. real terrain
to model against) and are left out.
"""
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]

# If the .blend couldn't be opened Blender carries on with an empty scene: don't
# overwrite a good level with that.
if not bpy.data.filepath:
    sys.exit("could not open the .blend file")

# Drop reference objects from this session (the .blend isn't saved).
for obj in [o for o in bpy.data.objects if o.name.startswith("REF_")]:
    bpy.data.objects.remove(obj)

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_yup=True,
    export_extras=True,
    export_apply=True,
    use_selection=False,
    use_visible=False,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
)
print(f"exported {bpy.data.filepath} -> {out}")
