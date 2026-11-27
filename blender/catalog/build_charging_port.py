"""Build one catalog charging port type: a white plastic wall plate with its socket standard's apertures.

blender --background --factory-startup --python-exit-code 1 --python build_charging_port.py -- \
    --type type-g --output port.glb

Parts are modelled in glTF file coordinates (x right, y up, z front), in meters, with the back face on z = 0
and the plate centred on the origin, then turned into Blender space for export. Sources for each size are in
docs/catalog/charging-ports.md.
"""

import argparse
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix

PLASTIC = "plastic"
HOLE = "hole"
METAL = "metal"
MATERIALS = {
    PLASTIC: {"color": (0.93, 0.93, 0.91, 1), "roughness": 0.22, "metallic": 0},
    HOLE: {"color": (0.035, 0.035, 0.035, 1), "roughness": 0.7, "metallic": 0},
    METAL: {"color": (0.78, 0.78, 0.76, 1), "roughness": 0.28, "metallic": 1},
}
FILE_TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")
SEGMENTS = 6
HOLE_FLOOR_M = 0.0015
UK_SCREW_X_M = 0.0603 / 2
UK_DOUBLE_SCREW_X_M = 0.1206 / 2


def material(name):
    found = bpy.data.materials.get(name)
    if found:
        return found
    spec = MATERIALS[name]
    created = bpy.data.materials.new(name)
    shader = next(node for node in created.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = spec["color"]
    shader.inputs["Roughness"].default_value = spec["roughness"]
    shader.inputs["Metallic"].default_value = spec["metallic"]
    return created


def link(name, bm, material_name):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material(material_name))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def prism(outline, z_low, z_high):
    """Return a bmesh that extrudes the counter-clockwise `outline` of (x, y) points from `z_low` to `z_high`."""
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z_low)) for x, y in outline]
    top = [bm.verts.new((x, y, z_high)) for x, y in outline]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    count = len(outline)
    for index in range(count):
        following = (index + 1) % count
        bm.faces.new((bottom[index], bottom[following], top[following], top[index]))
    return bm


def rounded_rectangle(options):
    """Return the outline of a `width` x `height` rectangle centred on `centre`, its corners rounded by `radius`."""
    cx, cy = options.get("centre", (0, 0))
    half_w, half_h = options["width"] / 2, options["height"] / 2
    radius = min(options.get("radius", 0), half_w, half_h)
    if radius <= 0:
        return [(cx - half_w, cy - half_h), (cx + half_w, cy - half_h), (cx + half_w, cy + half_h), (cx - half_w, cy + half_h)]
    points = []
    corners = [(half_w - radius, -half_h + radius, -90), (half_w - radius, half_h - radius, 0), (-half_w + radius, half_h - radius, 90), (-half_w + radius, -half_h + radius, 180)]
    for corner_x, corner_y, start_deg in corners:
        for step in range(SEGMENTS + 1):
            angle = math.radians(start_deg + 90 * step / SEGMENTS)
            points.append((cx + corner_x + radius * math.cos(angle), cy + corner_y + radius * math.sin(angle)))
    return points


def circle(centre, radius, count=32):
    return [(centre[0] + radius * math.cos(2 * math.pi * i / count), centre[1] + radius * math.sin(2 * math.pi * i / count)) for i in range(count)]


def rotated(outline, centre, angle_rad):
    cos, sin = math.cos(angle_rad), math.sin(angle_rad)
    return [(centre[0] + (x - centre[0]) * cos - (y - centre[1]) * sin, centre[1] + (x - centre[0]) * sin + (y - centre[1]) * cos) for x, y in outline]


def bevel_front(bm, z_high, offset):
    """Round the edges around the face at `z_high` by `offset`, leaving the back unchanged."""
    edges = [edge for edge in bm.edges if all(abs(vert.co.z - z_high) < 1e-9 for vert in edge.verts)]
    bmesh.ops.bevel(bm, geom=edges, offset=offset, segments=3, profile=0.5, affect="EDGES", clamp_overlap=True)


