"""Build the editable room, the web model and an optional Blender preview."""

import argparse
import base64
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.noise import noise_vector

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from room_architecture import build_architecture
from room_furniture import CABINET_TOP, build_furniture, edge_rounding
from tank_layout import TANK


def options():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=SCRIPT_DIR.parents[1] / "assets/living-room-v4")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--bake", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def material(name, color, roughness=0.5, transmission=0, ior=1.45):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Transmission Weight"].default_value = transmission
    shader.inputs["IOR"].default_value = ior
    return result


def move_to_collection(obj, collection):
    for source in tuple(obj.users_collection):
        source.objects.unlink(obj)
    collection.objects.link(obj)


def box(name, center, size, surface, collection):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(surface)
    move_to_collection(obj, collection)
    return obj


def ellipsoid(name, center, scale, surface, collection, yaw=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler.z = yaw
    obj.data.materials.append(surface)
    for face in obj.data.polygons:
        face.use_smooth = True
    move_to_collection(obj, collection)
    return obj


def preview_sand_height(x, y):
    inside_width = TANK["width"] - 2 * TANK["glassThickness"]
    inside_depth = TANK["depth"] - 2 * TANK["glassThickness"]
    along = x / inside_width + 0.5
    back = y / inside_depth + 0.5
    ridge = math.sin(along * math.tau * 1.2 + 0.3) * math.sin(back * math.pi)
    return 0.031 + 0.082 * (0.23 * along + 0.77 * back ** 1.3) + 0.008 * ridge


def preview_sand(collection, surface, inside_width, inside_depth):
    vertices = []
    faces = []
    steps = 16
    for j in range(steps + 1):
        t = j / steps
        for i in range(steps + 1):
            u = i / steps
            x, y = inside_width * (u - 0.5), inside_depth * (t - 0.5)
            vertices.append((x, y, preview_sand_height(x, y)))
    for j in range(steps):
        for i in range(steps):
            a = j * (steps + 1) + i
            b = a + steps + 1
            faces.append((a, a + 1, b + 1, b))
    border = [*range(steps + 1)]
    border.extend(j * (steps + 1) + steps for j in range(1, steps + 1))
    border.extend(steps * (steps + 1) + i for i in reversed(range(steps)))
    border.extend(j * (steps + 1) for j in reversed(range(1, steps)))
    bottom = len(vertices)
    vertices.extend((vertices[i][0], vertices[i][1], TANK["glassThickness"]) for i in border)
    for i, start in enumerate(border):
        following = (i + 1) % len(border)
        faces.append((start, bottom + i, bottom + following, border[following]))
    mesh = bpy.data.meshes.new("Preview substrate mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(surface)
    collection.objects.link(bpy.data.objects.new("Preview sand slope", mesh))


def texture_relief(surface, scale, strength, colors=None):
    nodes = surface.node_tree.nodes
    links = surface.node_tree.links
    shader = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexNoise")
    texture.inputs["Scale"].default_value = scale
    texture.inputs["Detail"].default_value = 3.6
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = strength
    bump.inputs["Strength"].default_value = 0.55
    links.new(texture.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    if colors:
        ramp = nodes.new("ShaderNodeValToRGB")
        for point, color in zip(ramp.color_ramp.elements, colors):
            point.color = (*color, 1)
        links.new(texture.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], shader.inputs["Base Color"])


def water_volume(collection, surface, inside_width, inside_depth):
    steps = 60
    vertices = []
    faces = []
    for j in range(steps + 1):
        for i in range(steps + 1):
            u, v = i / steps, j / steps
            x, y = (inside_width + 0.0002) * (u - 0.5), (inside_depth + 0.0002) * (v - 0.5)
            wave = 0.0015 * math.sin(x * 79 + y * 65) + 0.0009 * math.sin(x * 47 - y * 110)
            wave *= math.sin(math.pi * u) * math.sin(math.pi * v)
            vertices.append((x, y, TANK["waterLevel"] + wave))
    for j in range(steps):
        for i in range(steps):
            a = j * (steps + 1) + i
            b = a + steps + 1
            faces.append((a, a + 1, b + 1, b))
    border = [*range(steps + 1)]
    border.extend(j * (steps + 1) + steps for j in range(1, steps + 1))
    border.extend(steps * (steps + 1) + i for i in reversed(range(steps)))
    border.extend(j * (steps + 1) for j in reversed(range(1, steps)))
    bottom = len(vertices)
    vertices.extend((vertices[i][0], vertices[i][1], TANK["glassThickness"]) for i in border)
    for i, start in enumerate(border):
        following = (i + 1) % len(border)
        faces.append((start, bottom + i, bottom + following, border[following]))
    faces.append(tuple(reversed(range(bottom, len(vertices)))))
    mesh = bpy.data.meshes.new("Preview rippled water volume")
    mesh.from_pydata(vertices, [], faces)
    for face in mesh.polygons:
        face.use_smooth = face.index < steps * steps
    mesh.materials.append(surface)
    collection.objects.link(bpy.data.objects.new("Preview aquarium water", mesh))


def aquatic_leaf(collection, origin, angle, rise, reach, width, surface):
    axis = Vector((math.cos(angle), math.sin(angle), 0))
    spread = Vector((-math.sin(angle), math.cos(angle), 0))
    vertices = []
    faces = []
    for i in range(13):
        t = i / 12
        half_width = width * max(0.09, math.sin(math.pi * t) ** 0.88)
        center = origin + axis * (reach * t ** 1.34) + Vector((0, 0, rise * (t - 0.13 * t ** 4)))
        for column in (-1, 0, 1):
            edge = column * half_width
            lift = abs(column) * half_width * (0.29 + 0.11 * math.sin(t * 19 + angle))
            vertices.append(center + spread * edge + Vector((0, 0, lift)))
        if i:
            a = (i - 1) * 3
            faces.extend(((a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)))
    mesh = bpy.data.meshes.new("Preview curved aquatic leaf")
    mesh.from_pydata(vertices, [], faces)
    for face in mesh.polygons:
        face.use_smooth = True
    mesh.materials.append(surface)
    collection.objects.link(bpy.data.objects.new("Preview broad aquatic leaf", mesh))


def aquarium_context(scene):
    collection = bpy.data.collections.new("Aquarium reference · Blender preview only")
    scene.collection.children.link(collection)
    width, depth, height = TANK["width"], TANK["depth"], TANK["height"]
    thickness, mat_thickness = TANK["glassThickness"], TANK["matThickness"]
    inside_width, inside_depth = width - 2 * thickness, depth - 2 * thickness
    lamp_length, lamp_depth = TANK["lampLength"], TANK["lampDepth"]
    diffuser_height, lamp_y = TANK["lampHeight"], -TANK["lampZ"]
    graphite = material("Preview frame", (0.020, 0.028, 0.032), 0.27)
    glass = material("Preview low iron glass", (0.988, 0.998, 0.997), 0.026, 1, 1.46)
    water = material("Preview filtered freshwater", (1.0, 1.0, 1.0), 0.032, 1, 1.333)
    sand = material("Preview fine gray sand", (0.48, 0.46, 0.40), 0.89)
    texture_relief(sand, 405, 0.0016, ((0.25, 0.225, 0.175), (0.58, 0.54, 0.43)))
    stone = material("Preview graphite slate", (0.088, 0.112, 0.117), 0.85)
    texture_relief(stone, 22, 0.008, ((0.035, 0.043, 0.045), (0.23, 0.26, 0.25)))
    leaves = [material(f"Preview aquatic leaf {i}", color, 0.48) for i, color in enumerate((
        (0.19, 0.36, 0.022), (0.08, 0.22, 0.018), (0.28, 0.47, 0.042), (0.042, 0.139, 0.016),
    ))]
    glint = material("Preview silver fish", (0.25, 0.43, 0.46), 0.34)
    gold = material("Preview ochre fish", (0.58, 0.28, 0.08), 0.34)
    light = material("Preview light diffuser", (0.74, 0.88, 1.0), 0.35)
    shader = light.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Emission Color"].default_value = (0.72, 0.86, 1.0, 1.0)
    shader.inputs["Emission Strength"].default_value = 2.0
    rubber = material("Preview matte leveling pad", (0.018, 0.022, 0.024), 0.94)
    pad = box("Preview aquarium leveling mat", (0, 0, CABINET_TOP + mat_thickness / 2),
              (width + 0.0016, depth + 0.0016, mat_thickness), rubber, collection)
    edge_rounding(pad, 0.00055, 2)
    box("Preview bottom glass", (0, 0, thickness / 2), (inside_width, inside_depth, thickness), glass, collection)
    for sign in (-1, 1):
        pane = box("Preview long glass pane", (0, sign * (depth - thickness) / 2, height / 2),
                   (width, thickness, height), glass, collection)
        edge_rounding(pane, 0.00045, 2)
        pane = box("Preview end glass pane", (sign * (width - thickness) / 2, 0, height / 2),
                   (thickness, inside_depth, height), glass, collection)
        edge_rounding(pane, 0.00045, 2)
        box("Preview light support", (sign * (width / 2 - 0.036), lamp_y + 0.037, (height + diffuser_height) / 2),
            (0.010, 0.014, diffuser_height - height), graphite, collection)
        box("Preview light clip", (sign * (width / 2 - 0.020), lamp_y + 0.037, height - 0.001),
            (0.039, 0.027, 0.008), graphite, collection)
    water_volume(collection, water, inside_width, inside_depth)
    box("Preview light housing", (0, lamp_y, diffuser_height + 0.011),
        (lamp_length, lamp_depth, 0.019), graphite, collection)
    box("Preview light diffuser", (0, lamp_y, diffuser_height),
        (lamp_length - 0.020, lamp_depth + 0.0006, 0.0037), light, collection)
    preview_sand(collection, sand, inside_width, inside_depth)

    rock_x, rock_y = 0.28, 0.04
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(rock_x, rock_y, 0))
    rock = bpy.context.object
    rock.name = "Preview slate rock"
    for vertex in rock.data.vertices:
        warp = noise_vector(vertex.co * 2.8)
        vertex.co.x = 0.092 * (vertex.co.x + warp.x * 0.16)
        vertex.co.y = 0.067 * (vertex.co.y + warp.y * 0.20)
        vertex.co.z = 0.061 * (vertex.co.z + 0.25 * vertex.co.x + warp.z * 0.25)
    rock.rotation_euler = (0.17, -0.31, -0.32)
    rock_base = min((rock.rotation_euler.to_matrix() @ vertex.co).z for vertex in rock.data.vertices)
    rock.location.z = preview_sand_height(rock_x, rock_y) - rock_base - 0.012
    rock.data.materials.append(stone)
    move_to_collection(rock, collection)

    for i in range(24):
        x, y = -0.32 + 0.020 * math.cos(i * 0.92), 0.015 + 0.022 * math.sin(i * 0.79)
        root = Vector((x, y, preview_sand_height(x, y) - 0.003))
        aquatic_leaf(collection, root, i * 2.39996, 0.085 + 0.149 * (i % 7) / 6,
                     0.069 + 0.070 * (i % 6) / 5, 0.014 + 0.013 * (i % 4) / 3, leaves[i % len(leaves)])

    for x, y, z, angle, surface in (
        (-0.12, -0.081, 0.335, 0.11, gold), (0.16, 0.093, 0.394, -0.34, glint),
        (0.35, -0.110, 0.264, 0.08, gold), (0.08, -0.18, 0.231, 0.43, glint),
        (-0.21, 0.127, 0.411, 0.14, glint),
    ):
        ellipsoid("Preview fish body", (x, y, z), (0.020, 0.0046, 0.0058), surface, collection, angle)
        tail = (x - 0.021 * math.cos(angle), y - 0.021 * math.sin(angle), z)
        ellipsoid("Preview fish tail", tail, (0.006, 0.0018, 0.0051), surface, collection, angle)
    return collection


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat("-Z", "Y").to_euler()


def area(scene, name, center, target, power, color, size, size_y):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.color = color
    data.shape = "RECTANGLE"
    data.size = size
    data.size_y = size_y
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = center
    aim(obj, target)


def camera(scene, name, eye, target, lens):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = eye
    aim(obj, target)
    return obj


def show_front_wall(visible):
    wall = bpy.data.objects["RoomWallFront"]
    for obj in (wall, *wall.children_recursive):
        obj.visible_camera = visible
        obj.hide_set(not visible)


def curtain_animation(scene):
    curtain = bpy.data.objects["BreezeCurtain"]
    basis = curtain.shape_key_add(name="Rest")
    left = min(point.co.x for point in basis.data)
    width = max(point.co.x for point in basis.data) - left
    top = max(point.co.z for point in basis.data)
    height = top - min(point.co.z for point in basis.data)
    poses = [curtain.shape_key_add(name=name) for name in ("Breeze rolls in", "Breeze lifts hem")]
    for index, vertex in enumerate(basis.data):
        across = (vertex.co.x - left) / width
        drop = (top - vertex.co.z) / height
        flex = max(0, (drop - 0.04) / 0.96) ** 1.45 * (0.53 + 0.47 * across)
        for pose, phase in zip(poses, (0.0, 1.6)):
            wave = 0.71 + 0.29 * math.sin(3.8 * drop - 2.6 * across + phase)
            pose.data[index].co.y -= 0.065 * flex * wave
            pose.data[index].co.z += 0.025 * flex * wave * drop
    for frame, incoming, lifting in ((1, 0, 0), (24, 0.30, 0), (51, 0.93, 0.07),
                                      (77, 0.20, 0.69), (115, 0.06, 0.10),
                                      (142, 0.34, 0.46), (169, 0.25, 0.15), (193, 0, 0)):
        for pose, weight in zip(poses, (incoming, lifting)):
            pose.value = weight
            pose.keyframe_insert(data_path="value", frame=frame)
    scene.frame_end = 192
    scene.frame_set(51)


def preview_setup(scene):
    scene.camera = camera(scene, "Room · front right", (0.53, -3.67, 1.16), (0.04, 0.12, 0.14), 28.5)
    camera(scene, "Room · circulation", (1.15, -2.12, 4.18), (-0.16, 0.15, -0.49), 28)
    camera(scene, "Room · open window", (-0.10, -1.16, 0.68), (2.14, 0.78, 0.24), 31)
    sunlight = bpy.data.lights.new("Directional daylight through window", "SUN")
    sunlight.energy = 3.7
    sunlight.angle = math.radians(1.2)
    sunlight.color = (1.0, 0.931, 0.83)
    sun = bpy.data.objects.new(sunlight.name, sunlight)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector((-0.53, -0.24, -0.815)).to_track_quat("-Z", "Y").to_euler()
    area(scene, "Window sky fill", (2.205, 0.69, 0.79), (-0.70, 0.2, -0.27),
         145, (0.977, 0.985, 1.0), 1.84, 1.4)
    area(scene, "Floor lamp wall wash", (1.39, 1.58, 0.51), (1.18, 2.46, 0.09),
         8, (1.0, 0.841, 0.697), 0.11, 0.09)
    area(scene, "Soft light in the entry hall", (-1.55, 3.55, 1.37), (-1.58, 2.65, -0.22),
         12, (1.0, 0.949, 0.89), 0.32, 0.28)
    area(scene, "Soft room bounce", (-0.45, -1.40, 1.49), (0.0, 0.04, -0.39),
         86, (1.0, 0.97, 0.94), 2.8, 1.72)
    area(scene, "Aquarium lamp", (0, -TANK["lampZ"], TANK["lampHeight"] - 0.006), (0, 0, 0.05),
         13.2, (0.86, 0.94, 1.0), TANK["lampLength"] - 0.06, TANK["lampDepth"] - 0.02)

    show_front_wall(False)

    world = bpy.data.worlds.new("Cool overcast fill")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.80, 0.83, 0.89, 1.0)
    background.inputs["Strength"].default_value = 0.12
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.24
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 44
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 12
    scene.cycles.transmission_bounces = 10
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 810
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = "//living-room-preview.png"
    for screen in bpy.data.screens:
        for region in screen.areas:
            if region.type == "VIEW_3D":
                region.spaces.active.region_3d.view_perspective = "CAMERA"


