"""Reconstruct the Carbis Bay specimen from turntable measurements.

Default: rebuild from the retained observations using NumPy, SciPy, OpenCV,
scikit-image and fast-simplification. To remeasure, pass --frames DIRECTORY
containing the viewer's 72 native 361 x 294 level-1 frames named f00.png ... f71.png.
The input photographs are not distributed. Lighting, registration and shape are
estimated on frames 0,2,3,5,... only; frames 1,4,7,... are reserved for validation.
"""
import argparse
import base64
import json
from pathlib import Path

import cv2 as cv
import fast_simplification
import numpy as np
from scipy import ndimage, optimize, spatial
from skimage.measure import marching_cubes

import carbis_minerals

ROOT = Path(__file__).resolve().parents[1]
STONE = ROOT / 'assets/stone'
OBSERVATIONS = STONE / 'specimens/carbis-observations.npz'
TRAIN = [i for i in range(72) if i % 3 != 1]
HOLDOUT = [i for i in range(72) if i % 3 == 1]


def largest_mask(im):
    # The stage/background is nearly black, unlike the pebble. Closing suppresses JPEG holes.
    m = cv.morphologyEx(np.uint8(im.max(2)>25), cv.MORPH_CLOSE, np.ones((3,3),np.uint8))
    contours, _ = cv.findContours(m, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    m[:] = 0
    cv.drawContours(m, [max(contours, key=cv.contourArea)], -1, 1, -1)
    return m


def projectors(sine, cx, roll, cy, offsets):
    t = np.arange(72)*np.pi/36
    zeros = np.zeros(72)
    horizontal = np.column_stack((np.cos(t),zeros,-np.sin(t)))
    vertical = np.column_stack((sine*np.sin(t),zeros-np.sqrt(1-sine*sine),sine*np.cos(t)))
    matrix = np.stack((horizontal,vertical+roll*horizontal),axis=1)
    return matrix, np.array([cx,cy])+offsets


def observe(directory):
    images = [cv.imread(str(directory/f'f{i:02}.png')) for i in range(72)]
    if any(im is None for im in images):
        raise ValueError('All 72 sequential turntable frames are required')
    if len({im.shape for im in images})!=1:
        raise ValueError('Frame dimensions differ')
    masks = np.array([largest_mask(im) for im in images])
    sift = cv.SIFT_create(contrastThreshold=.015)
    features = {}
    for i in TRAIN:
        interior = cv.erode(masks[i], np.ones((5,5),np.uint8))*255
        kp,d = sift.detectAndCompute(cv.cvtColor(images[i],cv.COLOR_BGR2GRAY), interior)
        features[i] = np.array([k.pt for k in kp]), d
    pairs = []
    matcher = cv.BFMatcher()
    for i in TRAIN:
        a,ds = features[i]
        for delta in (2,3,5,6,8):
            j=(i+delta)%72
            if j not in features:
                continue
            b,dt = features[j]
            good = [p for p,q in matcher.knnMatch(ds,dt,k=2) if p.distance<.76*q.distance]
            if len(good)<8:
                continue
            x = a[[p.queryIdx for p in good]]
            y = b[[p.trainIdx for p in good]]
            mat, keep = cv.estimateAffine2D(x,y,ransacReprojThreshold=2.8,maxIters=4000)
            if mat is not None and keep.sum()>=6:
                k = keep.ravel()>0
                pairs.append(np.column_stack([np.full(k.sum(),i),np.full(k.sum(),j),x[k],y[k]]))
    rows = np.concatenate(pairs)
    ii,jj = rows[:,:2].astype(int).T
    delta = np.tan(np.pi*((jj-ii)%72)/72)
    x1,y1,x2,y2 = rows[:,2:].T
    # Under an orthographic camera the vertical motion is proportional to average
    # horizontal distance from the turn axis and tan(half the rotation increment).
    def residual(params):
        sine, axis, roll = params
        return delta*(x1+x2-2*axis)*sine - (y2-y1) + roll*(x2-x1)
    fit = optimize.least_squares(residual,[.4,images[0].shape[1]/2,0],loss='soft_l1',f_scale=.70)
    sine,cx,roll = fit.x
    cy=np.median([np.where(masks[i].any(axis=1))[0].mean() for i in TRAIN])
    # Solve small vertical indexing/runout errors independently of the shape.
    L=np.zeros((len(rows),len(TRAIN)))
    lookup={i:k for k,i in enumerate(TRAIN)}
    L[np.arange(len(rows)),[lookup[i] for i in ii]]=-1
    L[np.arange(len(rows)),[lookup[j] for j in jj]]=1
    keep=np.abs(fit.fun)<1.8
    shift=np.linalg.lstsq(np.vstack([L[keep],np.eye(len(TRAIN))*4]),
                           np.r_[-fit.fun[keep],np.zeros(len(TRAIN))],rcond=None)[0]
    # fit.fun = Δpredicted - Δobserved. Apply Δobserved - Δpredicted as the image translation.
    # The solution above represents the required extra translation.
    offsets=np.zeros((72,2))
    offsets[:,1]=np.interp(np.arange(72),TRAIN,shift,period=72)
    A,C=projectors(sine,cx,roll,cy,offsets)
    points=[]; types=[]
    for r in pairs:
        i,j=r[0,:2].astype(int);xy=r[:,2:]
        B=np.vstack([A[i],A[j]])
        wanted=xy-np.r_[C[i],C[j]]
        pos=wanted@np.linalg.pinv(B).T
        good=np.linalg.norm(pos@B.T-wanted,axis=1)<1.35
        if not good.any():
            continue
        x,y=np.rint(xy[good,:2]).astype(int).T
        patch=cv.GaussianBlur(images[i],(0,0),1.3)[y,x][:,::-1].astype(float)
        red,green,blue=patch.T
        # Retain only a categorical mineral observation, not projected photo RGB.
        cls=np.select([((red-blue)>24)&(red>green+5),np.mean(patch,1)<90],[1,2],default=0)
        points.extend(pos[good]);types.extend(cls)
    points=np.asarray(points);types=np.asarray(types)
    # Bin labels across repeated observations into a coarse physical landmark field.
    vox=12.0
    cell, inv=np.unique(np.floor(points/vox).astype(int),axis=0,return_inverse=True)
    n=np.bincount(inv)
    keep=n>=3
    landmarks=np.column_stack([(cell[keep]+.5)*vox,
        np.bincount(inv,weights=(types==1))[keep]/n[keep],
        np.bincount(inv,weights=(types==2))[keep]/n[keep]])
    floor=float(np.percentile(points[:,1],.20)-2)
    np.savez_compressed(OBSERVATIONS,masks=np.packbits(masks,axis=-1),width=masks.shape[2],A=A,C=C,
                        features=landmarks.astype('f4'),floor=floor,
                        camera=fit.x,matches=len(rows),median_error=np.median(abs(fit.fun)))
    print('Calibration',len(rows),'matches',fit.x,'median residual',np.median(abs(fit.fun)),'floor',floor,flush=True)


def encoded(data):
    return base64.b64encode(np.ascontiguousarray(data).tobytes()).decode('ascii')


def signed_distance(m):
    return cv.distanceTransform(m,cv.DIST_L2,5)-cv.distanceTransform(1-m,cv.DIST_L2,5)


def geometry(obs):
    masks=np.unpackbits(obs['masks'],axis=-1)[:,:,:int(obs['width'])].astype('uint8')
    A,C=obs['A'],obs['C']
    step=1.65
    axes=[np.arange(-196,197,step),np.arange(-165,166,step),np.arange(-196,197,step)]
    # Orthographic visual hull. Reject one isolated edge discrepancy across 48
    # exposures. Use bilinear signed distance instead of clipping on a pixel lattice.
    grid=np.meshgrid(*axes,indexing='ij',sparse=True)
    shape=tuple(map(len,axes));lo=np.full(shape,1e3,'f4');second=lo.copy()
    for i in TRAIN:
        mask=masks[i];d=signed_distance(mask)
        u=sum(v*g for v,g in zip(A[i,0],grid))+C[i,0]
        v=sum(v*g for v,g in zip(A[i,1],grid))+C[i,1]
        # Split along X to bound the peak working memory of interpolation.
        for a in range(0,shape[0],16):
            ss=slice(a,min(shape[0],a+16))
            x=u[ss];y=v[ss]
            h,w=mask.shape
            x=np.clip(x,0,w-1.01); y=np.clip(y,0,h-1.01)
            xx=x.astype('int32');yy=y.astype('int32')
            wx=x-xx;wy=y-yy
            q=(d[yy,xx]*(1-wx)+d[yy,xx+1]*wx)*(1-wy)+(d[yy+1,xx]*(1-wx)+d[yy+1,xx+1]*wx)*wy
            second[ss]=np.minimum(second[ss],np.maximum(lo[ss],q))
            lo[ss]=np.minimum(lo[ss],q)
    # The camera sees the upper hemisphere. Cap the unobserved underside near the
    # lowest triangulated training landmark, instead of producing a hanging cone.
    field=np.minimum(second*.65+lo*.35,grid[1]-float(obs['floor'])+.7)
    verts,faces,_,_=marching_cubes(ndimage.gaussian_filter(field,.68),0,spacing=(step,)*3,allow_degenerate=False)
    verts+=np.array([a[0] for a in axes])
    faces=np.ascontiguousarray(faces[:,::-1],'i4')
    volume=np.sum(np.einsum('ij,ij->i',verts[faces[:,0]],np.cross(verts[faces[:,1]],verts[faces[:,2]])))/6
    if volume<0:
        faces=faces[:,::-1].copy()
    return verts,faces,masks


def build(macro_frames=None):
    obs=np.load(OBSERVATIONS)
    vs,fs,masks=geometry(obs)
    # Keep the measured contact plane upright and align the long horizontal principal axis to X.
    center=vs.mean(0)
    vxz=vs[:,[0,2]]-center[[0,2]]
    axis=np.linalg.eigh(vxz.T@vxz)[1][:,-1]
    if axis[0]<0:axis=-axis
    T=np.array([[axis[0],0,axis[1]],[0,1,0],[-axis[1],0,axis[0]]])
    aligned=vs@T.T
    midpoint=(aligned.max(0)+aligned.min(0))/2
    scale=.165/np.ptp(aligned[:,0])
    features=obs['features'];tree=spatial.cKDTree(features[:,:3])
    def mesh(count,material):
        v,f=fast_simplification.simplify(vs,np.ascontiguousarray(fs),target_count=count)
        answer=dict(positions=encoded(((v@T.T-midpoint)*scale).astype('<f4')),indices=encoded(f.astype('<u2')))
        if material:
            # Quartz, ochre and dark matrix are independently synthesised from the
            # coarse categorical field. No source photograph is mapped onto the mesh.
            d,k=tree.query(v,k=8);w=np.exp(-(d/15)**2);w/=np.maximum(w.sum(1,keepdims=True),1e-9)
            iron=(features[k,3]*w).sum(1);dark=(features[k,4]*w).sum(1)
            x,y,z=v.T
            mottle=.5*np.sin(.22*x-.15*y+.27*z)+.25*np.sin(.47*y+.39*x-.31*z)
            rust=np.clip((iron-.15)*1.17+.13*mottle,0,.93)[:,None]
            charcoal=np.clip((dark-.10)*1.05-.18*mottle,0,.86)[:,None]
            base=np.array([139,135,127])*(1+.10*mottle[:,None])
            rgb=(1-rust)*base+rust*np.array([173,126,62])
            rgb=(1-charcoal)*rgb+charcoal*np.array([78,77,77])
            rgb=np.clip(rgb/255,0,1)
            linear=np.where(rgb<.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
            answer['colors']=encoded(np.uint8(np.rint(linear*255)))
        return answer,v,f
    visual,v,f=mesh(17000,True);coll,_,_=mesh(1300,False)
    rec={'mesh':visual,'collision':coll,'views':[],'capture':'OU Carbis Bay, 72 frames at 5 degree spacing'}
    # Re-read float32 positions so the independent check uses exactly the shipped geometry.
    local=np.frombuffer(base64.b64decode(visual['positions']),'<f4').reshape(-1,3)
    v=(local.astype(float)/scale+midpoint)@T
    result=[]
    report={'dimensions':[masks.shape[2],masks.shape[1]],'calibration_frames':TRAIN,
            'withheld_frames':HOLDOUT,'frame_zero_id':27622,'angles_degrees_per_frame':5,
            'length_m':.165,'camera_elevation_degrees':float(np.rad2deg(np.arcsin(obs['camera'][0]))),
            'native_photo_size':[5776,4692],'frame_metrics':[]}
    for i in range(72):
        xy=(v@obs['A'][i].T+obs['C'][i])*16
        raster=np.zeros_like(masks[i])
        cv.fillPoly(raster,[np.rint(xy[face]).astype('int32') for face in f],1,shift=4)
        # fillPoly's even-odd rule can open internal cracks on batched triangles.
        contours,_=cv.findContours(raster,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE)
        cv.drawContours(raster,[max(contours,key=cv.contourArea)],-1,1,-1)
        ref=masks[i]
        iou=np.sum(ref&raster)/np.sum(ref|raster)
        e1=ref-cv.erode(ref,None);e2=raster-cv.erode(raster,None)
        ds=np.r_[cv.distanceTransform(1-e1,cv.DIST_L2,cv.DIST_MASK_PRECISE)[e2>0],
                 cv.distanceTransform(1-e2,cv.DIST_L2,cv.DIST_MASK_PRECISE)[e1>0]]
        result.append((float(iou),float(ds.mean()),float(np.quantile(ds,.95))))
        camera=np.column_stack((obs['A'][i]@T.T/scale,
                               obs['A'][i]@T.T@midpoint+obs['C'][i]))
        report['frame_metrics'].append({'frame':i,'matrix':np.round(camera,8).tolist(),
             'iou':round(result[-1][0],5),'mean_contour_px':round(result[-1][1],3),
             'p95_contour_px':round(result[-1][2],3)})
    if macro_frames is not None:
        carbis_minerals.measure(local.astype(float),f,report,macro_frames)
    if carbis_minerals.FEATURES.exists():
        marks=np.load(carbis_minerals.FEATURES)['marks']
        rec['detail']=carbis_minerals.bake(local.astype(float),marks)
    rec['validation']=report
    (STONE/'carbis-pebble.js').write_text('window.AQUARIUM_CARBIS_PEBBLE='+json.dumps(rec,separators=(',',':'))+';\n')
    (STONE/'specimens/carbis-validation.json').write_text(json.dumps(report,separators=(',',':'))+'\n')
    print('17k triangles; held-out IoU min/mean, mean contour px, mean per-frame P95',
          np.min(np.asarray(result)[HOLDOUT,0]),np.mean(np.asarray(result)[HOLDOUT],axis=0),flush=True)
    return result,masks,obs,v,f


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frames',type=Path)
    parser.add_argument('--macro-frames',type=Path,help='Eight high-resolution training photographs for mineral measurement')
    args=parser.parse_args()
    if args.frames:
        observe(args.frames)
    build(args.macro_frames)