def slab(name, options):
    """Add a part extruded from `outline`, with a rounded front edge, in the given material."""
    bm = prism(options["outline"], options["z_low"], options["z_high"])
    if options.get("bevel", 0) > 0:
        bevel_front(bm, options["z_high"], options["bevel"])
    return link(name, bm, options.get("material", PLASTIC))


def cut(target, cutters):
    """Subtract each cutter from `target`; the faces a cutter leaves keep that cutter's material."""
    collection = bpy.data.collections.new(f"{target.name}-cutters")
    bpy.context.scene.collection.children.link(collection)
    for cutter in cutters:
        bpy.context.scene.collection.objects.unlink(cutter)
        collection.objects.link(cutter)
    for cutter in cutters:
        for slot in cutter.data.materials:
            if slot.name not in target.data.materials:
                target.data.materials.append(slot)
    modifier = target.modifiers.new("cut", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.operand_type = "COLLECTION"
    modifier.collection = collection
    modifier.solver = "EXACT"
    modifier.material_mode = "TRANSFER"
    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated)
    target.modifiers.clear()
    target.data = mesh
    for cutter in cutters:
        bpy.data.objects.remove(cutter)
    bpy.data.collections.remove(collection)


def hole(outline, z_high, z_low=HOLE_FLOOR_M, material_name=HOLE):
    return link("cutter", prism(outline, z_low, z_high + 0.002), material_name)


def rounded_edge_prism(options):
    """Return a bmesh of a rounded rectangle extruded from z = 0 to `depth`, its front edge rounded by a quarter circle of radius `bevel`."""
    width, height, radius, bevel = options["width"], options["height"], options["radius"], options["bevel"]
    rings = [(0.0, 0.0), (0.0, options["depth"] - bevel)]
    for step in range(1, SEGMENTS + 1):
        angle = math.pi / 2 * step / SEGMENTS
        rings.append((bevel * (1 - math.cos(angle)), options["depth"] - bevel + bevel * math.sin(angle)))
    bm = bmesh.new()
    loops = [
        [bm.verts.new((x, y, z)) for x, y in rounded_rectangle({"width": width - 2 * inset, "height": height - 2 * inset, "radius": max(radius - inset, 0.0002)})]
        for inset, z in rings
    ]
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    for lower, upper in zip(loops, loops[1:]):
        for index in range(len(lower)):
            following = (index + 1) % len(lower)
            bm.faces.new((lower[index], lower[following], upper[following], upper[index]))
    return bm


def plate(options):
    """Add the faceplate: a rounded rectangle `width` x `height`, `depth` deep, cut by `cutters`."""
    obj = link(
        "plate",
        rounded_edge_prism(
            {
                "width": options["width"],
                "height": options["height"],
                "radius": options.get("radius", 0.003),
                "depth": options["depth"],
                "bevel": options.get("bevel", 0.0015),
            }
        ),
        PLASTIC,
    )
    cut(obj, options["cutters"])
    return obj


def screw_cover(centre, depth):
    slab("screw_cover", {"outline": circle(centre, 0.0042), "z_low": depth - 0.001, "z_high": depth + 0.0008, "bevel": 0.0006})


def rocker(options):
    """Add a rocker: a wedge whose lower end stands at `z_low_end` and upper end at `z_top`."""
    cx, cy = options["centre"]
    width, height = options["width"], options["height"]
    bm = bmesh.new()
    outline = rounded_rectangle({"centre": (cx, cy), "width": width, "height": height, "radius": options.get("radius", 0.0012)})
    z_base = options["depth"] - 0.003
    bottom = [bm.verts.new((x, y, z_base)) for x, y in outline]
    slope = (options["z_top"] - options["z_low_end"]) / height
    top = [bm.verts.new((x, y, options["z_low_end"] + (y - (cy - height / 2)) * slope)) for x, y in outline]
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for index in range(len(outline)):
        following = (index + 1) % len(outline)
        bm.faces.new((bottom[index], bottom[following], top[following], top[index]))
    link("rocker", bm, PLASTIC)


