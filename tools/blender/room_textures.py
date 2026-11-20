"""Connect the local Poly Haven photo textures to editable Blender materials."""

from functools import cache
from pathlib import Path

import bpy
import numpy as np


TEXTURES = Path(__file__).resolve().parents[2] / "assets/living-room-textures"
LUMINANCE = np.array((0.2126, 0.7152, 0.0722), dtype=np.float32)


def unlit_image_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "EXTEND"
    shader = nodes.new("ShaderNodeEmission")
    light_path = nodes.new("ShaderNodeLightPath")
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    output = nodes.new("ShaderNodeOutputMaterial")
    links = material.node_tree.links
    # Blender's glTF exporter recognizes this combination as KHR_materials_unlit.
    links.new(texture.outputs["Color"], shader.inputs["Color"])
    links.new(light_path.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(transparent.outputs["BSDF"], mix.inputs[1])
    links.new(shader.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return material


def srgb_to_linear(value):
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


@cache
def diffuse_luminance(image):
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgb = pixels.reshape(-1, 4)[::32, :3]
    return float(np.median(srgb_to_linear(rgb) @ LUMINANCE))


def photo_surface(material, asset, *, tint=None, contrast=1.0, normal_strength=0.45, roughness_range=None):
    tree = material.node_tree
    shader = tree.nodes.get("Principled BSDF")

    def image_node(channel, label, y):
        image = bpy.data.images.load(str(TEXTURES / f"{asset}-{channel}.jpg"), check_existing=True)
        if channel != "color":
            image.colorspace_settings.name = "Non-Color"
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        node.label = label
        node.location = (-820, y)
        return node

    color = image_node("color", "Photographed color", 250)
    albedo = color.outputs["Color"]
    if tint is not None:
        target = srgb_to_linear(np.array([int(tint[i:i + 2], 16) / 255 for i in (0, 2, 4)]))
        gray = tree.nodes.new("ShaderNodeRGBToBW")
        gray.location = (-600, 250)
        tree.links.new(albedo, gray.inputs["Color"])
        luminance = tree.nodes.new("ShaderNodeMath")
        luminance.operation = "MULTIPLY_ADD"
        luminance.location = (-410, 250)
        luminance.inputs[1].default_value = contrast / max(diffuse_luminance(color.image), 0.025)
        luminance.inputs[2].default_value = 1.0 - contrast
        tree.links.new(gray.outputs["Val"], luminance.inputs[0])
        remap = tree.nodes.new("ShaderNodeMixRGB")
        remap.blend_type = "MULTIPLY"
        remap.label = "Recolor photographed grain"
        remap.location = (-210, 250)
        remap.inputs[0].default_value = 1.0
        remap.inputs[2].default_value = (*target, 1.0)
        tree.links.new(luminance.outputs[0], remap.inputs[1])
        albedo = remap.outputs["Color"]
        material.diffuse_color = (*target, 1.0)
    tree.links.new(albedo, shader.inputs["Base Color"])

    normal = image_node("normal", "Photographed relief", -70)
    normal_map = tree.nodes.new("ShaderNodeNormalMap")
    normal_map.location = (-335, -70)
    normal_map.inputs["Strength"].default_value = normal_strength
    tree.links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    tree.links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])

    if roughness_range is not None:
        roughness = image_node("roughness", "Photographed roughness", -390)
        remap = tree.nodes.new("ShaderNodeMapRange")
        remap.location = (-335, -390)
        remap.inputs["To Min"].default_value, remap.inputs["To Max"].default_value = roughness_range
        tree.links.new(roughness.outputs["Color"], remap.inputs["Value"])
        tree.links.new(remap.outputs["Result"], shader.inputs["Roughness"])
