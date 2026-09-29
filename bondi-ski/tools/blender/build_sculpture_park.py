"""Generate the starting point for the Sculpture Park map: assets-src/maps/sculpture-park.blend.

This script only bootstraps the .blend. Once it exists the .blend is the source: open it
in Blender, move things about, save, and `pnpm export-maps` (in bondi-ski/). Running this
again overwrites the .blend and any hand edits in it.

    blender -b --python tools/blender/build_sculpture_park.py -- assets-src/maps/sculpture-park.blend

Coordinates are the course's: Blender X is east (game x), Blender Y is north (game -z),
Z is up, 1 unit = 1 m, sea level at 0. The arena sits on the Marks Park headland, so the
real coast round it (drawn by the game from the course data) is the backdrop. What the
game reads from the file:

- `terrain`: a grid on the course's 3 m terrain cells. The game copies its heights into
  the course terrain inside the arena and blends them into the real ground outside it.
  Each face's material names the ground there (surf_grass, surf_path, surf_sand, surf_rock,
  surf_scrub). Move vertices up and down only: sideways moves put them in other cells.
- Everything else is drawn and collides (level-loader conventions: `_col` meshes only
  collide, `collider` = none/box/mesh overrides). Unrotated or rotated cubes become exact
  box colliders.
- Empties with a `type`: `player_spawn` (facing +Y in Blender), `tree` (a Norfolk Island
  pine), `bench`.
- `REF_*` objects (the real terrain round the arena, for context) are not exported.

The layout is Walled In style (Tribes: Ascend): a sandstone compound at each end with a
gate, gaps, corner towers, ramps onto the walls and a keep; between them a ski valley with
a hill, side ridges and Sculptures by the Sea pieces as cover and ramps. It is the same
turned half a circle round the middle, so neither end is favoured.
"""
import json
import math
import os
import struct
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

out = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
HERE = os.path.dirname(os.path.abspath(__file__))
COURSE_DIR = os.path.join(HERE, "..", "..", "public", "course")

# ---------------------------------------------------------------- the frame

# Arena middle in course metres (on a terrain vertex) and the force field's radius.
CX, CZ = 201.0, 111.0
RADIUS = 125.0
# The terrain grid reaches past the wall so the game has something to blend from.
GRID_REACH = RADIUS + 12
CELL = 3.0
X0, Z0 = -396.0, -1413.0  # the course grid's origin (see icebergs-tamarama.json)

BASE = 18.0  # valley floor above sea level
PLATEAU = 13.0  # the compounds sit this much higher
BASE_N = 88.0  # compound middle, metres north (and south) of the arena middle
FLOOR = BASE + PLATEAU  # compound floor height


def world(u, n, z=0.0):
    """Arena-local (u east, n north) to Blender coordinates."""
    return Vector((CX + u, -CZ + n, z))


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def rolling(u, n):
    return 0.9 * math.sin(u * 0.083 + n * 0.041 + 0.7) * math.cos(n * 0.067 - u * 0.029) + 0.5 * math.sin(u * 0.19 - n * 0.13)


def compound_mask(u, n):
    """1 on a compound's flat pad (either end), fading to 0 over 8 m round it."""
    a = abs(n)
    du = max(abs(u) - 31, 0.0)
    dn = max(BASE_N - 26 - a, a - (BASE_N + 28), 0.0)
    return 1.0 - smoothstep(0.0, 8.0, math.hypot(du, dn))


def height(u, n):
    r = math.hypot(u, n)
    a = abs(n)
    plateau = PLATEAU * smoothstep(34, 66, a)
    # Ridges along both flanks of the valley, highest level with the middle.
    ridge = 7.0 * smoothstep(50, 92, abs(u)) * (1 - smoothstep(40, 80, a))
    hill = 6.5 * math.exp(-(u * u + n * n) / (2 * 15.0 ** 2))
    # The ground curls up to meet the wall: bank off it at speed.
    lip = 5.0 * smoothstep(RADIUS - 28, RADIUS + 4, r)
    # Point-symmetric rolls so skiing isn't glassy.
    roll = rolling(u, n) + rolling(-u, -n)
    free = BASE + plateau + ridge + hill + lip + roll * (1 - smoothstep(60, 70, a) * 0.6)
    m = compound_mask(u, n)
    return free * (1 - m) + FLOOR * m