def rocker_surround(centre, width, height, depth):
    return hole(rounded_rectangle({"centre": centre, "width": width + 0.0012, "height": height + 0.0012, "radius": 0.0015}), depth, depth - 0.003)


def bs1363_apertures(centre, depth):
    """Return cutters for BS 1363: earth 4.6 x 8.4 mm above, line and neutral 7.0 x 4.6 mm, 22.2 mm apart, 22.2 mm below."""
    cx, cy = centre
    return [
        hole(rounded_rectangle({"centre": (cx, cy + 0.0111), "width": 0.0046, "height": 0.0084, "radius": 0.0003}), depth),
        hole(rounded_rectangle({"centre": (cx - 0.0111, cy - 0.0111), "width": 0.007, "height": 0.0046, "radius": 0.0003}), depth),
        hole(rounded_rectangle({"centre": (cx + 0.0111, cy - 0.0111), "width": 0.007, "height": 0.0046, "radius": 0.0003}), depth),
    ]


def usb_a(centre, depth, vertical):
    """Add a USB-A receptacle: a 12.5 x 5.1 mm metal-lined opening with its tongue."""
    width, height = (0.0051, 0.0125) if vertical else (0.0125, 0.0051)
    cutter = hole(rounded_rectangle({"centre": centre, "width": width, "height": height, "radius": 0.0003}), depth, depth - 0.006, METAL)
    tongue_w, tongue_h = (0.0019, 0.0112) if vertical else (0.0112, 0.0019)
    offset = (-0.0011, 0) if vertical else (0, 0.0011)
    slab(
        "usb_a_tongue",
        {
            "outline": rounded_rectangle({"centre": (centre[0] + offset[0], centre[1] + offset[1]), "width": tongue_w, "height": tongue_h}),
            "z_low": depth - 0.0062,
            "z_high": depth - 0.0012,
            "material": HOLE,
        },
    )
    return cutter


def usb_c(centre, depth, vertical):
    """Add a USB-C receptacle: an 8.9 x 3.2 mm rounded metal-lined opening with its tongue."""
    width, height = (0.0032, 0.0089) if vertical else (0.0089, 0.0032)
    cutter = hole(rounded_rectangle({"centre": centre, "width": width, "height": height, "radius": 0.0016}), depth, depth - 0.006, METAL)
    tongue_w, tongue_h = (0.0007, 0.0066) if vertical else (0.0066, 0.0007)
    slab(
        "usb_c_tongue",
        {"outline": rounded_rectangle({"centre": centre, "width": tongue_w, "height": tongue_h}), "z_low": depth - 0.0062, "z_high": depth - 0.0014, "material": HOLE},
    )
    return cutter


def uk_switched_socket(options):
    """Return the cutters of one BS 1363 switched socket and add its 11.5 x 20 mm rocker, whose top stands 2 mm proud."""
    depth = options["depth"]
    rocker_centre = options["rocker_centre"]
    rocker({"centre": rocker_centre, "width": 0.0115, "height": 0.02, "depth": depth, "z_low_end": depth + 0.0004, "z_top": depth + 0.002})
    return [*bs1363_apertures(options["socket_centre"], depth), rocker_surround(rocker_centre, 0.0115, 0.02, depth)]


def uk_plate(options):
    """Add a BS 4662 plate, `width` x 86 mm, its screws behind round covers `screw_x` either side of the centre."""
    plate({"width": options["width"], "height": 0.086, "depth": options["depth"], "radius": 0.004, "bevel": 0.003, "cutters": options["cutters"]})
    for x in (-options["screw_x"], options["screw_x"]):
        screw_cover((x, 0), options["depth"])


def build_type_g():
    depth = 0.008
    cutters = uk_switched_socket({"depth": depth, "socket_centre": (-0.006, -0.002), "rocker_centre": (0.0255, 0.0165)})
    uk_plate({"width": 0.086, "depth": depth, "screw_x": UK_SCREW_X_M, "cutters": cutters})


