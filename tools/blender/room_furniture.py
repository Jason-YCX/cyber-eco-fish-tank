"""Editable furnishings for the cool-tone, centered aquarium layout."""

import math

import bpy
import numpy as np
from mathutils import Vector
from room_textures import photo_surface
from tank_layout import TANK


FLOOR = -0.80
CABINET_TOP = -TANK["matThickness"]
LOUNGE_SHIFT_X = -0.30
LINEN_REPEAT = (1 / 0.2707, 1 / 0.2713)
RUG_REPEAT = (1 / 0.3148, 1 / 0.3901)
VENEER_REPEAT = (1.0, 1.0)


def encoded(color):
    return tuple(int(color[i:i + 2], 16) / 255 for i in (0, 2, 4))


def linear(color):
    return tuple(c / 12.92 if c < 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in encoded(color))


def material(name, color, roughness=0.6, metallic=0.0):
    surface = bpy.data.materials.new(name)
    surface.use_nodes = True
    surface.diffuse_color = (*linear(color), 1)
    shader = surface.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = surface.diffuse_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return surface


def packed_image(name, colors):
    height, width = colors.shape[:2]
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = "sRGB"
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(colors, 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    return image


def fabric(name, color, *, rug=False):
    surface = material(name, color, 0.88)
    shader = surface.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Specular IOR Level"].default_value = 0.26
    shader.inputs["Sheen Weight"].default_value = 0.19 if rug else 0.17
    photo_surface(surface, "wool_boucle" if rug else "rough_linen", tint=color,
                  contrast=0.32 if rug else 1.55,
                  normal_strength=0.50 if rug else 0.68,
                  roughness_range=(0.81, 0.96) if rug else (0.76, 0.92))
    return surface


def collection(name):
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def anchor(name, group, location=(0, 0, 0), heading=0.0):
    obj = bpy.data.objects.new(name, None)
    group.objects.link(obj)
    obj.location = location
    obj.rotation_euler.z = heading
    return obj


def mesh(name, group, parent, vertices, faces, surface, location=(0, 0, 0)):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    group.objects.link(obj)
    obj.parent = parent
    obj.location = location
    if surface is not None:
        data.materials.append(surface)
    return obj


def planar_uv(obj, repeat, *, vertical_grain=False):
    data = obj.data
    uv = data.uv_layers.new(name="Surface UV")
    repeat_u, repeat_v = repeat
    offset = obj.location if vertical_grain else (0, 0, 0)
    for polygon in data.polygons:
        dominant = max(range(3), key=lambda i: abs(polygon.normal[i]))
        keep = [index for index in (0, 1, 2) if index != dominant]
        if vertical_grain and dominant != 2:
            keep.reverse()
        u, v = keep
        for loop in polygon.loop_indices:
            coord = data.vertices[data.loops[loop].vertex_index].co
            uv.data[loop].uv = ((coord[u] + offset[u]) * repeat_u, (coord[v] + offset[v]) * repeat_v)


BOX_FACES = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))