def surface(u, n, slope):
    r = math.hypot(u, n)
    if compound_mask(u, n) > 0.5 and abs(u) < 28 and BASE_N - 22 < abs(n) < BASE_N + 22:
        return "surf_sand"
    # A paved path up the middle from each gate to the hill.
    if abs(u) < 2.2 and 14 < abs(n) < BASE_N - 20:
        return "surf_path"
    if slope > 0.62:
        return "surf_rock"
    if r > RADIUS - 22 and abs(u) > 55:
        return "surf_scrub"
    return "surf_grass"


# ---------------------------------------------------------------- scene helpers

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"


def material(name, colour, metallic=0.0, roughness=0.8):
    m = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb(colour), 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    m.diffuse_color = (*srgb(colour), 1.0)
    return m


def srgb(hex_colour):
    h = hex_colour.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


MAT = {
    # The game draws `sandstone` with its own strata shader, like the cliffs.
    "sandstone": material("sandstone", "#d8a56b", roughness=0.9),
    "sandstone_dark": material("sandstone_dark", "#e2c79c", roughness=0.9),
    "concrete": material("concrete", "#d9d4c8", roughness=0.85),
    "steel": material("steel", "#dfe4ea", metallic=1.0, roughness=0.18),
    "corten": material("corten", "#8f4a22", metallic=0.2, roughness=0.75),
    "bronze": material("bronze", "#4a3a2c", metallic=0.6, roughness=0.45),
    "yellow": material("paint_yellow", "#f2c230", roughness=0.4),
    "red": material("paint_red", "#d8352a", roughness=0.4),
    "blue": material("paint_blue", "#2e6fd8", roughness=0.4),
    "coral": material("paint_coral", "#ef6f5a", roughness=0.5),
    "pink": material("paint_pink", "#f08cc0", roughness=0.45),
    "white": material("paint_white", "#f4f1ea", roughness=0.5),
    "team_north": material("team_north", "#2f7fe0", roughness=0.7),
    "team_south": material("team_south", "#e0442f", roughness=0.7),
}
SURF = {name: material(name, colour, roughness=1.0) for name, colour in [
    ("surf_grass", "#7bab4f"), ("surf_path", "#d2cbbd"), ("surf_sand", "#ecd9a8"), ("surf_rock", "#c98a4b"), ("surf_scrub", "#5f7f3e")]}


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or scene.collection).children.link(c)
    return c


def link(obj, coll):
    coll.objects.link(obj)
    return obj


def box(coll, name, centre, size, mat, rot=(0.0, 0.0, 0.0), **props):
    """A cube scaled to `size` (x, y, z metres) at `centre` (Blender coords), rotated by Euler XYZ radians."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre
    obj.rotation_euler = Euler(rot, "XYZ")
    obj.scale = size
    for k, v in props.items():
        obj[k] = v
    return link(obj, coll)


def mesh_object(coll, name, bm, mat, location=(0, 0, 0), rot=(0, 0, 0), smooth=False, **props):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = Euler(rot, "XYZ")
    for k, v in props.items():
        obj[k] = v
    return link(obj, coll)


def empty(coll, name, location, kind, yaw=0.0, display="ARROWS"):
    """A marker. `yaw` turns its facing (+Y) anticlockwise seen from above."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = 1.5
    obj.location = location
    obj.rotation_euler = Euler((0, 0, yaw), "XYZ")
    obj["type"] = kind
    return link(obj, coll)


def facing(u, n, tu, tn):
    """Yaw for an empty at (u, n) to face (tu, tn): +Y turned anticlockwise."""
    return math.atan2(-(tu - u), tn - n)


# ---------------------------------------------------------------- terrain