def build_type_g_usb():
    depth = 0.008
    cutters = uk_switched_socket({"depth": depth, "socket_centre": (-0.006, -0.008), "rocker_centre": (0.0255, 0.0165)})
    cutters += [usb_c((-0.019, 0.024), depth, vertical=False), usb_a((-0.0055, 0.024), depth, vertical=False)]
    uk_plate({"width": 0.086, "depth": depth, "screw_x": UK_SCREW_X_M, "cutters": cutters})


def build_type_g_double():
    depth = 0.008
    cutters = []
    for side in (-1, 1):
        cutters += uk_switched_socket({"depth": depth, "socket_centre": (side * 0.039, -0.002), "rocker_centre": (side * 0.0085, 0.0165)})
    uk_plate({"width": 0.146, "depth": depth, "screw_x": UK_DOUBLE_SCREW_X_M, "cutters": cutters})


def build_type_a_b():
    """US duplex: 2.75 x 4.5 in plate, two NEMA 5-15 faces 1.531 in apart, centre screw."""
    depth = 0.006
    face_top = 0.0075
    face_floor = depth - 0.0025
    outlet_spacing = 0.0389
    face_outline = []
    for step in range(48):
        angle = 2 * math.pi * step / 48
        face_outline.append((0.0175 * math.cos(angle), max(-0.0145, min(0.0145, 0.0175 * math.sin(angle)))))
    cutters = []
    for side in (-1, 1):
        cy = side * outlet_spacing / 2
        cutters.append(hole([(x, y + cy) for x, y in face_outline], depth, depth - 0.0035, PLASTIC))
        face = slab("outlet_face", {"outline": [(x, y + cy) for x, y in face_outline], "z_low": depth - 0.003, "z_high": face_top})
        blade_y = cy + 0.0035
        flat = math.asin(0.0014 / 0.0026)
        arc = [-flat + (math.pi + 2 * flat) * step / 24 for step in range(25)]
        ground = [(0.0026 * math.cos(angle), cy - 0.0084 + 0.0026 * math.sin(angle)) for angle in arc]
        cut(
            face,
            [
                hole(rounded_rectangle({"centre": (-0.00635, blade_y), "width": 0.002, "height": 0.0083, "radius": 0.0002}), face_top, face_floor),
                hole(rounded_rectangle({"centre": (0.00635, blade_y), "width": 0.002, "height": 0.0068, "radius": 0.0002}), face_top, face_floor),
                hole(ground, face_top, face_floor),
            ],
        )
    plate({"width": 0.06985, "height": 0.1143, "depth": depth, "radius": 0.002, "bevel": 0.002, "cutters": cutters})
    slab("screw", {"outline": circle((0, 0), 0.0032), "z_low": depth - 0.001, "z_high": depth + 0.0008, "bevel": 0.0006})
    slab("screw_slot", {"outline": rounded_rectangle({"width": 0.0045, "height": 0.0006}), "z_low": depth + 0.0003, "z_high": depth + 0.0009, "material": HOLE})


def build_type_c_f():
    """Schuko: 80.7 x 80.7 mm frame, 55 mm insert, 39 mm round recess, 4.8 mm holes 19 mm apart, earth clips top and bottom."""
    depth = 0.011
    insert_face = 0.0095
    recess_floor = 0.004
    recess = circle((0, 0), 0.0195, 64)
    notches = [rounded_rectangle({"centre": (0, side * 0.0182), "width": 0.0105, "height": 0.004, "radius": 0.001}) for side in (-1, 1)]
    cutters = [
        hole(rounded_rectangle({"width": 0.056, "height": 0.056, "radius": 0.0042}), depth, 0.0085, PLASTIC),
        hole(recess, depth, recess_floor, PLASTIC),
        *[hole(notch, depth, recess_floor, PLASTIC) for notch in notches],
        *[hole(circle((x, 0), 0.0026, 32), recess_floor) for x in (-0.0095, 0.0095)],
    ]
    plate({"width": 0.0807, "height": 0.0807, "depth": depth, "radius": 0.006, "bevel": 0.002, "cutters": cutters})
    insert = slab("insert", {"outline": rounded_rectangle({"width": 0.055, "height": 0.055, "radius": 0.0038}), "z_low": 0.0085, "z_high": insert_face, "bevel": 0.0006})
    cut(insert, [hole(recess, insert_face, 0.008, PLASTIC), *[hole(notch, insert_face, 0.008, PLASTIC) for notch in notches]])
    for side in (-1, 1):
        slab(
            "earth_clip",
            {"outline": rounded_rectangle({"centre": (0, side * 0.0187), "width": 0.0085, "height": 0.0016, "radius": 0.0004}), "z_low": recess_floor, "z_high": insert_face - 0.0015, "material": METAL},
        )