def box_vertices(width, depth, height):
    x, y, z = width / 2, depth / 2, height / 2
    return [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
            (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]


def edge_rounding(obj, radius, segments=3):
    bevel = obj.modifiers.new("Soft manufactured edges", "BEVEL")
    bevel.width = radius
    bevel.segments = segments
    bevel.limit_method = "ANGLE"
    bevel.harden_normals = True
    normal = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    normal.keep_sharp = True
    for face in obj.data.polygons:
        face.use_smooth = True


def box(name, group, parent, dims, location, surface, radius=0.0, *, uv_repeat=None):
    obj = mesh(name, group, parent, box_vertices(*dims), BOX_FACES, surface, location)
    if uv_repeat is not None:
        planar_uv(obj, uv_repeat)
    if radius > 0:
        edge_rounding(obj, radius)
    return obj


def lathe(name, group, parent, profile, location, surface, sides=36, closed=False):
    vertices = [
        (radius * math.cos(step * math.tau / sides), radius * math.sin(step * math.tau / sides), height)
        for radius, height in profile for step in range(sides)
    ]
    faces = []
    for row in range(len(profile) if closed else len(profile) - 1):
        start, end = row * sides, ((row + 1) % len(profile)) * sides
        for step in range(sides):
            nxt = (step + 1) % sides
            faces.append((start + step, start + nxt, end + nxt, end + step))
    if not closed:
        faces.extend([tuple(reversed(range(sides))), tuple(range(len(vertices) - sides, len(vertices)))])
    obj = mesh(name, group, parent, vertices, faces, surface, location)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def taper(name, group, parent, bottom, top, low, high, x, y, surface):
    lip = min((high - low) / 10, 0.002)
    return lathe(name, group, parent, [(bottom - lip, 0), (bottom, lip),
                                       (top, high - low - lip), (top - lip, high - low)],
                 (x, y, low), surface, sides=24)


def tube(name, group, parent, points, radius, surface, *, loop=False, sides=8):
    vertices, faces = [], []
    points = [Vector(p) for p in points]
    for i, point in enumerate(points):
        previous = points[(i - 1) % len(points)] if loop else points[max(0, i - 1)]
        following = points[(i + 1) % len(points)] if loop else points[min(len(points) - 1, i + 1)]
        tangent = (following - previous).normalized()
        basis = Vector((0, 0, 1)) if abs(tangent.z) < 0.96 else Vector((1, 0, 0))
        u = tangent.cross(basis).normalized()
        v = tangent.cross(u).normalized()
        for j in range(sides):
            angle = math.tau * j / sides
            vertices.append(point + radius * (u * math.cos(angle) + v * math.sin(angle)))
        if i < len(points) - 1 or loop:
            end = ((i + 1) % len(points)) * sides
            for j in range(sides):
                nxt = (j + 1) % sides
                faces.append((i * sides + j, i * sides + nxt, end + nxt, end + j))
    obj = mesh(name, group, parent, vertices, faces, surface)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def round_slab(name, group, parent, dims, radius, location, surface, *, uv_repeat=None):
    width, depth, height = dims
    rim = min(0.006, height * 0.25)
    rings = [(-height / 2, rim), (-height / 2 + rim, 0),
             (height / 2 - rim, 0), (height / 2, rim)]
    vertices, faces = [], []
    for z, inset in rings:
        for quadrant, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
            for side in range(8):
                angle = (quadrant + side / 7) * math.pi / 2
                vertices.append((
                    sx * (width / 2 - radius) + (radius - inset) * math.cos(angle),
                    sy * (depth / 2 - radius) + (radius - inset) * math.sin(angle),
                    z,
                ))
    perimeter = 32
    faces.append(tuple(reversed(range(perimeter))))
    for row in range(len(rings) - 1):
        for i in range(perimeter):
            nxt = (i + 1) % perimeter
            faces.append((row * perimeter + i, row * perimeter + nxt,
                          (row + 1) * perimeter + nxt, (row + 1) * perimeter + i))
    faces.append(tuple(range(len(vertices) - perimeter, len(vertices))))
    obj = mesh(name, group, parent, vertices, faces, surface, location)
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    if uv_repeat is not None:
        planar_uv(obj, uv_repeat)
    return obj


def signpow(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


def cushion(name, group, parent, dims, location, surface, welt=None, soft=0.28, flat=False):
    width, depth, height = dims
    sides, bands = 56, 18
    vertices = [(0, 0, -height / 2)]
    for row in range(1, bands):
        latitude = math.pi * (row / bands - 0.5)
        radius = math.cos(latitude) ** soft
        z = height * 0.5 * signpow(math.sin(latitude), soft)
        for side in range(sides):
            longitude = side * math.tau / sides
            x = width * 0.5 * signpow(math.cos(longitude), soft) * radius
            y = depth * 0.5 * signpow(math.sin(longitude), soft) * radius
            bulge = 1 + 0.019 * math.cos(longitude * 3 + latitude * 3)
            if flat:
                fullness = 1 + 0.040 * math.cos(2 * longitude + latitude) * math.cos(latitude)
                vertices.append((x, y * fullness, z * bulge))
            else:
                dip = 0.0045 * math.exp(-((x / (width * 0.30)) ** 2 + (y / (depth * 0.30)) ** 2))
                vertices.append((x, y, z * bulge - dip * max(0, math.sin(latitude))))
    vertices.append((0, 0, height / 2))
    top = len(vertices) - 1
    faces = []
    for side in range(sides):
        nxt = (side + 1) % sides
        faces.append((0, 1 + nxt, 1 + side))
        for row in range(bands - 2):
            a = 1 + row * sides
            faces.append((a + side, a + nxt, a + sides + nxt, a + sides + side))
        last = 1 + (bands - 2) * sides
        faces.append((last + side, last + nxt, top))
    obj = mesh(name, group, parent, vertices, faces, surface, location)
    uv = obj.data.uv_layers.new(name="Upholstery weave")
    repeat_u, repeat_v = LINEN_REPEAT
    for face in obj.data.polygons:
        face.use_smooth = True
        for loop in face.loop_indices:
            index = obj.data.loops[loop].vertex_index
            x, y, z = vertices[index]
            if flat:
                uv.data[loop].uv = (repeat_u * x, repeat_v * (z + 0.29 * y))
            else:
                uv.data[loop].uv = (repeat_u * x, repeat_v * (y + 0.29 * z))
    if welt:
        if flat:
            path = []
            for step in range(sides):
                angle = step * math.tau / sides
                path.append((width * 0.498 * signpow(math.cos(angle), soft), 0,
                             height * 0.490 * signpow(math.sin(angle), soft)))
        else:
            path = vertices[1 + (bands // 2 - 1) * sides:1 + bands // 2 * sides]
        tube(name + " welt", group, obj, path, 0.00135, welt, loop=True, sides=6)
    return obj


def build_cabinet(group):
    root = anchor("AquariumCabinet", group)
    graphite = material("Cabinet • satin charcoal", "4D4E50", 0.65)
    inset = material("Cabinet • dark recessed plinth and reveals", "353638", 0.75)
    for coating in (graphite, inset):
        coating.node_tree.nodes.get("Principled BSDF").inputs["Specular IOR Level"].default_value = 0.28
    photo_surface(graphite, "grey_oak_veneer_02", tint="4D4E50", normal_strength=0.25,
                  roughness_range=(0.59, 0.74))

    width, depth = TANK["cabinetWidth"], TANK["cabinetDepth"]
    top_thickness = 0.024
    top = box("AquariumCabinetTop", group, root, (width, depth, top_thickness),
              (0, 0, CABINET_TOP - top_thickness / 2), graphite, 0.0024)
    top["support_top_metres"] = CABINET_TOP

    case_width, case_depth = width - 0.020, depth - 0.020
    case_bottom, case_top = FLOOR + 0.080, CABINET_TOP - top_thickness
    case_height = case_top - case_bottom
    case_z = (case_bottom + case_top) / 2
    stile = 0.019
    side_depth = case_depth - 2 * stile
    end_y = (case_depth - stile) / 2
    box("Cabinet structural core", group, root,
        (case_width - 2 * stile, side_depth, case_height),
        (0, 0, case_z), inset, 0.0018)
    box("Finished flush back panel", group, root,
        (case_width, stile, case_height), (0, end_y, case_z), graphite, 0.0018)
    for side, name in ((-1, "Left"), (1, "Right")):
        box(name + " finished cabinet side", group, root, (stile, side_depth, case_height),
            (side * (case_width - stile) / 2, 0, case_z), graphite, 0.0018)
    box("Recessed full-length plinth", group, root,
        (case_width - 0.11, case_depth - 0.13, case_bottom - FLOOR),
        (0, 0, (case_bottom + FLOOR) / 2), inset, 0.003)

    door_count = 4
    reveal = 0.0032
    door_width = (case_width - (door_count + 1) * reveal) / door_count
    door_height = case_height - 2 * reveal
    for index in range(door_count):
        center = (index - (door_count - 1) / 2) * (door_width + reveal)
        box(f"Flush cabinet door {index + 1}", group, root, (door_width, stile, door_height),
            (center, -end_y, case_z), graphite, 0.0012)
    for part in root.children:
        if part.data.materials[0] == graphite:
            planar_uv(part, VENEER_REPEAT, vertical_grain=True)


def build_sofa(group):
    root = anchor("Sofa", group, (-2.000 + LOUNGE_SHIFT_X, 0.09, 0), math.pi / 2)
    frame = fabric("Sofa • slate blue twill", "43505e")
    seat = fabric("Sofa • blue gray cushions", "495766")
    pale = fabric("Pillow • light cool gray", "8b8d8d")
    dark = fabric("Pillow • slate", "46505e")
    piping = material("Upholstery • inset blue welt", "414d5b", 0.9)
    pale_welt = material("Light pillow • tailored seam", "818486", 0.91)
    foot = material("Sofa • ebonized feet", "303131", 0.61)
    box("Upholstered lower apron", group, root, (1.535, 0.670, 0.232),
        (0, 0, -0.551), frame, 0.047, uv_repeat=LINEN_REPEAT)
    box("Sofa back frame", group, root, (1.490, 0.150, 0.58),
        (0, 0.263, -0.324), frame, 0.045, uv_repeat=LINEN_REPEAT)
    for side in (-1, 1):
        box("Padded track arm", group, root, (0.149, 0.668, 0.355),
            (side * 0.700, -0.003, -0.456), frame, 0.037, uv_repeat=LINEN_REPEAT)
        for y in (-0.248, 0.244):
            taper("Recessed sofa foot", group, root, 0.018, 0.027, FLOOR, -0.651, side * 0.650, y, foot)
        cushion("Separable seat cushion", group, root, (0.612, 0.519, 0.130),
                (side * 0.308, -0.067 + side * 0.002, -0.411), seat, piping, soft=0.34)
        back = cushion("Separable back cushion", group, root, (0.614, 0.151, 0.346),
                       (side * 0.307, 0.172, -0.206), seat, piping, soft=0.32, flat=True)
        back.rotation_euler.x = -0.15 + side * 0.028
    one = cushion("Cool light cushion", group, root, (0.286, 0.105, 0.264),
                  (-0.483, 0.024, -0.246), pale, pale_welt, soft=0.41, flat=True)
    one.rotation_euler = (-0.34, -0.24, 0.19)
    two = cushion("Cool dark cushion", group, root, (0.267, 0.101, 0.254),
                  (0.466, 0.028, -0.245), dark, piping, soft=0.40, flat=True)
    two.rotation_euler = (-0.28, 0.18, -0.13)


def build_table_and_rug(group):
    table = anchor("CoffeeTable", group, (-1.46 + LOUNGE_SHIFT_X, -0.33, 0), math.pi / 2)
    matte = material("Coffee table • charcoal powdercoat", "444444", 0.69)
    steel = material("Coffee table • legs", "2d3032", 0.51, 0.27)
    tabletop_z = FLOOR + 0.348
    round_slab("Rounded charcoal table top", group, table, (0.730, 0.370, 0.028), 0.076,
               (0, 0, tabletop_z - 0.014), matte)
    for x in (-0.277, 0.277):
        for y in (-0.143, 0.143):
            taper("Coffee table steel leg", group, table, 0.013, 0.016,
                  FLOOR + 0.013, tabletop_z - 0.021, x, y, steel)
    cover = material("Book • gray cover", "969aa1", 0.74)
    pages = material("Book • paper block", "b7b8b3", 0.88)
    book = anchor("ClosedBook", group, (-0.132, 0.004, tabletop_z), -0.13)
    book.parent = table
    box("Paper block", group, book, (0.145, 0.109, 0.021), (0, 0, 0.0125), pages, 0.0015)
    for z in (0.002, 0.025):
        box("Book cover", group, book, (0.152, 0.117, 0.004), (0, 0, z), cover, 0.0015)
    box("Book spine", group, book, (0.005, 0.117, 0.025), (-0.074, 0, 0.0135), cover, 0.0013)
    ceramic = material("Cup • cool gray glazed ceramic", "b9b9b6", 0.29)
    coffee = material("Cup • coffee", "302a27", 0.27)
    cup = anchor("CeramicMug", group, (0.125, -0.009, tabletop_z))
    cup.parent = table
    lathe("Hollow glazed mug", group, cup, [(0.026, 0.001), (0.031, 0.004),
          (0.031, 0.055), (0.0305, 0.063), (0.027, 0.063), (0.027, 0.014), (0.023, 0.008)],
          (0, 0, 0), ceramic, sides=40, closed=True)
    profile = [(0.0003, 0.034, 0.052), (0.0003, 0.045, 0.052), (0.0003, 0.053, 0.045),
               (0.0003, 0.054, 0.035), (0.0003, 0.049, 0.025), (0.0003, 0.039, 0.019),
               (0.0003, 0.030, 0.019)]
    tube("Mug handle", group, cup, profile, 0.0037, ceramic, sides=10)
    lathe("Coffee surface", group, cup, [(0.0266, 0.045), (0.0271, 0.046)],
          (0, 0, 0), coffee, sides=32)
    rug = anchor("LoungeRug", group, (-1.725 + LOUNGE_SHIFT_X, -0.261, 0))
    selfedge = material("Rug • blue-gray bound edge", "404c58", 0.94)
    loops = fabric("Rug • photographed slate wool pile", "54616d", rug=True)
    round_slab("Rug binding and backing", group, rug, (1.280, 2.400, 0.010), 0.021,
               (0, 0, FLOOR + 0.005), selfedge)
    round_slab("Slate woven loop-pile rug", group, rug, (1.252, 2.372, 0.007), 0.016,
               (0, 0, FLOOR + 0.010), loops, uv_repeat=RUG_REPEAT)


def build_lamp(group):
    root = anchor("FloorLamp", group, (1.39, 1.55, FLOOR))
    powder = material("Floor lamp • black satin shade", "262727", 0.53, 0.0)
    powder.node_tree.nodes.get("Principled BSDF").inputs["Specular IOR Level"].default_value = 0.29
    stem = material("Floor lamp • blackened metal post", "30302f", 0.43, 0.52)
    liner = material("Floor lamp • opal inner diffuser", "b8b4a6", 0.50)
    shader = liner.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Emission Color"].default_value = (*linear("e4dcc5"), 1)
    shader.inputs["Emission Strength"].default_value = 0.13
    taper("Weighted floor lamp base", group, root, 0.120, 0.111, 0, 0.024, 0, 0, stem)
    taper("Thin column", group, root, 0.0080, 0.0078, 0.018, 1.443, 0, 0, stem)
    taper("Post cap", group, root, 0.016, 0.015, 1.485, 1.499, 0, 0, stem)
    lathe("Spun graphite cone shade", group, root,
          [(0.141, 1.30), (0.139, 1.303), (0.063, 1.480), (0.061, 1.484),
           (0.057, 1.484), (0.059, 1.478), (0.135, 1.305), (0.137, 1.30)],
          (0, 0, 0), powder, sides=48, closed=True)
    lathe("Opal underside", group, root, [(0.133, 1.309), (0.134, 1.311)],
          (0, 0, 0), liner, sides=48)


def leaf_material(name, color):
    surface = material(name, color, 0.40)
    tree = surface.node_tree
    shader = tree.nodes.get("Principled BSDF")
    shader.inputs["Specular IOR Level"].default_value = 0.37
    shader.inputs["Coat Weight"].default_value = 0.12
    shader.inputs["Coat Roughness"].default_value = 0.32
    v, u = np.mgrid[0:160, 0:320]
    side = np.abs(v / 159 * 2 - 1)
    run = u / 319
    fine = (np.sin(math.tau * (8 * run + 3 * side)) + np.cos(math.tau * (13 * run - 2 * side))) * 0.006
    ribs = run - side * (0.114 + 0.045 * side) + 0.018 * np.sin(math.tau * (side * 0.51 + run * 2))
    rib_distance = np.abs((ribs + 0.055) % 0.11 - 0.055)
    lateral = np.exp(-np.square(rib_distance / 0.007)) * (1 - 0.74 * side) * np.sin(math.pi * run) ** 0.5
    center = np.exp(-np.square(side / (0.018 + 0.021 * (1 - run)))) * (1.0 - 0.36 * run)
    grain = fine + 0.020 * np.sin(math.pi * run) - 0.017 * side + 0.061 * lateral + 0.110 * center
    colors = np.array(encoded(color)) + grain[..., None] * (0.93, 1.0, 0.63)
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = packed_image(name + " | blade and veins", colors)
    node.extension = "EXTEND"
    node.location = (-280, 205)
    tree.links.new(node.outputs["Color"], shader.inputs["Base Color"])
    return surface


def build_plant(group):
    root = anchor("PottedPlant", group, (1.87, 1.34, FLOOR))
    clay = material("Planter • matte cool mineral gray", "777778", 0.74)
    soil = material("Planter • dark soil", "353631", 0.98)
    stalks = material("Houseplant • mature petiole", "3b5432", 0.73)
    colors = [leaf_material("Houseplant • satin foliage " + str(i + 1), color)
              for i, color in enumerate(("274530", "304f36", "395b3d"))]
    vein = material("Houseplant • olive midrib", "50663a", 0.67)
    lathe("Rounded stoneware planter", group, root,
          [(0.091, 0.0), (0.100, 0.008), (0.115, 0.033), (0.129, 0.081), (0.134, 0.147),
           (0.133, 0.224), (0.126, 0.263), (0.122, 0.269), (0.113, 0.269), (0.111, 0.263),
           (0.113, 0.238), (0.108, 0.050), (0.095, 0.021)],
          (0, 0, 0), clay, sides=64, closed=True)
    lathe("Soil", group, root, [(0.109, 0.239), (0.112, 0.247)], (0, 0, 0), soil, sides=48)

    # The compact lower blades overlap, while long petioles lift a few distinctive upright leaves.
    silhouettes = (
        (25, 0.407, 0.206, 0.067, 0.25), (160, 0.423, 0.241, 0.081, 0.21),
        (-15, 0.495, 0.250, 0.084, 0.37), (195, 0.548, 0.269, 0.084, 0.24),
        (125, 0.583, 0.231, 0.082, 0.46), (-42, 0.620, 0.275, 0.089, 0.49),
        (210, 0.675, 0.281, 0.088, 0.47), (10, 0.708, 0.231, 0.078, 0.51),
        (112, 0.757, 0.258, 0.088, 0.59), (241, 0.794, 0.254, 0.081, 0.55),
        (-61, 0.848, 0.253, 0.082, 0.73), (80, 0.837, 0.217, 0.077, 0.67),
        (174, 0.915, 0.214, 0.078, 0.67),
    )
    up = Vector((0, 0, 1))
    rows, columns = 20, 10
    stride = columns + 1
    for index, (azimuth, stem_height, span, width, rise) in enumerate(silhouettes):
        angle = math.radians(azimuth)
        heading = Vector((math.cos(angle), math.sin(angle), 0))
        across = Vector((-math.sin(angle), math.cos(angle), 0))
        forward = math.sqrt(1 - rise * rise) * heading + rise * up
        normal = forward.cross(across).normalized()
        bottom = 0.021 * heading + 0.244 * up
        spread = 0.062 + (index % 4) * 0.017
        top = spread * heading + stem_height * up
        points = [bottom.lerp(top, part / 9) + heading * (0.024 * math.sin(math.pi * part / 9))
                  for part in range(10)]
        tube("Curved leaf petiole", group, root, points, max(0.0023, 0.0040 - index * 0.00013), stalks)

        def blade_point(t, side):
            wave = math.sin(math.pi * (0.006 + 0.989 * t))
            shape = wave ** 0.76 * (1.12 - 0.24 * t)
            dorsal = math.sin(math.pi * t) * 0.021 - t * t * 0.018
            twist = (0.36 * math.sin(index * 2.14) + 0.25 * t) * side
            camber = (1 - side * side) * 0.012 * shape + 0.0048 * wave * math.sin(14 * t + 3 * side + index)
            return (top + t * span * forward + (width * side * shape) * across +
                    (dorsal + camber + shape * width * twist) * normal)

        vertices = [blade_point(row / rows, 2 * col / columns - 1)
                    for row in range(rows + 1) for col in range(columns + 1)]
        faces = [(row * stride + col, (row + 1) * stride + col,
                  (row + 1) * stride + col + 1, row * stride + col + 1)
                 for row in range(rows) for col in range(columns)]
        blade = mesh("Satin broad leaf", group, root, vertices, faces, colors[index % len(colors)])
        coordinates = blade.data.uv_layers.new(name="Blade veins")
        for face in blade.data.polygons:
            face.use_smooth = True
            for loop in face.loop_indices:
                row, col = divmod(blade.data.loops[loop].vertex_index, stride)
                coordinates.data[loop].uv = (row / rows, col / columns)
        line = [blade_point(part / 24, 0) + 0.00075 * normal for part in range(23)]
        tube("Visible leaf midrib", group, root, line, 0.00052, vein, sides=5)


def build_furniture():
    """Create the reusable furnishings without moving the aquarium origin."""
    build_cabinet(collection("02 Aquarium cabinet"))
    build_sofa(collection("03 Upholstery"))
    build_table_and_rug(collection("04 Lounge accessories"))
    accents = collection("05 Lamp and broad-leaf plant")
    build_lamp(accents)
    build_plant(accents)