def build_terrain():
    coll = collection("terrain")
    # Vertices on the course grid, so the game can copy heights cell for cell.
    c0 = math.ceil((CX - GRID_REACH - X0) / CELL)
    c1 = math.floor((CX + GRID_REACH - X0) / CELL)
    r0 = math.ceil((CZ - GRID_REACH - Z0) / CELL)
    r1 = math.floor((CZ + GRID_REACH - Z0) / CELL)
    bm = bmesh.new()
    verts = {}
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            x = X0 + c * CELL
            z = Z0 + r * CELL
            u, n = x - CX, -(z - CZ)
            if math.hypot(u, n) > GRID_REACH + CELL * 1.5:
                continue
            verts[(r, c)] = bm.verts.new((x, -z, height(u, n)))
    bm.verts.ensure_lookup_table()
    names = list(SURF)
    for (r, c), v00 in verts.items():
        v01 = verts.get((r, c + 1))
        v10 = verts.get((r + 1, c))
        v11 = verts.get((r + 1, c + 1))
        if not (v01 and v10 and v11):
            continue
        # Rows run south (+z) = -Y: wind so faces point up.
        f = bm.faces.new((v00, v10, v11, v01))
        mid = (v00.co + v11.co) / 2
        u, n = mid.x - CX, mid.y + CZ
        slope = max(abs(v01.co.z - v00.co.z), abs(v10.co.z - v00.co.z), abs(v11.co.z - v01.co.z), abs(v11.co.z - v10.co.z)) / CELL
        f.material_index = names.index(surface(u, n, slope))
    bm.normal_update()
    mesh = bpy.data.meshes.new("terrain")
    bm.to_mesh(mesh)
    bm.free()
    for name in names:
        mesh.materials.append(SURF[name])
    obj = bpy.data.objects.new("terrain", mesh)
    # The game reads the heights and draws the ground itself.
    obj["collider"] = "none"
    link(obj, coll)


def build_reference():
    """The real ground for 450 m round the arena, for context while editing. Not exported."""
    path = os.path.join(COURSE_DIR, "icebergs-tamarama.json")
    if not os.path.exists(path):
        return
    j = json.load(open(path))
    t = j["terrain"]
    data = open(os.path.join(COURSE_DIR, t["file"]), "rb").read()
    cols, rows = t["cols"], t["rows"]
    step = 2
    reach = 450
    coll = collection("REF_reference")
    bm = bmesh.new()
    grid = {}
    for r in range(0, rows, step):
        z = t["z0"] + r * t["cell"]
        if abs(z - CZ) > reach:
            continue
        for c in range(0, cols, step):
            x = t["x0"] + c * t["cell"]
            if abs(x - CX) > reach:
                continue
            h = struct.unpack_from("<h", data, (r * cols + c) * 2)[0] / 10
            # Sink it under the arena so it doesn't hide the new ground.
            if math.hypot(x - CX, z - CZ) < GRID_REACH:
                h -= 30
            grid[(r, c)] = bm.verts.new((x, -z, h))
    for (r, c), v in grid.items():
        q = [grid.get(k) for k in ((r, c), (r + step, c), (r + step, c + step), (r, c + step))]
        if all(q):
            bm.faces.new(q)
    mesh = bpy.data.meshes.new("REF_bondi_terrain")
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material("REF_ground", "#9a9a90"))
    obj = bpy.data.objects.new("REF_bondi_terrain", mesh)
    obj.hide_select = True
    link(obj, coll)
    # Keep it out of renders and exports; it's only a guide in the viewport.
    obj.hide_render = True


# ---------------------------------------------------------------- the compounds

def turned(half):
    """Map arena-local (u, n) and a yaw into the north (half=0) or south (half=1) end."""
    s = -1 if half else 1

    def at(u, n, z=0.0):
        return world(s * u, s * n, z)

    return at, (math.pi if half else 0.0)


