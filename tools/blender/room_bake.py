"""Bake static diffuse room lighting into the glTF export copy."""

import tempfile
from pathlib import Path

import bpy

from room_textures import unlit_image_material


BAKE_MATERIAL = "Room baked daylight"
TABLETOP_MATERIAL = "Cabinet top baked daylight"
TABLETOP_RESOLUTION = 1280
SOURCE_UV = "Room Source UV"
ATLAS_UV = "Room Atlas UV"


def _diffuse_surfaces(obj):
    if obj.type != "MESH" or not obj.material_slots:
        return False
    for slot in obj.material_slots:
        material = slot.material
        if not material or not material.use_nodes:
            return False
        shader = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
        if not shader:
            return False
        # Let glazing, emissive surfaces, and pronounced metal reflect in real time.
        if (shader.inputs["Alpha"].default_value < 0.99
                or shader.inputs["Transmission Weight"].default_value > 0.01
                or shader.inputs["Metallic"].default_value > 0.30
                or shader.inputs["Emission Strength"].default_value > 0.02):
            return False
    return True


def _bake_material(source, atlas):
    material = source.copy()
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = SOURCE_UV
    for node in list(nodes):
        if node.type == "TEX_IMAGE" and not node.inputs["Vector"].is_linked:
            links.new(uv.outputs["UV"], node.inputs["Vector"])
        if node.type == "NORMAL_MAP":
            node.uv_map = SOURCE_UV
    target = nodes.new("ShaderNodeTexImage")
    target.image = atlas
    nodes.active = target
    return material


def _combine_receivers(scene, receivers, atlas):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    source_materials = {}
    vertices, faces, material_slots, source_uvs, normals = [], [], [], [], []
    smooth_faces, parts = [], []
    for obj in receivers:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
        matrix = evaluated.matrix_world.copy()
        normal_matrix = matrix.to_3x3().inverted_safe().transposed()
        uv = next((layer for layer in mesh.uv_layers if layer.active_render), mesh.uv_layers.active)
        local_slots = []
        for material in mesh.materials:
            if material not in source_materials:
                source_materials[material] = len(source_materials), _bake_material(material, atlas)
            local_slots.append(source_materials[material][0])

        vertex_offset = len(vertices)
        loop_offset = len(source_uvs)
        loop_order = []
        vertices.extend(matrix @ vertex.co for vertex in mesh.vertices)
        for face in mesh.polygons:
            faces.append(tuple(index + vertex_offset for index in face.vertices))
            material_slots.append(local_slots[face.material_index])
            smooth_faces.append(face.use_smooth)
            for index in face.loop_indices:
                loop_order.append(index)
                source_uvs.append(tuple(uv.data[index].uv) if uv else (0.0, 0.0))
                normals.append((normal_matrix @ mesh.corner_normals[index].vector).normalized())
        parts.append((obj, mesh, loop_offset, loop_order))

    mesh = bpy.data.meshes.new("Temporary static lighting receiver")
    mesh.from_pydata(vertices, [], faces)
    for _, material in source_materials.values():
        mesh.materials.append(material)
    mesh.update()
    for polygon, slot, smooth in zip(mesh.polygons, material_slots, smooth_faces):
        polygon.material_index = slot
        polygon.use_smooth = smooth
    mesh.normals_split_custom_set(normals)
    source = mesh.uv_layers.new(name=SOURCE_UV)
    source.data.foreach_set("uv", [value for coord in source_uvs for value in coord])
    mesh.uv_layers.new(name=ATLAS_UV)
    mesh.uv_layers.active = mesh.uv_layers[ATLAS_UV]
    mesh.uv_layers[ATLAS_UV].active_render = True
    obj = bpy.data.objects.new("Temporary room bake receiver", mesh)
    scene.collection.objects.link(obj)
    return obj, parts


def _unwrap(receiver):
    bpy.ops.object.select_all(action="DESELECT")
    receiver.select_set(True)
    bpy.context.view_layer.objects.active = receiver
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=0.004, area_weight=0.25, margin_method="FRACTION",
                                 correct_aspect=True, scale_to_bounds=True)
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")


def _denoise_atlas(source, atlas, albedo, path):
    scene = bpy.data.scenes.new("Temporary room atlas denoise")
    camera = bpy.data.cameras.new("Temporary atlas camera")
    view = bpy.data.objects.new(camera.name, camera)
    scene.collection.objects.link(view)
    scene.camera = view
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    scene.render.resolution_x, scene.render.resolution_y = atlas.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    scene.render.dither_intensity = 0
    scene.render.filepath = str(path)
    scene.view_settings.view_transform = source.view_settings.view_transform
    scene.view_settings.look = source.view_settings.look
    scene.view_settings.exposure = source.view_settings.exposure
    scene.view_settings.gamma = source.view_settings.gamma
    scene.use_nodes = True
    nodes = scene.node_tree.nodes
    nodes.clear()
    image = nodes.new("CompositorNodeImage")
    image.image = atlas
    guide = nodes.new("CompositorNodeImage")
    guide.image = albedo
    denoise = nodes.new("CompositorNodeDenoise")
    denoise.prefilter = "NONE"
    output = nodes.new("CompositorNodeComposite")
    scene.node_tree.links.new(image.outputs["Image"], denoise.inputs["Image"])
    scene.node_tree.links.new(guide.outputs["Image"], denoise.inputs["Albedo"])
    scene.node_tree.links.new(denoise.outputs["Image"], output.inputs["Image"])
    try:
        bpy.ops.render.render(write_still=True, scene=scene.name)
    finally:
        bpy.data.scenes.remove(scene)
        bpy.data.objects.remove(view)
        bpy.data.cameras.remove(camera)


