"""Bake local rock scans and worn cavity rims onto the existing Tripo mesh (numpy, ffmpeg)."""
import base64
import json
from pathlib import Path
import subprocess
import sys

import numpy as np

STONE = Path(__file__).resolve().parents[1] / 'assets/stone'
TRIPO = STONE / 'tripo'
SIZE = 1536


def packed(a, dtype):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype)).decode('ascii')


def array(data, key, dtype, width):
    return np.frombuffer(base64.b64decode(data[key]), dtype=dtype).reshape(-1, width)


def ffmpeg(args, data):
    return subprocess.run(['ffmpeg', '-v', 'error', *args], input=data,
                          stdout=subprocess.PIPE, check=True).stdout


def decode(image, size):
    raw = ffmpeg(['-i', 'pipe:0', '-vf', f'scale={size}:{size}', '-frames:v', '1',
                  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], base64.b64decode(image))
    return np.frombuffer(raw, 'u1').reshape(size, size, 3).copy()


def encode(image, codec):
    args = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{SIZE}x{SIZE}', '-i', 'pipe:0',
            '-frames:v', '1', '-c:v', codec]
    if codec == 'mjpeg':
        args += ['-pix_fmt', 'yuvj444p', '-q:v', '3']
    result = ffmpeg(args + ['-f', 'image2pipe', '-'], image.tobytes())
    return base64.b64encode(result).decode('ascii')


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)


def normals(p, f):
    face = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    n = np.zeros_like(p)
    for col in f.T:
        np.add.at(n, col, face)
    return unit(n)


def sample(image, uv):
    xy = (uv % 1) * image.shape[0] - .5
    k = np.floor(xy).astype(int)
    x, y = k.T
    u, v = (xy - k).T[:, :, None]
    w = image.shape[0]
    return ((1-v)*((1-u)*image[y%w,x%w] + u*image[y%w,(x+1)%w]) +
            v*((1-u)*image[(y+1)%w,x%w] + u*image[(y+1)%w,(x+1)%w])) / 255.


def projections(p, n):
    weights = np.abs(n)**4
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-10)
    # A 12 cm repeat on this 22 cm specimen keeps the scanned grains millimetre-scale.
    coords = p / .12
    return [(coords[:, [2,1]] + [.34,.17], weights[:, 0:1], 2, 1),
            (coords[:, [0,2]] + [.70,.42], weights[:, 1:2], 0, 2),
            (coords[:, [0,1]] + [.12,.76], weights[:, 2:3], 0, 1)]


def reshape_cavities(worn, faces):
    # Points on the existing lips, in local millimetres. Each entry moves a small
    # patch along the bedding: centre, travel vector, and falloff radius.
    handles = [
        # Upper pocket: pull opposite ends apart and turn one shoulder inward.
        ((-5.49, 102.36, 2.61), (-7.19, 3.42, 3.25), 19),
        ((2.90, 88.92, 8.85), (8.25, -3.77, -4.17), 20),
        ((-4.09, 97.35, 19.23), (.79, .72, -3.52), 9),
        # Left pocket: a shorter head and a longer descending tail.
        ((-19.44, 82.07, 59.39), (-2.95, 2.34, 2.57), 14),
        ((-11.64, 70.92, 60.19), (7.60, -6.76, -5.36), 21),
        ((-15.76, 73.25, 71.37), (.44, 1.64, -3.83), 11),
        # Broad middle opening: extend the tip, retaining a notch on its upper lip.
        ((14.97, 72.58, 13.22), (-3.22, 3.02, 2.91), 15),
        ((28.95, 57.44, -2.97), (6.70, -6.62, -5.36), 20),
        ((21.95, 70.64, 2.54), (.46, -2.47, 3.92), 12),
        # Lower pocket: taper the other end and pinch the lower wall.
        ((10.06, 65.89, 40.44), (-4.46, 4.17, 3.44), 15),
        ((17.38, 55.80, 34.51), (2.57, -1.86, -3.35), 11),
        ((16.21, 57.61, 45.21), (-.04, 1.40, -3.39), 11),
    ]
    points = worn * 1000
    # Cut two tapered runouts through the lip. A shallow distal end lets the
    # groove die out on the face instead of stopping at a second rounded rim.
    for start, end, outward, width, depth in [
        ([-15.27, 77.29, 64.38], [-25.8, 83.3, 66.0], [.747, .576, .333], 6.1, 5.0),
        ([-1.75, 98.34, 10.78], [-16.5, 101.1, -2.1], [.513, .811, .282], 5.4, 4.1),
    ]:
        edge = np.subtract(end, start)
        t = np.clip((points-start) @ edge / np.dot(edge, edge), 0, 1)
        offset = points - (start + t[:, None]*edge)
        width_here = width * (1 - .49*t)
        profile = np.maximum(0, 1 - (offset*offset).sum(axis=1)/width_here**2)
        points -= (depth * profile**2 * (1 - t**2))[:, None] * outward
    # Move each influence with its handle, so both walls and floor follow the lip.
    steps = 12
    for step in range(steps):
        movement = np.zeros_like(points)
        for center, travel, radius in handles:
            travel = np.asarray(travel)
            offset = points - (center + travel * (step / steps))
            falloff = np.maximum(0, 1 - (offset * offset).sum(axis=1) / radius**2)
            movement += falloff[:, None]**2 * travel
        points += movement / steps
    # Very slender decimated triangles can fold under a curved displacement.
    # Project only those triangles back to a positive signed projected area.
    a,b,c = (worn[faces[:,k]] * 1000 for k in range(3))
    cross = np.cross(b-a, c-a)
    normal = unit(cross)
    min_area = .12 * np.linalg.norm(cross, axis=1)
    for _ in range(32):
        a,b,c = (points[faces[:,k]] for k in range(3))
        area = (np.cross(b-a, c-a)*normal).sum(axis=1)
        bad = area < min_area
        if not np.any(bad):
            break
        grad = np.stack([np.cross(b[bad]-c[bad],normal[bad]), np.cross(c[bad]-a[bad],normal[bad]),
                         np.cross(a[bad]-b[bad],normal[bad])], axis=1)
        correction = 1.1*(min_area[bad]-area[bad]) / np.maximum((grad*grad).sum(axis=(1,2)),1e-12)
        np.add.at(points, faces[bad], grad*correction[:,None,None])
    if np.any(area <= 0):
        raise ValueError('Cavity reshaping folded a triangle')
    return points / 1000