def build_compound(half):
    at, spin = turned(half)
    tag = "north" if half == 0 else "south"
    coll = collection(f"compound_{tag}")
    team = MAT[f"team_{tag}"]
    sand = MAT["sandstone"]
    f = FLOOR
    H = 7.0  # wall height
    T = 2.0  # wall thickness
    W = 24.0  # half width (east-west)
    front, back = BASE_N - 20, BASE_N + 20  # wall lines, north of the middle

    def wall(name, u0, u1, n0, n1, z0=0.0, z1=H, mat=sand, **props):
        # Walls reach 1 m into the ground so rolls in the pad never open a gap.
        cu, cn = (u0 + u1) / 2, (n0 + n1) / 2
        return box(coll, f"{tag}_{name}", at(cu, cn, f + (z0 + z1) / 2 - (0.5 if z0 == 0 else 0)),
                   (abs(u1 - u0), abs(n1 - n0), (z1 - z0) + (1.0 if z0 == 0 else 0)), mat, (0, 0, spin), **props)

    # Front wall (towards the middle) with the main gate under a lintel.
    wall("front_w", -W, -5, front - T / 2, front + T / 2)
    wall("front_e", 5, W, front - T / 2, front + T / 2)
    wall("gate_lintel", -5, 5, front - T / 2, front + T / 2, 5.0, H)
    # Back wall with a slot to ski out of.
    wall("back_w", -W, -3, back - T / 2, back + T / 2)
    wall("back_e", 3, W, back - T / 2, back + T / 2)
    # Side walls, each with a gap near the front.
    for side, sgn in (("w", -1), ("e", 1)):
        u0, u1 = sorted((sgn * (W - T / 2), sgn * (W + T / 2)))
        wall(f"side_{side}_front", u0, u1, front, front + 5)
        wall(f"side_{side}_back", u0, u1, front + 12, back)
        # Corner towers.
        for end, nn in (("front", front), ("back", back)):
            cu = sgn * W
            box(coll, f"{tag}_tower_{side}_{end}", at(cu, nn, f + 6.0 - 0.5), (6, 6, 13), MAT["sandstone_dark"], (0, 0, spin))
            # A banner down the tower's outer face, in the end's colour (decoration only).
            box(coll, f"{tag}_banner_{side}_{end}", at(cu + sgn * 3.08, nn, f + 7.5), (0.08, 2.4, 6.0), team, (0, 0, spin), collider="none")
        # A ramp up the inside of the side wall to its top, from the back.
        run, rise = 22.0, H
        length = math.hypot(run, rise)
        pitch = math.atan2(rise, run)
        ru = sgn * (W - T / 2 - 2.2)
        rn0 = back - 5
        mid_n = rn0 - run / 2
        # Tilted about the east-west axis: rises towards the front.
        box(coll, f"{tag}_ramp_{side}", at(ru, mid_n, f + rise / 2 - 0.35), (4.2, length, 0.7), MAT["concrete"],
            (-pitch, 0, spin))

    # The keep: pillars, a roof deck level with the walls, and a back wall with a door.
    for pu in (-7, 7):
        for pn in (BASE_N - 5, BASE_N + 5):
            box(coll, f"{tag}_keep_pillar", at(pu, pn, f + 3 - 0.5), (2, 2, 7), sand, (0, 0, spin))
    box(coll, f"{tag}_keep_roof", at(0, BASE_N, f + H - 0.6), (16, 12, 1.2), MAT["sandstone_dark"], (0, 0, spin))
    box(coll, f"{tag}_keep_back_w", at(-4.5, BASE_N + 5, f + 2.5), (5, 1.2, 6), sand, (0, 0, spin))
    box(coll, f"{tag}_keep_back_e", at(4.5, BASE_N + 5, f + 2.5), (5, 1.2, 6), sand, (0, 0, spin))
    # The plinth on the roof, with this end's piece: a stack of team-coloured blocks.
    box(coll, f"{tag}_plinth", at(0, BASE_N, f + H + 0.5), (3.5, 3.5, 1.0), MAT["white"], (0, 0, spin))
    for k in range(3):
        s = 2.2 - k * 0.55
        box(coll, f"{tag}_trophy", at(0, BASE_N, f + H + 1.0 + s / 2 + k * 1.9), (s, s, s), team, (0.0, 0.0, spin + k * 0.5))
    # Low cover blocks inside the gate.
    for cu in (-10, 10):
        box(coll, f"{tag}_cover", at(cu, front + 9, f + 0.5), (6, 1.5, 2.5), MAT["sandstone_dark"], (0, 0, spin))

    # Spawns: inside the compound and on its walls, facing the middle.
    sp = collection(f"spawns_{tag}")
    for i, (u, n, z) in enumerate([(-15, back - 6, 0), (15, back - 6, 0), (-12, front + 4, 0), (12, front + 4, 0), (0, BASE_N - 4.5, H)]):
        p = at(u, n, f + z + 0.5)
        empty(sp, f"spawn_{tag}_{i}", p, "player_spawn", facing(p.x - CX, p.y + CZ, 0, 0))