def build_type_i():
    """Australian switched socket: 115 x 73 mm horizontal plate, blades 6.35 x 1.6 mm at 30 degrees, 13.7 mm apart, earth below."""
    depth = 0.009
    panel_floor = 0.0015
    hole_floor = 0.0025
    panel_top = depth - 0.0006
    socket = (0.016, -0.002)
    plate({"width": 0.115, "height": 0.073, "depth": depth, "radius": 0.006, "bevel": 0.0045, "cutters": [hole(rounded_rectangle({"width": 0.0942, "height": 0.0572, "radius": 0.0056}), depth, panel_floor, PLASTIC)]})
    panel = slab("panel", {"outline": rounded_rectangle({"width": 0.093, "height": 0.056, "radius": 0.005}), "z_low": panel_floor, "z_high": panel_top, "bevel": 0.0005})
    cutters = []
    for side in (-1, 1):
        centre = (socket[0] + side * 0.00686, socket[1] + 0.00396)
        slot = rounded_rectangle({"centre": centre, "width": 0.0021, "height": 0.0072, "radius": 0.0002})
        cutters.append(hole(rotated(slot, centre, side * math.radians(30)), panel_top, hole_floor))
    earth = (socket[0], socket[1] - 0.0103)
    cutters.append(hole(circle(earth, 0.0048, 40), panel_top, panel_top - 0.0006, PLASTIC))
    cutters.append(hole(rounded_rectangle({"centre": earth, "width": 0.0021, "height": 0.0072, "radius": 0.0002}), panel_top, hole_floor))
    switch_centre = (-0.022, 0.004)
    cutters.append(hole(rounded_rectangle({"centre": switch_centre, "width": 0.0135, "height": 0.0165, "radius": 0.0038}), panel_top, panel_top - 0.003, HOLE))
    cut(panel, cutters)
    rocker({"centre": switch_centre, "width": 0.0125, "height": 0.0155, "radius": 0.0033, "depth": panel_top, "z_low_end": panel_top + 0.0002, "z_top": depth})


def build_usb():
    depth = 0.008
    uk_plate({"width": 0.086, "depth": depth, "screw_x": UK_SCREW_X_M, "cutters": [usb_c((0, 0.009), depth, vertical=False), usb_a((0, -0.009), depth, vertical=False)]})


BUILDERS = {
    "type-g": build_type_g,
    "type-g-usb": build_type_g_usb,
    "type-g-double": build_type_g_double,
    "type-a-b": build_type_a_b,
    "type-c-f": build_type_c_f,
    "type-i": build_type_i,
    "usb": build_usb,
}


def finish():
    """Turn every part from file coordinates into Blender space, smooth curved faces, shade axis-aligned faces flat and keep creases sharp."""
    for obj in [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]:
        mesh = obj.data
        mesh.transform(FILE_TO_BLENDER)
        mesh.set_sharp_from_angle(angle=math.radians(40))
        for polygon in mesh.polygons:
            polygon.use_smooth = not any(abs(abs(component) - 1) < 1e-4 for component in polygon.normal)
        mesh.update()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", required=True, choices=list(BUILDERS))
    parser.add_argument("--output", required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    BUILDERS[args.type]()
    finish()
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_yup=True)
    print("RESULT " + json.dumps({"type": args.type, "parts": sorted(obj.name for obj in bpy.context.scene.objects)}))


main()
