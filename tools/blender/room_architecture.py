"""Editable room shell and packed architectural finishes for the aquarium scene."""

import math

import bpy
import numpy as np

from room_textures import TEXTURES, photo_surface, unlit_image_material
from tank_layout import TANK


LEFT_WALL_X = TANK["leftWall"]
RIGHT_WALL_X = TANK["rightWall"]
ROOM_WIDTH = RIGHT_WALL_X - LEFT_WALL_X
ROOM_CENTER_X = (LEFT_WALL_X + RIGHT_WALL_X) / 2
ROOM_DEPTH = 4.95
FLOOR_Z = -0.80
CEILING_Z = FLOOR_Z + 2.75


def _linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _material(name, hex_color, roughness, metallic=0.0):
    rgb = [_linear(int(hex_color[index:index + 2], 16) / 255) for index in (0, 2, 4)]
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*rgb, 1)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return material


def _image(name, colors, non_color=False):
    height, width, _ = colors.shape
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = colors
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    image.pixels.foreach_set(rgba.ravel())
    image.file_format = "PNG"
    image.pack()
    return image


def _set_texture(material, image, input_name="Base Color"):
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    links.new(texture.outputs["Color"], nodes.get("Principled BSDF").inputs[input_name])
    return texture


def _set_normal(material, name, height, strength):
    slope_y, slope_x = np.gradient(height)
    vectors = np.stack((-slope_x, -slope_y, np.ones_like(height)), axis=-1)
    vectors /= np.linalg.norm(vectors, axis=-1, keepdims=True)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = _image(name, 0.5 + vectors * 0.5, non_color=True)
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = strength
    links.new(tex.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], nodes.get("Principled BSDF").inputs["Normal"])


def _smooth_noise(rng, size, divisions):
    seeds = rng.standard_normal((divisions, divisions))
    position = np.arange(size) * divisions / size
    previous = position.astype(np.int32)
    following = (previous + 1) % divisions
    t = position - previous
    t = t * t * (3 - 2 * t)
    rows = seeds[:, previous] * (1 - t) + seeds[:, following] * t
    return rows[previous] * (1 - t[:, None]) + rows[following] * t[:, None]