# ---------------------------------------------------------------- the sculptures

def ground(u, n):
    return height(u, n)


def build_ring(coll):
    """A big polished steel ring on the hill, standing across the valley: fly through it."""
    bm = bmesh.new()
    major, minor = 7.0, 0.7
    seg, ring = 40, 10
    rows = []
    for i in range(seg):
        a = i / seg * math.tau
        centre = Vector((math.cos(a) * major, 0, math.sin(a) * major))
        out = Vector((math.cos(a), 0, math.sin(a)))
        rows.append([bm.verts.new(centre + (out * math.cos(b) + Vector((0, 1, 0)) * math.sin(b)) * minor)
                     for b in (j / ring * math.tau for j in range(ring))])
    for i in range(seg):
        for j in range(ring):
            a, b = rows[i], rows[(i + 1) % seg]
            bm.faces.new((a[j], b[j], b[(j + 1) % ring], a[(j + 1) % ring]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    z = ground(0, 0) + major - 0.4
    mesh_object(coll, "sculpture_ring", bm, MAT["steel"], world(0, 0, z), smooth=True, collider="mesh")
    # A sandstone footing.
    box(coll, "sculpture_ring_footing", world(0, 0, ground(0, 0) - 0.2), (3.0, 3.0, 1.2), MAT["sandstone_dark"])


def build_wave(coll, u, n, yaw, name):
    """A rusted steel wave: a curved sheet you ski up and launch off."""
    bm = bmesh.new()
    radius, width, sweep = 9.0, 12.0, math.radians(58)
    steps = 14
    prof = []
    for i in range(steps + 1):
        a = sweep * i / steps
        # From flat on the ground curving up: y along the run, z up.
        prof.append((math.sin(a) * radius, radius - math.cos(a) * radius))
    thick = 0.35
    top = [[bm.verts.new((x, y, z)) for (y, z) in prof] for x in (-width / 2, width / 2)]
    # The underside, offset along each point's inward normal.
    under = []
    for x in (-width / 2, width / 2):
        row = []
        for i, (y, z) in enumerate(prof):
            a = sweep * i / steps
            row.append(bm.verts.new((x, y + math.sin(a) * thick, z - math.cos(a) * thick - (thick if i == 0 else 0))))
        under.append(row)
    for i in range(steps):
        bm.faces.new((top[0][i], top[1][i], top[1][i + 1], top[0][i + 1]))
        bm.faces.new((under[0][i + 1], under[1][i + 1], under[1][i], under[0][i]))
        bm.faces.new((top[0][i], top[0][i + 1], under[0][i + 1], under[0][i]))
        bm.faces.new((top[1][i + 1], top[1][i], under[1][i], under[1][i + 1]))
    bm.faces.new((top[0][0], under[0][0], under[1][0], top[1][0]))
    bm.faces.new((top[1][steps], under[1][steps], under[0][steps], top[0][steps]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Sink the leading edge a little so you ride straight onto it.
    z = ground(u, n) - 0.25
    mesh_object(coll, name, bm, MAT["corten"], world(u, n, z), (0, 0, yaw), collider="mesh")


def build_cubes(coll, u, n, spin, name):
    """Big bright cubes balanced on their corners."""
    tip = (math.radians(45), math.radians(-35.264), 0)
    for k, (du, dn, s, mat) in enumerate([(0, 0, 5.5, "yellow"), (6.5, 3.5, 3.2, "red"), (-3.5, 6.0, 2.4, "blue")]):
        cu = u + du * math.cos(spin) - dn * math.sin(spin)
        cn = n + du * math.sin(spin) + dn * math.cos(spin)
        # A cube on its corner stands sqrt(3)/2 of its side above the ground.
        z = ground(cu, cn) + s * 0.866 - 0.3
        box(coll, f"{name}_{k}", world(cu, cn, z), (s, s, s), MAT[mat], (tip[0], tip[1], spin + k))


def build_stack(coll, u, n, name):
    """A twisted stack of coral slabs: a tower to fight round and perch on."""
    g = ground(u, n)
    for k in range(9):
        box(coll, f"{name}_{k}", world(u, n, g + 0.6 + k * 1.2 - (0.5 if k == 0 else 0)), (4.5, 4.5, 1.2 + (1.0 if k == 0 else 0)),
            MAT["coral"] if k % 2 == 0 else MAT["white"], (0, 0, k * math.radians(11)))


def build_figures(coll, u0, n0, name):
    """A row of tall thin bronze figures looking out past the wall."""
    for k in range(5):
        u = u0
        n = n0 + (k - 2) * 7.0
        g = ground(u, n)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.35, radius2=0.28, depth=3.4)
        mesh_object(coll, f"{name}_{k}_body", bm, MAT["bronze"], world(u, n, g + 1.7 - 0.2), smooth=True)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.34)
        mesh_object(coll, f"{name}_{k}_head", bm, MAT["bronze"], world(u, n, g + 3.75 - 0.2), smooth=True)


def build_head(coll, u, n, yaw, name):
    """A giant weathered head lying on its side in the grass: cover."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    bmesh.ops.scale(bm, vec=(3.2, 4.0, 2.6), verts=bm.verts)
    # A nose.
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.9, radius2=0.0, depth=1.6,
                          matrix=Matrix.Translation((0, 3.9, 0.6)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
    mesh_object(coll, name, bm, MAT["white"], world(u, n, ground(u, n) + 1.6), (0, math.radians(80), yaw), collider="mesh")


def build_arch(coll, u, n, spin, name):
    """A big pink doorway standing on its own: ski through it."""
    g = ground(u, n)
    for k, du in enumerate((-5.5, 5.5)):
        cu = u + du * math.cos(spin)
        cn = n + du * math.sin(spin)
        box(coll, f"{name}_post_{k}", world(cu, cn, ground(cu, cn) + 4.5 - 0.5), (1.4, 1.4, 10), MAT["pink"], (0, 0, spin))
    box(coll, f"{name}_lintel", world(u, n, g + 9.4), (12.4, 1.4, 1.4), MAT["pink"], (0, 0, spin))


def build_middle():
    coll = collection("sculptures")
    build_ring(coll)
    for half in (0, 1):
        s = -1 if half else 1
        tag = "a" if half == 0 else "b"
        # A wave on each flank, launching you towards the far end.
        build_wave(coll, s * 42, s * 22, 0.0 if half else math.pi, f"sculpture_wave_{tag}")
        build_cubes(coll, s * 24, s * -34, 0.3 + math.pi * half, f"sculpture_cubes_{tag}")
        build_stack(coll, s * -34, s * 46, f"sculpture_stack_{tag}")
        build_figures(coll, s * 92, 0, f"sculpture_figures_{tag}")
        build_head(coll, s * -62, s * -8, math.radians(20) + math.pi * half, f"sculpture_head_{tag}")
        build_arch(coll, 0, s * 44, math.pi * half, f"sculpture_arch_{tag}")

    # Spawns out in the valley.
    sp = collection("spawns_middle")
    for i, (u, n) in enumerate([(-45, 5), (45, -5), (30, 30), (-30, -30), (-80, -30), (80, 30), (0, -16), (0, 16)]):
        empty(sp, f"spawn_middle_{i}", world(u, n, ground(u, n) + 0.5), "player_spawn", facing(u, n, 0, 0))

    # Norfolk Island pines along both flanks, and benches by the hill path.
    trees = collection("trees")
    for half in (0, 1):
        s = -1 if half else 1
        for k, n in enumerate(range(-60, 61, 24)):
            u = s * (104 - abs(n) * 0.25)
            empty(trees, f"pine_{half}_{k}", world(u, s * n, ground(u, s * n)), "tree", display="PLAIN_AXES")
    benches = collection("benches")
    for k in range(6):
        a = k / 6 * math.tau + 0.3
        u, n = math.cos(a) * 25, math.sin(a) * 25
        empty(benches, f"bench_{k}", world(u, n, ground(u, n)), "bench", display="PLAIN_AXES")


# ---------------------------------------------------------------- go

build_terrain()
build_reference()
build_compound(0)
build_compound(1)
build_middle()

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print(f"wrote {out}")
