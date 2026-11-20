"""Build the aquarium's lightweight Ohko mesh from its original Tripo GLB (Blender 4.5)."""
import base64
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

import bpy
import numpy as np

folder = Path(__file__).resolve().parents[2] / 'assets/stone/tripo'
source = folder / 'ohko-h25.glb'


def encode(array, dtype):
    return base64.b64encode(np.ascontiguousarray(array, dtype=dtype)).decode('ascii')


def reduce_mesh(obj, triangles):
    modifier = obj.modifiers.new('Reduce for aquarium', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.polygons))
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.calc_loop_triangles()


def three_positions(mesh):
    values = np.empty(len(mesh.vertices) * 3, np.float32)
    mesh.vertices.foreach_get('co', values)
    return values.reshape(-1, 3)[:, [0, 2, 1]] * [1, 1, -1]


bpy.ops.wm.read_factory_settings(use_empty=True)
# When producing a base for weathering, keep the geometric surface continuous
# through decimation. UV islands still split per loop during export below.
weathering_base = Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else None
bpy.ops.import_scene.gltf(filepath=str(source), merge_vertices=bool(weathering_base))
obj, = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
original = three_positions(obj.data)
center = (original.min(axis=0) + original.max(axis=0)) / 2
scale = .221 / np.ptp(original[:, 1])
reduce_mesh(obj, 27000)
mesh = obj.data
positions = (three_positions(mesh) - center) * scale
# Split vertices at UV seams while retaining the glTF texture orientation.
uv = np.empty(len(mesh.loops) * 2, np.float32)
mesh.uv_layers.active.data.foreach_get('uv', uv)
uv = uv.reshape(-1, 2)
uv[:, 1] = 1 - uv[:, 1]
loops = np.array([t.loops[:] for t in mesh.loop_triangles]).ravel()
vertex = np.array([loop.vertex_index for loop in mesh.loops])
pairs, indices = np.unique(np.column_stack((vertex[loops], uv[loops])), axis=0, return_inverse=True)
verts = pairs[:, 0].astype(int)
normals = np.array([v.normal[:] for v in mesh.vertices])[:, [0, 2, 1]] * [1, 1, -1]
assert len(pairs) < 65536
data = dict(positions=encode(positions[verts], '<f4'), normals=encode(normals[verts], '<f4'),
            uvs=encode(pairs[:, 1:], '<f4'), indices=encode(indices, '<u2'))
if weathering_base:
    weathering_base.write_text(json.dumps(data, separators=(',', ':')))
    sys.exit(0)
reduce_mesh(obj, 1000)
data['collision'] = dict(positions=encode((three_positions(obj.data)-center)*scale, '<f4'),
                         indices=encode([t.vertices[:] for t in obj.data.loop_triangles], '<u2'))

# Resize the exported maps directly, without a second lighting or material bake.
with source.open('rb') as stream, tempfile.TemporaryDirectory() as tmp:
    stream.seek(12)
    length, _ = struct.unpack('<II', stream.read(8))
    gltf = json.loads(stream.read(length))
    stream.read(8)
    start = stream.tell()
    material = gltf['materials'][0]
    pbr = material['pbrMetallicRoughness']
    for name, slot in [('color', pbr['baseColorTexture']), ('surface', pbr['metallicRoughnessTexture']),
                       ('normal', material['normalTexture'])]:
        image = gltf['images'][gltf['textures'][slot['index']]['source']]
        view = gltf['bufferViews'][image['bufferView']]
        stream.seek(start + view.get('byteOffset', 0))
        raw = Path(tmp) / image['name']
        raw.write_bytes(stream.read(view['byteLength']))
        output = Path(tmp) / (name + '.jpg')
        subprocess.run(['sips', '-Z', '1024', '-s', 'format', 'jpeg', '-s', 'formatOptions', '92',
                        str(raw), '--out', str(output)], check=True, stdout=subprocess.DEVNULL)
        data[name] = base64.b64encode(output.read_bytes()).decode('ascii')
(folder / 'ohko-runtime.js').write_text('window.AQUARIUM_TRIPO_OHKO=' + json.dumps(data, separators=(',', ':')) + ';\n')
