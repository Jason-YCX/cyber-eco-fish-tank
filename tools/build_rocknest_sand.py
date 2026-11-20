"""Rebuild the registered 32.768 mm Rocknest tile from three MAHLI cameras.
The fourth photo (0491) is reserved for tools/check_rocknest_view.py.
Requires NumPy, SciPy and OpenCV. Run from any directory.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator

PROJECT = Path(__file__).resolve().parents[1]
STUDY = PROJECT/'design/水族素材纹理/实拍配准/暖红砂'
SOURCE = PROJECT/'assets/substrate/source'
SIZE = 1024
BORDER = 64
TEXEL_MM = .032
# Calibrated against the independent MAHLI and Mastcam views.
RELIEF_SCALE = .85
CAMERAS = (489, 491, 493, 495)


def photograph(camera):
    file = next((STUDY/'原片').glob(f'*100{CAMERAS[camera]}R00*.jpg'))
    return cv2.imread(str(file))


def project(calibration, camera, xyz):
    local = (xyz-calibration['C'][camera]) @ calibration['R'][camera].T
    return (local[..., :2]/local[..., 2:]*calibration['f'][camera]+[791.5, 591.5]).astype(np.float32)


def sample(image, uv):
    return cv2.remap(image, uv.astype(np.float32), None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def axes(normal):
    x = np.array([1., 0., 0.]) - normal*normal[0]
    x /= np.linalg.norm(x)
    return x, np.cross(x, normal)


def contrast(gray):
    high = gray-cv2.GaussianBlur(gray,(0,0),2.5)
    return high/(cv2.GaussianBlur(abs(high),(0,0),3)+4)


def reconstruct(cal):
    n, origin = cal['n'], cal['org']
    right, down = axes(n)
    side = SIZE+2*BORDER
    y, x = np.indices((side,side), dtype=np.float32)
    plane = origin + (x-side/2)[...,None]*(right*TEXEL_MM) + (y-side/2)[...,None]*(down*TEXEL_MM)
    train = {i: photograph(i) for i in (0,2,3)}
    gray = {i: cv2.cvtColor(photo,cv2.COLOR_BGR2GRAY).astype(np.float32) for i,photo in train.items()}
    candidates = np.arange(-1.50, 1.51, .045)
    losses = []
    for height in candidates:
        points = plane[::2,::2] + height*n
        samples = {i: sample(gray[i],project(cal,i,points)) for i in train}
        # Match the effective resolving power of the farther cameras.
        def band(i,sigma):
            return contrast(cv2.GaussianBlur(samples[i],(0,0),sigma))
        loss = .35*abs(band(3,.85)-band(0,.6)) + .65*abs(band(3,.65)-band(2,.55))
        losses.append(cv2.GaussianBlur(np.clip(loss,0,3),(0,0),1.6))
    coarse = candidates[np.argmin(losses,axis=0)].astype(np.float32)
    height = cv2.bilateralFilter(cv2.medianBlur(coarse,5),9,.18,3.2)
    height = cv2.resize(height,(side,side),interpolation=cv2.INTER_CUBIC)

    xyz = cal['x']-origin
    uv = np.column_stack((xyz@right,xyz@down))/TEXEL_MM + side/2
    measured = xyz@n
    valid = (abs(measured)<1.6) & np.all((uv>0)&(uv<side-1),axis=1)
    uv, measured = uv[valid], measured[valid]
    def interpolate(values):
        grid = LinearNDInterpolator(uv,values)(x[::4,::4],y[::4,::4])
        bad = ~np.isfinite(grid)
        if bad.any():
            grid[bad] = NearestNDInterpolator(uv,values)(x[::4,::4][bad],y[::4,::4][bad])
        return cv2.resize(grid.astype(np.float32),(side,side),interpolation=cv2.INTER_CUBIC)

    # Near the epipole the change of disparity with height approaches zero.
    # Anchor that area to points triangulated in the three training images.
    anchor = interpolate(measured)
    correction = interpolate(measured-sample(height,uv[:,None,:]).ravel())
    dist = np.hypot(x-side*.54,y-side*.55)
    trust = .8*np.clip((dist-45)/175,0,1)
    height = anchor + trust*np.clip(height+correction-anchor,-.45,.45)
    color = sample(train[3],project(cal,3,plane+height[...,None]*n))
    return color.astype(np.float32),height


def cut_seam(color,height):
    # Join opposing measured strips along a minimum-error path. Only a
    # two-texel band blends. Geometry and color take the same cut.
    margin = (color.shape[1]-SIZE)//2
    left, right = color[:,:2*margin], color[:,SIZE:SIZE+2*margin]
    cost = np.mean(abs(left-right),axis=2)/45 + 1.6*abs(height[:,:2*margin]-height[:,SIZE:SIZE+2*margin])
    cost[:,:6] += 10
    cost[:,-6:] += 10
    sums, steps = cost[0].copy(), []
    for row in cost[1:]:
        a = np.pad(sums,1,constant_values=1e6)
        paths = np.stack([a[:-2]+.1,a[1:-1],a[2:]+.1])
        choice = np.argmin(paths,axis=0)
        steps.append(choice-1)
        sums = row+paths[choice,np.arange(len(choice))]
    edge = [int(sums.argmin())]
    for step in reversed(steps):
        edge.append(edge[-1]+step[edge[-1]])
    weight = np.clip((np.arange(2*margin)[None,:]-np.array(edge[::-1])[:,None]+1)/2,0,1).astype(np.float32)
    def join(image):
        w = weight[:,:,None] if image.ndim==3 else weight
        seam = (1-w)*image[:,SIZE:SIZE+2*margin]+w*image[:,:2*margin]
        result = image[:,margin:margin+SIZE].copy()
        result[:,:margin],result[:,-margin:] = seam[:,margin:],seam[:,:margin]
        return result
    return join(color),join(height)


def export_maps(color,height):
    height = height*RELIEF_SCALE
    color,height = cut_seam(color,height)
    color,height = cut_seam(color.transpose(1,0,2),height.T)
    color,height = color.transpose(1,0,2).copy(),height.T.copy()
    low,high = np.quantile(height,[.0003,.9997])
    smooth = cv2.GaussianBlur(height,(0,0),1.1)
    gx = (np.roll(smooth,-1,axis=1)-np.roll(smooth,1,axis=1))/(2*TEXEL_MM)
    gy = (np.roll(smooth,-1,axis=0)-np.roll(smooth,1,axis=0))/(2*TEXEL_MM)
    normal = np.stack((-gx,gy,np.ones_like(gx)),axis=-1)
    normal /= np.linalg.norm(normal,axis=2)[:,:,None]
    # Factor out the component of photographic shading explained by the
    # stereo normals, to allow the tank lights to illuminate the relief.
    vectors = np.column_stack((np.ones(height.size),normal.reshape(-1,3)))
    pick = np.random.default_rng(58).choice(height.size,18000,replace=False)
    v = vectors[pick]
    intensity = np.log(np.maximum(color.mean(axis=2).ravel()[pick],3))
    keep = np.ones(len(pick),bool)
    for _ in range(3):
        fit = np.linalg.lstsq(v[keep],intensity[keep],rcond=None)[0]
        residual = intensity-v@fit
        keep = abs(residual-np.median(residual)) < 2*np.median(abs(residual-np.median(residual)))
    median = float(np.median(vectors@fit))
    shade = np.clip(np.exp((vectors@fit).reshape(height.shape)-median),.68,1.28)
    def write(channel,values):
        data = np.clip(np.rint(values),0,255).astype(np.uint8)
        cv2.imwrite(str(SOURCE/f'rocknest_58-{channel}.jpg'),data,
                    [cv2.IMWRITE_JPEG_QUALITY,97,cv2.IMWRITE_JPEG_SAMPLING_FACTOR,cv2.IMWRITE_JPEG_SAMPLING_FACTOR_444])
    write('color',color/shade[...,None])
    write('height',(height-low)/(high-low)*255)
    write('normal',127.5*(normal[:,:,::-1]+1))
    write('roughness',255*np.clip(.82+.09*(1-normal[:,:,2]),.75,.96))
    stats = dict(heightRatio=round(float((high-low)/(SIZE*TEXEL_MM)),8),
                 minHeightMm=float(low),maxHeightMm=float(high),texelMm=TEXEL_MM,
                 lightFit=fit.tolist(),lightFitMedian=median,sample='Rocknest, Sol 58',reliefScale=RELIEF_SCALE,
                 credit='NASA/JPL-Caltech/MSSS',roughness='estimated')
    (SOURCE/'rocknest_58-calibration.json').write_text(json.dumps(stats,indent=2)+'\n')


if __name__=='__main__':
    with np.load(STUDY/'相机与三角测量.npz') as calibration:
        export_maps(*reconstruct(calibration))