def wear_geometry(original, faces, relief):
    # Weld texture seams before measuring curvature so they cannot turn into artificial chips.
    p, inverse = np.unique(original, axis=0, return_inverse=True)
    f = inverse[faces]
    n = normals(p, f)
    edges, counts = np.unique(np.sort(np.concatenate([f[:, [0,1]], f[:, [1,2]], f[:, [2,0]]]), axis=1),
                              axis=0, return_counts=True)
    if not np.all(counts == 2):
        raise ValueError('Weathering requires a closed mesh. Rebuild the welded base from the original GLB.')
    to, src = np.concatenate([edges, edges[:, ::-1]]).T
    degree = np.maximum(1, np.bincount(to, minlength=len(p)))[:,None]
    smooth = p.copy()
    for _ in range(14):
        neighbor = np.zeros_like(p)
        np.add.at(neighbor, to, smooth[src])
        smooth = .4*smooth + .6*neighbor/degree
    bend = ((p-smooth)*n).sum(axis=1)
    cavity = np.clip((-bend-.00025)/.0026, 0, 1)
    near = cavity.copy()
    for _ in range(6):
        np.maximum.at(near, to, .91*near[src])
    rim = np.clip((bend-.00010)/.0015, 0, 1) * near
    # Cluster chips along convex lips bordering concave walls. Leave broad planes intact.
    mill = p*1000
    fault = np.sin(mill @ [.46,.18,-.29] + 1.7*np.sin(mill @ [.13,-.08,.12]))
    chips = np.clip((fault+.36)/1.25, 0, 1)**1.3
    wear = rim * chips
    height = sum(w[:,0]*(sample(relief, uv)[:,0]-.5) for uv,w,_,_ in projections(p,n))
    shift = -.0038*wear + .0015*height
    worn = reshape_cavities(p+n*shift[:,None], f)
    return worn[inverse], normals(worn,f)[inverse], wear[inverse], cavity[inverse]


def atlas(uv, faces):
    # Rasterize at texel centres. Keep the UV islands of the shipped mesh unchanged.
    ids = np.full((SIZE,SIZE), -1, np.int32)
    weights = np.zeros((SIZE,SIZE,3), np.float32)
    for i, tri in enumerate(uv[faces]*SIZE-.5):
        a,b,c = tri
        ab,ac = b-a,c-a
        det = ab[0]*ac[1]-ab[1]*ac[0]
        if abs(det)<1e-8:
            continue
        x0,y0 = np.maximum(0,np.ceil(tri.min(axis=0)).astype(int))
        x1,y1 = np.minimum(SIZE-1,np.floor(tri.max(axis=0)).astype(int))
        if x0>x1 or y0>y1:
            continue
        y,x = np.ogrid[y0:y1+1,x0:x1+1]
        u=((x-a[0])*ac[1]-(y-a[1])*ac[0])/det
        v=(ab[0]*(y-a[1])-ab[1]*(x-a[0]))/det
        mask=(u>=0)&(v>=0)&(u+v<=1)
        ids[y0:y1+1,x0:x1+1][mask]=i
        weights[y0:y1+1,x0:x1+1][mask]=np.stack([1-u-v,u,v],axis=-1)[mask]
    return ids,weights


def pad_islands(images, valid):
    for _ in range(8):
        filled = valid.copy()
        for axis, step in [(0,1),(1,1),(0,-1),(1,-1)]:
            move = np.roll(valid,step,axis) & ~filled
            for image in images:
                image[move] = np.roll(image,step,axis)[move]
            filled |= move
        valid = filled