def _mesh(collection, name, vertices, faces, material=None, parent=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.parent = parent
    if material is not None:
        data.materials.append(material)
    return obj


def _box(collection, name, location, dimensions, material, parent=None, bevel=0.0):
    x, y, z = [value * 0.5 for value in dimensions]
    vertices = [
        (-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
        (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z),
    ]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = _mesh(collection, name, vertices, faces, material, parent)
    obj.location = location
    if bevel > 0:
        modifier = obj.modifiers.new("Soft furniture edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        modifier.harden_normals = True
    return obj


def _quad(collection, name, x_bounds, z_bounds, y, material, parent):
    x0, x1 = x_bounds
    z0, z1 = z_bounds
    obj = _mesh(collection, name, [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)],
                [(0, 1, 2, 3)], material, parent)
    uv = obj.data.uv_layers.new(name="UVMap")
    for corner, position in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        corner.uv = position
    return obj


def _floor(collection):
    wood = _material("Floor · photographed cool oak boards", "99928B", 0.53)
    photo_surface(wood, "wooden_floor_02", tint="99928B", contrast=0.76,
                  normal_strength=0.43, roughness_range=(0.41, 0.65))
    slab = _box(collection, "Photographed oak plank floor", (ROOM_CENTER_X, 0, FLOOR_Z - 0.02),
                (ROOM_WIDTH, ROOM_DEPTH, 0.04), wood, bevel=0.001)
    tile_metres = 1.942
    uv = slab.data.uv_layers.new(name="Oak plank scale in metres")
    for face in slab.data.polygons:
        for loop in face.loop_indices:
            point = slab.data.vertices[slab.data.loops[loop].vertex_index].co
            u = point.y if abs(face.normal.x) > 0.5 else point.x + ROOM_CENTER_X
            v = point.y if abs(face.normal.z) > 0.5 else point.z
            uv.data[loop].uv = (u / tile_metres + 0.29, v / tile_metres + 0.17)


def _wall_root(collection, name, location, angle):
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.location = location
    root.rotation_euler.z = angle
    return root


def _wall_piece(collection, root, name, x0, x1, z0, z1, plaster):
    wall = _box(collection, name, ((x0 + x1) / 2, 0.065, (z0 + z1) / 2),
                (x1 - x0, 0.13, z1 - z0), plaster, root)
    uv = wall.data.uv_layers.new(name="Mineral plaster UV")
    for face in wall.data.polygons:
        for loop in face.loop_indices:
            point = wall.data.vertices[wall.data.loops[loop].vertex_index].co + wall.location
            u = point.y if abs(face.normal.x) > 0.5 else point.x
            v = point.y if abs(face.normal.z) > 0.5 else point.z
            uv.data[loop].uv = (u / 0.84, v / 0.84)
    return wall


def _baseboard(collection, root, width, trim):
    return _box(collection, "Satin stone-gray baseboard", (0, -0.010, FLOOR_Z + 0.044),
                (width - 0.002, 0.020, 0.088), trim, root, bevel=0.002)


def _doorway(collection, root, plaster, trim):
    left, right, top = -2.04, -1.08, FLOOR_Z + 2.12
    center = (left + right) / 2
    for name, x0, x1 in [
        ("Door wall left pier", LEFT_WALL_X, left),
        ("Door wall right pier", right, RIGHT_WALL_X),
    ]:
        _wall_piece(collection, root, name, x0, x1, FLOOR_Z, CEILING_Z, plaster)
        sign = -1 if x0 < left else 1
        board_x = (x0 + x1) / 2 + sign * 0.023
        _box(collection, "Baseboard terminating at door casing", (board_x, -0.010, FLOOR_Z + 0.044),
             (x1 - x0 - 0.048, 0.020, 0.088), trim, root, bevel=0.002)
    _wall_piece(collection, root, "Door wall header", left, right, top, CEILING_Z, plaster)

    jamb = _material("Door · satin mushroom-gray casing", "ACA79F", 0.56)
    rebate = _material("Door · shadow-gap rebate", "5D5953", 0.72)
    hardware = _material("Door · satin graphite hardware", "28292A", 0.36, 0.53)
    jamb_height = top - FLOOR_Z
    casing_height = jamb_height - 0.015
    for x, sign in [(left, 1), (right, -1)]:
        _box(collection, "Door casing vertical", (x - sign * 0.019, -0.012, FLOOR_Z + casing_height / 2),
             (0.058, 0.030, casing_height), jamb, root, bevel=0.003)
        _box(collection, "Door jamb lining", (x + sign * 0.014, 0.066, FLOOR_Z + jamb_height / 2),
             (0.028, 0.144, jamb_height), jamb, root, bevel=0.001)
        _box(collection, "Door stop strip", (x + sign * 0.032, 0.038, FLOOR_Z + jamb_height / 2),
             (0.011, 0.014, jamb_height - 0.035), rebate, root, bevel=0.001)
    _box(collection, "Door casing head", (center, -0.012, top + 0.014),
         (right - left + 0.096, 0.030, 0.058), jamb, root, bevel=0.003)
    _box(collection, "Door jamb head lining", (center, 0.066, top - 0.012),
         (right - left, 0.144, 0.024), jamb, root, bevel=0.001)

    hall_floor = _material("Hall · honed warm-gray stone", "86817A", 0.76)
    hall_plaster = _material("Hall · soft taupe-gray plaster", "A8A299", 0.92)
    hall_trim = _material("Hall · matching painted trim", "969087", 0.72)
    hall_width, hall_end = 1.13, 1.22
    hall_start = 0.13
    hall_height = 2.25
    hall_length = hall_end - hall_start
    hall_mid = (hall_start + hall_end) / 2
    _box(collection, "Hall stone floor", (center, (hall_end + 0.09) / 2, FLOOR_Z - 0.019),
         (hall_width, hall_end - 0.09, 0.038), hall_floor, root)
    _box(collection, "Flush doorway threshold", (center, 0.075, FLOOR_Z - 0.006),
         (right - left - 0.014, 0.18, 0.015), hall_floor, root, bevel=0.001)
    for sign in (-1, 1):
        side = center + sign * hall_width / 2
        _box(collection, "Hall return wall", (side, hall_mid, FLOOR_Z + hall_height / 2),
             (0.095, hall_length, hall_height), hall_plaster, root)
        _box(collection, "Hall side skirting", (side - sign * 0.055, hall_mid, FLOOR_Z + 0.032),
             (0.012, hall_length - 0.006, 0.064), hall_trim, root, bevel=0.001)
    _box(collection, "Hall rear wall", (center, hall_end, FLOOR_Z + hall_height / 2),
         (hall_width + 0.095, 0.10, hall_height), hall_plaster, root)
    _box(collection, "Hall rear skirting", (center, hall_end - 0.058, FLOOR_Z + 0.032),
         (hall_width - 0.10, 0.015, 0.064), hall_trim, root, bevel=0.001)
    _box(collection, "Hall ceiling", (center, hall_mid, FLOOR_Z + hall_height + 0.02),
         (hall_width + 0.095, hall_length, 0.04), hall_plaster, root)

    hinge = bpy.data.objects.new("LivingRoomDoor", None)
    collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = (left + 0.035, 0.042, FLOOR_Z + 0.012)
    hinge.rotation_euler.z = math.radians(55)

    oak = _material("Door · grey oak veneer", "948D84", 0.60)
    photo_surface(oak, "grey_oak_veneer_02", tint="948D84", normal_strength=0.34, roughness_range=(0.48, 0.71))
    slab_width, slab_depth, slab_height = 0.89, 0.043, 2.066
    slab = _box(collection, "Full-flush grey oak door slab",
                (slab_width / 2, 0, slab_height / 2), (slab_width, slab_depth, slab_height),
                oak, hinge, bevel=0.003)
    uv = slab.data.uv_layers.new(name="Vertical veneer grain")
    for face in slab.data.polygons:
        for loop in face.loop_indices:
            point = slab.data.vertices[slab.data.loops[loop].vertex_index].co
            u = point.y / slab_depth if abs(face.normal.x) > 0.5 else point.x / slab_width
            v = point.y / slab_depth if abs(face.normal.z) > 0.5 else point.z / slab_height
            uv.data[loop].uv = (v + 0.5, u + 0.5)

    for y_sign in (-1, 1):
        x, z = slab_width - 0.079, 1.021
        _box(collection, "Door handle rose", (x, y_sign * 0.025, z),
             (0.036, 0.010, 0.041), hardware, hinge, bevel=0.005)
        _box(collection, "Door handle stem", (x, y_sign * 0.046, z),
             (0.019, 0.046, 0.020), hardware, hinge, bevel=0.005)
        _box(collection, "Horizontal door lever", (x - 0.046, y_sign * 0.064, z),
             (0.104, 0.018, 0.019), hardware, hinge, bevel=0.006)
    for z in (0.23, 1.04, 1.86):
        _box(collection, "Door butt hinge", (0.001, 0.009, z),
             (0.013, 0.022, 0.068), hardware, hinge, bevel=0.005)


def _plaster_material():
    rng = np.random.default_rng(9370)
    broad = _smooth_noise(rng, 512, 7)
    grain = _smooth_noise(rng, 512, 41)
    fines = _smooth_noise(rng, 512, 136)
    tonal = 0.009 * broad + 0.005 * grain + 0.003 * fines
    neutral = np.array([0.625, 0.617, 0.602])
    plaster = _material("Walls · neutral lime-mineral plaster", "FFFFFF", 0.91)
    image = _image("Mineral plaster | packed tonal grain", np.clip(neutral + tonal[:, :, None], 0, 1))
    _set_texture(plaster, image)
    _set_normal(plaster, "Mineral plaster | packed surface relief", 0.019 * grain + 0.012 * fines, 0.26)
    return plaster


def _sky_backdrop(collection, parent, x0, x1, sill, upper):
    image = bpy.data.images.load(str(TEXTURES / "window-sky.jpg"), check_existing=True)
    material = unlit_image_material("Window sky photograph", image)
    # The sky wraps around the opening so angled views stay filled. Its back
    # clears the outward-swinging casement and the shell casts no shadows.
    x_min, x_max = x0 - 0.04, x1 + 0.04
    z_min, z_max = sill - 0.035, upper + 0.035
    near, far = 0.13, 0.73
    vertices = [(x, y, z) for y in (near, far)
                for x, z in ((x_min, z_min), (x_max, z_min), (x_max, z_max), (x_min, z_max))]
    faces = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    sky = _mesh(collection, "WindowSky", vertices, faces, material, parent)
    for ray in ("shadow", "diffuse", "glossy", "transmission"):
        setattr(sky, "visible_" + ray, False)
    uv = sky.data.uv_layers.new(name="Sky photograph projection")
    center_x, center_z = (x0 + x1) / 2, (sill + upper) / 2
    for loop, corner in zip(sky.data.loops, uv.data):
        x, y, z = vertices[loop.vertex_index]
        scale = (1.9 + near) / (1.9 + y)
        corner.uv = (0.5 + (x - center_x) * scale / (x_max - x_min),
                     0.5 + (z - center_z) * scale / (z_max - z_min))


def _curtain_panel(collection, parent, name, start, end, upper, fabric, hem, phase):
    columns, rows = 86, 64
    vertices = []
    for row in range(rows + 1):
        v = row / rows
        for column in range(columns + 1):
            u = column / columns
            threading = u * math.tau * 5.4 + phase + v * 0.35 + 0.25 * math.sin(math.tau * u * 1.85)
            fold = math.sin(threading) + 0.23 * math.sin(2 * threading + 0.42)
            sag = 0.006 * math.sin(5.5 * v + 1.25 * u) * (1 - v)
            spread = 1 + 0.095 * (1 - v) ** 2 + 0.025 * math.sin(math.pi * v)
            x = (start + end) * 0.5 + (end - start) * (u - 0.5) * spread + sag
            y = -0.149 + (0.043 + 0.014 * (1 - v) ** 2) * fold + 0.009 * math.sin(math.pi * v)
            bottom = 0.004 + 0.0045 * (0.5 + 0.5 * math.cos(threading + 0.44))
            z = FLOOR_Z + v * (upper - FLOOR_Z) + bottom * (1 - v) ** 8
            vertices.append((x, y, z))
    faces = []
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            faces.append((a, a + 1, a + columns + 2, a + columns + 1))
    curtain = _mesh(collection, name, vertices, faces, fabric, parent)
    curtain.data.materials.append(hem)
    uv = curtain.data.uv_layers.new(name="Linen unwrapped")
    width_repeats = (end - start) * 1.7 / 0.2707
    height_repeats = (upper - FLOOR_Z) / 0.2713
    for face in curtain.data.polygons:
        face.use_smooth = True
        row, column = divmod(face.index, columns)
        if row == 0 or column in (0, columns - 1):
            face.material_index = 1
        for loop in face.loop_indices:
            vertex = curtain.data.loops[loop].vertex_index
            v, u = divmod(vertex, columns + 1)
            uv.data[loop].uv = (u / columns * width_repeats, v / rows * height_repeats)
    shell = curtain.modifiers.new("Thin folded textile", "SOLIDIFY")
    shell.thickness = 0.0013
    shell.offset = 0.0
    return curtain


def _casement(collection, wall, name, hinge_x, width, z_bounds, angle, materials, right_hinge=False):
    graphite, edge, glass = materials
    sash = _wall_root(collection, name, (hinge_x, 0.024, 0), angle)
    sash.parent = wall
    x0 = -width if right_hinge else 0
    x1 = x0 + width
    z0, z1 = z_bounds
    mid_x, mid_z = (x0 + x1) / 2, (z0 + z1) / 2
    height = z1 - z0
    rim = 0.026
    for x in (x0 + rim / 2, x1 - rim / 2):
        _box(collection, "Casement stile", (x, 0, mid_z), (rim, 0.046, height),
             graphite, sash, bevel=0.002)
    for z in (z0 + rim / 2, z1 - rim / 2):
        _box(collection, "Casement edge rail", (mid_x, 0, z), (width - 2 * rim, 0.046, rim),
             graphite, sash, bevel=0.002)
    for t in (0.33, 0.69):
        _box(collection, "Casement slim crossbar", (mid_x, -0.004, z0 + t * height),
             (width - 2 * rim, 0.034, 0.020), graphite, sash, bevel=0.0015)

    seal = 0.006
    for x in (x0 + rim + seal / 2, x1 - rim - seal / 2):
        _box(collection, "Casement vertical weatherseal", (x, 0.007, mid_z),
             (seal, 0.015, height - 2 * rim), edge, sash)
    for z in (z0 + rim + seal / 2, z1 - rim - seal / 2):
        _box(collection, "Casement horizontal weatherseal", (mid_x, 0.007, z),
             (width - 2 * (rim + seal), 0.015, seal), edge, sash)
    glazing = _quad(collection, f"{name} · glass", (x0 + rim + seal / 2, x1 - rim - seal / 2),
                    (z0 + rim + seal / 2, z1 - rim - seal / 2), 0.005, glass, sash)
    glazing.visible_shadow = False

    handle_x = x0 + rim / 2 if right_hinge else x1 - rim / 2
    handle_z = mid_z - 0.125
    _box(collection, "Casement handle plate", (handle_x, -0.027, handle_z),
         (0.017, 0.009, 0.062), edge, sash, bevel=0.003)
    _box(collection, "Casement handle grip", (handle_x, -0.042, handle_z - 0.018),
         (0.013, 0.020, 0.094), graphite, sash, bevel=0.004)
    hinge_offset = -0.008 if right_hinge else 0.008
    for t in (0.15, 0.85):
        _box(collection, "Casement pivot hinge", (hinge_offset, 0.031, z0 + t * height),
             (0.018, 0.022, 0.066), graphite, sash, bevel=0.004)


def _window(collection, parent, plaster):
    x0, x1 = -1.79, 0.35
    sill, upper = -0.095, 1.31
    half_span = ROOM_DEPTH / 2
    for name, bounds in [
        ("Window wall left pier", (-half_span, x0, FLOOR_Z, CEILING_Z)),
        ("Window wall right pier", (x1, half_span, FLOOR_Z, CEILING_Z)),
        ("Window apron", (x0, x1, FLOOR_Z, sill)),
        ("Window header", (x0, x1, upper, CEILING_Z)),
    ]:
        _wall_piece(collection, parent, name, *bounds, plaster)

    graphite = _material("Window · charcoal powder coat", "1A1C1E", 0.39, 0.18)
    edge = _material("Window · rubber glazing seal", "121315", 0.8)
    ledge = _material("Window · honed limestone sill", "B9B5AD", 0.63)
    glass = _material("Window · clear neutral glazing", "EAEAE5", 0.10)
    glass.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value = 0.075
    if hasattr(glass, "surface_render_method"):
        glass.surface_render_method = "BLENDED"
    elif hasattr(glass, "blend_method"):
        glass.blend_method = "BLEND"
    _sky_backdrop(collection, parent, x0, x1, sill, upper)

    mid_x, mid_z = (x0 + x1) / 2, (sill + upper) / 2
    for x, thickness in [(x0 + 0.024, 0.048), (mid_x, 0.044), (x1 - 0.024, 0.048)]:
        _box(collection, "Fixed window jamb", (x, -0.010, mid_z),
             (thickness, 0.081, upper - sill), graphite, parent, bevel=0.002)
    for z in (sill + 0.022, upper - 0.022):
        _box(collection, "Fixed window header or sill rail", (mid_x, -0.010, z),
             (x1 - x0, 0.081, 0.043), graphite, parent, bevel=0.002)
    materials = (graphite, edge, glass)
    width = (x1 - x0) / 2 - 0.082
    z_bounds = (sill + 0.052, upper - 0.052)
    # Local +Y points outside. Swing the bay visible beyond the near frame toward it.
    _casement(collection, parent, "RoomWindowOpenCasement", x0 + 0.054, width,
              z_bounds, math.radians(29), materials)
    _casement(collection, parent, "RoomWindowClosedCasement", x1 - 0.054, width,
              z_bounds, 0, materials, right_hinge=True)
    _box(collection, "Projecting interior window sill", (mid_x, -0.033, sill - 0.018),
         (x1 - x0 + 0.09, 0.18, 0.034), ledge, parent, bevel=0.004)
    hang = upper + 0.19
    _box(collection, "Slim curtain track", (mid_x, -0.145, hang + 0.013), (x1 - x0 + 0.61, 0.039, 0.027),
         graphite, parent, bevel=0.005)
    linen = _material("Curtain · natural ivory linen", "D9D2C5", 0.91)
    hem = _material("Curtain · folded linen hem", "CFC8BC", 0.89)
    photo_surface(linen, "rough_linen", tint="D9D2C5", contrast=0.34,
                  normal_strength=0.18, roughness_range=(0.83, 0.96))
    _curtain_panel(collection, parent, "BreezeCurtain",
                   x0 - 0.31, x0 + 0.16, hang, linen, hem, 0.32)
    _curtain_panel(collection, parent, "Right relaxed linen curtain",
                   x1 - 0.13, x1 + 0.30, hang, linen, hem, 0.78)


def _print(collection, root):
    x, y = np.meshgrid(np.linspace(0, 1, 480), np.linspace(0, 1, 326))
    palette = np.array([[0.76, 0.76, 0.74], [0.61, 0.63, 0.63], [0.39, 0.45, 0.48],
                        [0.28, 0.34, 0.39], [0.68, 0.68, 0.65]])
    indices = np.where(x < 0.50, 0, 1)
    indices[(x < 0.50) & (y < 0.54)] = 2
    indices[(x / 0.53) ** 2 + (y / 0.72) ** 2 < 0.97] = 3
    indices[(x >= 0.50) & (y < 0.44 - 0.39 * ((1 - x) / 0.54) ** 2)] = 4
    noise = np.random.default_rng(86).normal(0, 0.009, x.shape)
    paper_material = _material("Framed print · geometric tones", "FFFFFF", 0.88)
    _set_texture(paper_material, _image("Geometric print | packed paper art",
                                       np.clip(palette[indices] + noise[:, :, None], 0, 1)))
    frame = _material("Wall art · black brushed frame", "171819", 0.44, 0.09)
    mat = _material("Wall art · uncoated mat board", "D8D5CD", 0.88)
    center_x, center_z = -0.46, 0.83
    width, height = 0.870, 0.568
    _box(collection, "Single framed study", (center_x, -0.018, center_z), (width, 0.036, height),
         frame, root, bevel=0.004)
    _quad(collection, "Art print mat", (center_x - width / 2 + 0.019, center_x + width / 2 - 0.019),
          (center_z - height / 2 + 0.019, center_z + height / 2 - 0.019), -0.0372, mat, root)
    _quad(collection, "Muted geometric paper artwork", (center_x - width / 2 + 0.065, center_x + width / 2 - 0.065),
          (center_z - height / 2 + 0.052, center_z + height / 2 - 0.052), -0.038, paper_material, root)


def build_architecture():
    collection = bpy.data.collections.new("01 · Architecture")
    bpy.context.scene.collection.children.link(collection)
    _floor(collection)
    plaster = _plaster_material()
    trim = _material("Baseboard · warm neutral satin", "B4B1AB", 0.72)
    ceiling = _wall_root(collection, "RoomCeiling", (ROOM_CENTER_X, 0, CEILING_Z), 0)
    ceiling_finish = _material("Ceiling · matte off-white", "D1CECA", 0.89)
    lid = _box(collection, "Interior ceiling", (0, 0, 0.041), (ROOM_WIDTH + 0.23, ROOM_DEPTH + 0.23, 0.082),
               ceiling_finish, ceiling)
    lid.visible_camera = False
    back = _wall_root(collection, "RoomWallBack", (0, ROOM_DEPTH / 2, 0), 0)
    front = _wall_root(collection, "RoomWallFront", (ROOM_CENTER_X, -ROOM_DEPTH / 2, 0), math.pi)
    left = _wall_root(collection, "RoomWallLeft", (LEFT_WALL_X, 0, 0), math.pi / 2)
    right = _wall_root(collection, "RoomWallRight", (RIGHT_WALL_X, 0, 0), -math.pi / 2)
    _doorway(collection, back, plaster, trim)
    for root, span in [(front, ROOM_WIDTH), (left, ROOM_DEPTH)]:
        _wall_piece(collection, root, "Smooth mineral wall", -span / 2, span / 2, FLOOR_Z, CEILING_Z, plaster)
        _baseboard(collection, root, span, trim)
    _window(collection, right, plaster)
    _baseboard(collection, right, ROOM_DEPTH, trim)
    _print(collection, back)
    return collection
