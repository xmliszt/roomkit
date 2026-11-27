import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

from photo_geometry import wall_segments


def collect_probes(manifest, scene, convert):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bpy.context.view_layer.update()
    width, height = manifest["output"]["widthPx"], manifest["output"]["heightPx"]
    origin = scene.camera.location.copy()
    result = []
    required = set()

    def probe(target, identifier, kind="wall"):
        world = convert(target)
        projected = world_to_camera_view(scene, scene.camera, world)
        if projected.z <= 0 or not (0.01 < projected.x < 0.99 and 0.01 < projected.y < 0.99):
            return
        required.add(identifier)
        direction = (world - origin).normalized()
        start = origin.copy()
        for _ in range(20):
            hit, location, _, _, obj, _ = scene.ray_cast(depsgraph, start, direction)
            if not hit:
                return
            if not obj.visible_camera:
                start = location + direction * 0.001
                continue
            if obj.name == identifier or obj.get("planner_item_id") == identifier:
                result.append({"id": identifier, "kind": kind, "x": min(width - 1, int(projected.x * width)), "y": min(height - 1, int((1 - projected.y) * height))})
            return

    room = manifest["scene"]["room"]
    for segment in wall_segments(room):
        if segment["id"] in manifest["view"]["hiddenSurfaceIds"] or segment["kind"] == "open":
            continue
        for u in [0.25, 0.35, 0.45, 0.55, 0.65, 0.75]:
            for v in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85]:
                probe((segment["start"]["x"] + segment["dx"] * segment["length"] * u, room["ceilingHeightM"] * v, segment["start"]["z"] + segment["dz"] * segment["length"] * u), segment["id"])
    for item in manifest["scene"]["items"]:
        if "chair" not in item["name"].lower() or not any(word in item["name"].lower() for word in ["orange", "yellow", "suede"]):
            continue
        placement = item["placement"]
        if placement["kind"] != "floor":
            continue
        transform = Matrix.Translation(Vector((placement["xM"], placement["elevationM"], placement["zM"]))) @ Matrix.Rotation(placement["rotationRad"], 4, "Y")
        size = item["sizeM"]
        for x in [-0.3, -0.1, 0.1, 0.3]:
            for y in [0.25, 0.4, 0.55, 0.7]:
                probe(transform @ Vector((x * size["width"], y * size["height"], size["depth"] * 0.3)), item["id"], "item")
    return {"requiredColourIds": sorted(required), "colourProbes": result}