def build():
    data=json.loads((TRIPO/'ohko-runtime.js').read_text().split('=',1)[1].rstrip(';\n'))
    # Blender: -P tools/blender/build_tripo_ohko.py -- /tmp/ohko-base.json
    # Then: python3 tools/weather_tripo_ohko.py /tmp/ohko-base.json
    base=json.loads(Path(sys.argv[1]).read_text())
    book=(STONE/'rock-surfaces.js').read_text().split('Object.freeze(',1)[1].rsplit(');',1)[0]
    scan=json.loads(book)['dragon']
    albedo,detail,relief=[decode(blob,1024) for blob in (scan['color'],scan['surface'],scan['weathering']['map'])]
    original=array(base,'positions','<f4',3)
    faces=array(base,'indices','<u2',3)
    uv=array(base,'uvs','<f4',2)
    p,n,wear,cavity=wear_geometry(original,faces,relief)
    color,normal,surface=[decode(data[k],SIZE) for k in ('color','normal','surface')]
    ids,weights=atlas(uv,faces)
    ys,xs=np.nonzero(ids>=0)
    for start in range(0,len(ys),60000):
        y,x=ys[start:start+60000],xs[start:start+60000]
        f=faces[ids[y,x]]
        w=weights[y,x]
        point=np.einsum('ij,ijk->ik',w,p[f])
        axis=unit(np.einsum('ij,ijk->ik',w,n[f]))
        lip=(w*wear[f]).sum(axis=1)
        hollow=(w*cavity[f]).sum(axis=1)
        grain=np.zeros(len(y)); rough=np.zeros(len(y)); slope=np.zeros_like(point)
        grain_height=np.zeros(len(y))
        for coord,influence,h,v in projections(point,axis):
            weight=influence[:,0]
            # Larger mineral fragments sit in a finer matrix. Use the same scan
            # coordinates for pigmentation, roughness and the normals of each layer.
            coarse_coord = coord * .52 + [.17, .37]
            coarse_albedo = sample(albedo, coarse_coord)
            grain+=weight*((.32*sample(albedo,coord)+.68*coarse_albedo) @ [.2126,.7152,.0722])
            d=sample(detail,coord); r=sample(relief,coord)
            coarse_detail=sample(detail,coarse_coord)
            coarse_relief=sample(relief,coarse_coord)
            rough+=weight*(.35*d[:,2]+.65*coarse_detail[:,2])
            grain_height+=weight*(coarse_relief[:,0]-.5)
            # The bundled relief slopes follow the original project's packed GB convention.
            grad=(2*d[:,:2]-1)*.38 + (r[:,1:]-.5)*1.25
            grad+=(2*coarse_detail[:,:2]-1)*1.32 + (coarse_relief[:,1:]-.5)*3.55
            slope[:,h]+=weight*grad[:,0]
            slope[:,v]+=weight*grad[:,1]
        # Project the scan slope into this triangle's UV tangent frame, including mirrored islands.
        e1,e2=p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]
        d1,d2=uv[f[:,1]]-uv[f[:,0]],uv[f[:,2]]-uv[f[:,0]]
        hand=np.sign(d1[:,0]*d2[:,1]-d1[:,1]*d2[:,0])[:,None]
        tangent=hand*(e1*d2[:,1:2]-e2*d1[:,1:2])
        tangent=unit(tangent-axis*(axis*tangent).sum(axis=1,keepdims=True))
        bitangent=np.cross(axis,tangent)*hand
        out=normal[y,x]/127.5-1
        strength=.87+.43*lip
        out[:,0]+=strength*(slope*tangent).sum(axis=1)
        out[:,1]+=strength*(slope*bitangent).sum(axis=1)
        normal[y,x]=np.rint((unit(out)+1)*127.5).clip(0,255)
        tone=np.clip(.98+1.70*(grain-.53)+.66*grain_height,.54,1.32)*(1-.14*hollow)
        color[y,x]=np.rint(color[y,x]*tone[:,None]*(1+.06*lip[:,None])).clip(0,255)
        surface[y,x,1]=np.rint(255*np.clip(.41+.44*rough+.12*surface[y,x,1]/255+.055*hollow,.55,.95))
        surface[y,x,2]=0
    pad_islands([color,normal,surface],ids>=0)
    result=dict(positions=packed(p,'<f4'),normals=packed(n,'<f4'),uvs=base['uvs'],indices=base['indices'],color=encode(color,'mjpeg'),
                normal=encode(normal,'png'),surface=encode(surface,'mjpeg'))
    (TRIPO/'ohko-weathered.js').write_text('window.AQUARIUM_TRIPO_OHKO_WEATHERED='+json.dumps(result,separators=(',',':'))+';\n')
    print(f'{len(faces)} triangles, {len(ys)} mapped texels, deepest edge chip {3.8*wear.max():.2f} mm')


if __name__ == '__main__':
    build()