def export_room(folder):
    glb = folder / "living-room.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    data = base64.b64encode(glb.read_bytes()).decode("ascii")
    (folder / "living-room-data.js").write_text(
        '// Generated by tools/blender/build_living_room.py for direct file:// opening.\n'
        f'window.AQUARIUM_LIVING_ROOM_GLB = "{data}";\n', encoding="utf-8",
    )


def main():
    args = options()
    folder = args.output.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    bpy.context.preferences.filepaths.save_version = 0
    build_architecture()
    build_furniture()
    aquarium = aquarium_context(scene)
    preview_setup(scene)
    curtain_animation(scene)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(folder / "living-room.blend"))
    if args.preview:
        scene.render.filepath = str(folder / "living-room-preview.png")
        bpy.ops.render.render(write_still=True)

    scene.collection.children.unlink(aquarium)
    show_front_wall(True)
    scene.frame_set(1)
    if args.bake:
        from room_bake import bake_room_lighting
        pad = bpy.data.objects["Preview aquarium leveling mat"]
        dynamic_lights = [scene.objects[name] for name in ("Directional daylight through window", "Aquarium lamp")]
        previous_visibility = [light.hide_render for light in dynamic_lights]
        scene.collection.objects.link(pad)
        try:
            # The web scene supplies its own time-dependent sun and aquarium lamp.
            for light in dynamic_lights:
                light.hide_render = True
            bake_room_lighting(scene, resolution=3072, samples=24, occluders=(pad,))
        finally:
            for light, was_hidden in zip(dynamic_lights, previous_visibility):
                light.hide_render = was_hidden
            scene.collection.objects.unlink(pad)
    export_room(folder)


if __name__ == "__main__":
    main()
