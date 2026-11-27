import math


def wall_segments(room):
    result = []
    walls = room["walls"]
    for index, wall in enumerate(walls):
        start = wall["startM"]
        end = walls[(index + 1) % len(walls)]["startM"]
        dx, dz = end["x"] - start["x"], end["z"] - start["z"]
        length = math.hypot(dx, dz)
        result.append({"id": wall["id"], "kind": wall["kind"], "start": start, "length": length, "dx": dx / length, "dz": dz / length})
    return result


def clip(polygon, a, b, inside=True):
    def distance(p):
        return ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (1 if inside else -1)
    result = []
    for index, p in enumerate(polygon):
        q = polygon[(index + 1) % len(polygon)]
        dp, dq = distance(p), distance(q)
        if dp >= -1e-8:
            result.append(p)
        if (dp < -1e-8 and dq > 1e-8) or (dp > 1e-8 and dq < -1e-8):
            result.append(tuple(p[j] + (q[j] - p[j]) * dp / (dp - dq) for j in range(2)))
    return result


def wall_polygons(segment, height, items):
    pieces = [[(0, 0), (segment["length"], 0), (segment["length"], height), (0, height)]]
    for item in items:
        p = item["placement"]
        if not item.get("cutsOpening") or p["kind"] != "wall" or p["wallId"] != segment["id"]:
            continue
        c, s = math.cos(p["rotationRad"]), math.sin(p["rotationRad"])
        w, h = item["sizeM"]["width"] / 2, item["sizeM"]["height"] / 2
        cut = [(p["alongM"] + x * w * c + y * h * s, p["heightM"] - x * w * s + y * h * c) for x, y in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        bottom = min(y for _, y in cut)
        if 0 < bottom <= 0.05 + 1e-8:
            cut = [(x, 0 if abs(y - bottom) < 1e-8 else y) for x, y in cut]
        outside = []
        for piece in pieces:
            remainder = piece
            for index, a in enumerate(cut):
                b = cut[(index + 1) % len(cut)]
                candidate = clip(remainder, a, b, inside=False)
                if len(candidate) >= 3:
                    outside.append(candidate)
                remainder = clip(remainder, a, b)
        pieces = outside
    return pieces


def item_frame(item, room, segments):
    p = item["placement"]
    if p["kind"] == "wall":
        wall = next(wall for wall in segments if wall["id"] == p["wallId"])
        yaw = math.atan2(wall["dz"], -wall["dx"])
        position = [wall["start"]["x"] + wall["dx"] * p["alongM"], p["heightM"], wall["start"]["z"] + wall["dz"] * p["alongM"]]
        depth = min(item["sizeM"]["depth"], 0.12) if item.get("cutsOpening") else item["sizeM"]["depth"]
        if item.get("cutsOpening"):
            offset = -(0.12 + depth) / 2
            position[0] += math.sin(yaw) * offset
            position[2] += math.cos(yaw) * offset
        return position, yaw, p["rotationRad"], depth
    y = room["ceilingHeightM"] if p["kind"] == "ceiling" else p["elevationM"] + (0.001 if item["sizeM"]["height"] <= 0.03 else 0)
    return [p["xM"], y, p["zM"]], p["rotationRad"], 0, item["sizeM"]["depth"]


def kelvin_rgb(kelvin):
    temperature = kelvin / 100
    red = 255 if temperature <= 66 else 329.698727446 * (temperature - 60) ** -0.1332047592
    green = 99.4708025861 * math.log(temperature) - 161.1195681661 if temperature <= 66 else 288.1221695283 * (temperature - 60) ** -0.0755148492
    blue = 255 if temperature >= 66 else 0 if temperature <= 19 else 138.5177312231 * math.log(temperature - 10) - 305.0447927307
    return tuple(max(0, min(1, value / 255)) for value in (red, green, blue))