def _export_material(scene, atlas, albedo, name, image_filename):
    # Cycles baking skips render denoising. The compositor denoises the linear
    # atlas and applies the preview's display transform when it writes sRGB.
    with tempfile.TemporaryDirectory(prefix="aquarium-room-light-") as folder:
        png = Path(folder) / image_filename
        _denoise_atlas(scene, atlas, albedo, png)
        image = bpy.data.images.load(str(png), check_existing=False)
        image.name = name + " · packed atlas"
        image.pack()

    return unlit_image_material(name, image)


def _bake_atlas(scene, receivers, *, resolution, samples, material_name, image_filename):
    atlas = bpy.data.images.new("Room daylight · linear input", width=resolution, height=resolution,
                                alpha=True, float_buffer=True)
    receiver, parts = _combine_receivers(scene, receivers, atlas)
    albedo = None
    old_samples = scene.cycles.samples
    try:
        _unwrap(receiver)
        for obj in receivers:
            obj.hide_render = True
        scene.cycles.samples = samples
        bpy.context.view_layer.update()
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True,
                            uv_layer=ATLAS_UV, margin=4, margin_type="EXTEND")
        # A color-only proxy lets the denoiser preserve patterns in the source
        # textures while removing noise from the lighting. It has no lighting noise.
        albedo = bpy.data.images.new("Temporary room albedo guide", width=resolution, height=resolution,
                                     alpha=True, float_buffer=True)
        for source in receiver.data.materials:
            source.node_tree.nodes.active.image = albedo
        scene.cycles.samples = 1
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True,
                            uv_layer=ATLAS_UV, margin=4, margin_type="EXTEND")
        material = _export_material(scene, atlas, albedo, material_name, image_filename)
        uv = receiver.data.uv_layers[ATLAS_UV]
        baked_parts = []
        for obj, mesh, offset, order in parts:
            coords = [0.0] * (2 * len(mesh.loops))
            for current, original in enumerate(order):
                coords[2 * original:2 * original + 2] = uv.data[offset + current].uv
            while mesh.uv_layers:
                mesh.uv_layers.remove(mesh.uv_layers[0])
            sheet = mesh.uv_layers.new(name=ATLAS_UV)
            sheet.data.foreach_set("uv", coords)
            mesh.materials.clear()
            mesh.materials.append(material)
            for face in mesh.polygons:
                face.material_index = 0
            baked_parts.append((obj, mesh))
        return baked_parts
    finally:
        for obj in receivers:
            obj.hide_render = False
        scene.cycles.samples = old_samples
        temporary_mesh = receiver.data
        bpy.data.objects.remove(receiver, do_unlink=True)
        scratch = list(temporary_mesh.materials)
        bpy.data.meshes.remove(temporary_mesh)
        for material in scratch:
            bpy.data.materials.remove(material)
        bpy.data.images.remove(atlas)
        if albedo:
            bpy.data.images.remove(albedo)


def bake_room_lighting(scene, *, resolution=2048, samples=16, occluders=()):
    """Replace room diffuse surfaces after the untouched Blender file is saved.

    Call with the preview aquarium collection unlinked. Optional occluder
    objects stay in the scene for lighting and receive no baked material.
    """
    occluders = set(occluders)
    receivers = [obj for obj in scene.objects if obj not in occluders
                 and not obj.hide_render and _diffuse_surfaces(obj)]
    if not receivers:
        raise RuntimeError("No diffuse room surfaces are available to bake")
    tabletop = [obj for obj in receivers if obj.name == "AquariumCabinetTop"]
    room = [obj for obj in receivers if obj not in tabletop]

    # Keep original materials in the scene until both atlases are captured, so
    # the room and tabletop still cast shadows and contribute bounced light.
    baked_parts = []
    if room:
        baked_parts.extend(_bake_atlas(scene, room, resolution=resolution, samples=samples,
                                       material_name=BAKE_MATERIAL, image_filename="daylight.png"))
    if tabletop:
        baked_parts.extend(_bake_atlas(scene, tabletop, resolution=TABLETOP_RESOLUTION, samples=samples,
                                       material_name=TABLETOP_MATERIAL, image_filename="cabinet-top.png"))
    for obj, mesh in baked_parts:
        obj.modifiers.clear()
        obj.data = mesh
    return len(baked_parts)
