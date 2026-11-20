"""Sparse mineral measurements on the Carbis Bay turntable specimen."""
import base64
from pathlib import Path

import cv2 as cv
import numpy as np
from scipy import spatial

TRAIN_MACROS = tuple(range(0,72,9))
FEATURES = Path(__file__).resolve().parents[1]/'assets/stone/specimens/carbis-minerals.npz'


def visible_triangles(vertices, triangles, camera, shape):
    xy=vertices@camera[:,:3].T+camera[:,3]
    front=-np.cross(camera[0,:3],camera[1,:3])
    front/=np.linalg.norm(front)
    tri=vertices[triangles]
    n=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
    n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    incidence=n@front
    face_id=np.full(shape,-1,np.int32)
    corners=np.rint(xy[triangles]*16).astype('int32')
    for i in np.argsort(tri.mean(1)@front):
        if incidence[i]>.03:
            cv.fillConvexPoly(face_id,corners[i],int(i),shift=4)
    return xy, face_id, incidence


def measure(vertices,triangles,validation,frames):
    marks=[]
    for i in TRAIN_MACROS:
        im=cv.imread(str(frames/f'hi-{i:02}.png'))
        if im is None or im.shape[:2]!=(1173,1444):
            raise ValueError(f'Expected a 1444 by 1173 photograph for frame {i}')
        camera=np.array(validation['frame_metrics'][i]['matrix'])*4
        xy,face_id,incidence=visible_triangles(vertices,triangles,camera,im.shape[:2])
        interior=cv.erode(np.uint8(face_id>=0),np.ones((29,29),np.uint8))>0
        b,g,r=cv.split(im.astype('f4'))
        l=.21*r+.72*g+.07*b
        local=cv.GaussianBlur(l,(0,0),5)
        warm=r-b
        minerals=[(l-local>28)&(r-b<41)&(l>130),
                  (warm>30)&(warm-cv.GaussianBlur(warm,(0,0),6)>9)&(r>g+3),
                  (local-l>26)&(l<128)]
        for mineral,region in enumerate(minerals):
            mask=(interior&region).astype('uint8')
            mask=cv.morphologyEx(mask,cv.MORPH_CLOSE,np.ones((2,2),np.uint8))
            _,label,stats,centers=cv.connectedComponentsWithStats(mask)
            suitable=np.where((stats[:,4]>=8)&(stats[:,4]<630)&(stats[:,2]<=80)&(stats[:,3]<=80))[0]
            for comp in suitable[suitable>0]:
                cx,cy=centers[comp]
                fid=face_id[round(cy),round(cx)]
                if fid<0 or incidence[fid]<.64:
                    continue
                x0,y0,w,h,area=stats[comp]
                yy,xx=np.where(label[y0:y0+h,x0:x0+w]==comp)
                cloud=np.column_stack((xx,yy));eig,vectors=np.linalg.eigh(np.cov(cloud.T))
                # A fitted ellipse records the center, orientation and two half-lengths.
                if eig[0]<.18 or eig[1]<.8:
                    continue
                corners=triangles[fid];screen=xy[corners]
                inv=np.linalg.inv(np.column_stack((screen[1]-screen[0],screen[2]-screen[0])))
                edges=(vertices[corners[1:]]-vertices[corners[0]]).T
                jac=edges@inv
                center=vertices[corners[0]]+jac@(np.array([cx,cy])-screen[0])
                axes=jac@vectors@np.diag(2*np.sqrt(eig))
                if np.linalg.norm(axes[:,1])>.007:
                    continue
                confidence=incidence[fid]*min(1,area/27)
                marks.append([mineral,confidence,i,*center,*axes[:,1],*axes[:,0]])
    # A single feature should not become two coincident spots when seen by adjacent cameras.
    # Keep the most face-on observation within the uncertainty of each ray intersection.
    marks=np.array(marks)
    keep=np.zeros(len(marks),bool)
    for code in range(3):
        group=np.where(marks[:,0]==code)[0];points=marks[group,3:6];tree=spatial.cKDTree(points)
        blocked=np.zeros(len(group),bool)
        for k in np.argsort(-marks[group,1]):
            if blocked[k]:
                continue
            mark=marks[group[k]];radius=max(.00036,.58*np.linalg.norm(mark[6:9]))
            near=tree.query_ball_point(points[k],radius)
            blocked[near]=True;keep[group[k]]=True
    measurements=marks[keep].astype('<f4')
    np.savez_compressed(FEATURES,marks=measurements,training_frames=TRAIN_MACROS,pixel_width=1444)
    print('High-resolution mineral measurements:',np.bincount(measurements[:,0].astype(int)),flush=True)
    return measurements


def bake(vertices,marks):
    # Bake sparse measured spots as independently drawn ellipses on the smooth body.
    # The channels store coverage of quartz-coloured, ochre and dark material, not photo RGB.
    h,w=768,1536
    half=np.max(abs(vertices),axis=0)
    def pixels(points):
        d=points/half
        d/=np.linalg.norm(d,axis=-1,keepdims=True)
        return np.stack([(np.arctan2(d[...,2],d[...,0])/(2*np.pi)+.5)*w,
             (.5-np.arcsin(np.clip(d[...,1],-1,1))/np.pi)*h],axis=-1)
    channels=[np.zeros((h,w),'uint8') for _ in range(3)]
    theta=np.arange(12)*np.pi/6
    for j,m in enumerate(marks):
        code=int(m[0]);center=m[3:6];u,v=m[6:9],m[9:12]
        # A small deterministic departure from elliptical symmetry gives fractured
        # inclusions a different silhouette to an iron stain.
        edge=1+(.07 if code==1 else .14)*np.sin(3*theta+j*1.29)
        pts=center+edge[:,None]*(np.cos(theta)[:,None]*u+np.sin(theta)[:,None]*v)
        rim=pixels(pts);cx=pixels(center)[0]
        rim[:,0]=cx+(rim[:,0]-cx+w/2)%w-w/2
        if np.ptp(rim[:,0])>w*.09:
            continue
        amount=int(140+102*m[1]);curve=np.rint(rim*16).astype('int32')
        cv.fillPoly(channels[code],[curve],amount,lineType=cv.LINE_AA,shift=4)
        if rim[:,0].min()<0 or rim[:,0].max()>=w:
            curve[:,0]+=16*(w if rim[:,0].min()<0 else -w)
            cv.fillPoly(channels[code],[curve],amount,lineType=cv.LINE_AA,shift=4)
    rgb=np.stack(channels,axis=-1)
    ok,png=cv.imencode('.png',cv.cvtColor(rgb,cv.COLOR_RGB2BGR),[cv.IMWRITE_PNG_COMPRESSION,9])
    if not ok:raise RuntimeError('Cannot encode the mineral feature map')
    return {'mask':base64.b64encode(png).decode('ascii'),'halfExtents':half.tolist(),
            'counts':np.bincount(marks[:,0].astype(int)).tolist(),'width':w,'height':h}
