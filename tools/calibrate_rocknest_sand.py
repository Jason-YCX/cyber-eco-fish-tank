"""Recover the Rocknest cameras and training landmarks from the archived observations.
Needs SciPy, NumPy, OpenCV. The output is used by build_rocknest_sand.py.
"""
import re

import cv2
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

from build_rocknest_sand import STUDY, photograph


def initial_cameras():
    # The four camera labels correspond to full-size parent exposures, in time
    # order. Their CAHVOR centres are in metres in the same rover navigation frame.
    poses = []
    for path in sorted((STUDY/'原片').glob('*.LBL')):
        data = path.read_text()
        vectors = [re.search(rf'MODEL_COMPONENT_{i}\s*=\s*\((.*?)\)',data,re.S)[1] for i in (1,2,3,4)]
        center,axis,horizontal,vertical = [np.fromstring(value,sep=',') for value in vectors]
        axis /= np.linalg.norm(axis)
        right = horizontal-(axis@horizontal)*axis
        right /= np.linalg.norm(right)
        down = np.cross(axis,right)
        assert down@vertical>0
        poses.append((np.array([right,down,axis]),center*1000))
    assert len(poses)==4
    rotations = np.array([r@poses[3][0].T for r,_ in poses])
    centers = np.array([poses[3][0]@(c-poses[3][1]) for _,c in poses])
    return rotations,centers


def landmarks():
    sift = cv2.SIFT_create(14000,contrastThreshold=.018)
    features = [sift.detectAndCompute(cv2.cvtColor(photograph(i),cv2.COLOR_BGR2GRAY),None) for i in range(4)]
    matcher = cv2.BFMatcher()
    def matches(a,b):
        return {p.queryIdx:p.trainIdx for p,q in matcher.knnMatch(features[a][1],features[b][1],k=2) if p.distance<.76*q.distance}
    pairs={}
    for i in (0,1,2):
        fw,bw=matches(3,i),matches(i,3)
        pairs[i]={k:v for k,v in fw.items() if bw.get(v)==k}
    ids=sorted(set(pairs[0])&set(pairs[2]))
    unique=np.unique(np.round([features[3][0][k].pt for k in ids]),axis=0,return_index=True)[1]
    ids=[ids[i] for i in unique]
    return np.array([[features[i][0][pairs[i][k]].pt if k in pairs[i] else [np.nan,np.nan] for k in ids] if i<3
                     else [features[3][0][k].pt for k in ids] for i in range(4)])


def solve():
    rotations,centers=initial_cameras()
    tracks=landmarks()
    def camera(i,rotation,focal,offset):
        rot=Rotation.from_rotvec(rotation).as_matrix()@rotations[i]
        pos=centers[i]+offset
        intrinsics=np.array([[focal,0,791.5],[0,focal,591.5],[0,0,1]])
        return rot,pos,focal,intrinsics@np.column_stack((rot,-rot@pos))
    def cameras(par):
        out=[]
        for i,focus in enumerate((0,0,.52,1)):
            rotation,offset=(par[2+6*i:5+6*i],par[5+6*i:8+6*i]) if i!=3 else (np.zeros(3),np.zeros(3))
            out.append(camera(i,rotation,par[0]+par[1]*focus,offset))
        return out
    def triangulate(cams,data):
        xyzw=cv2.triangulatePoints(cams[0][3],cams[3][3],data[0].T,data[3].T).T
        return xyzw[:,:3]/xyzw[:,3:]
    def project(cam,xyz):
        rot,center,focal,_=cam
        local=(xyz-center)@rot.T
        return local[:,:2]/local[:,2:]*focal+[791.5,591.5]
    initial=np.zeros(20)
    initial[:2]=[2820,130]
    subset=tracks[:,::2]
    def training_residual(par):
        cams=cameras(par)
        xyz=triangulate(cams,subset)
        pixel=np.concatenate([(project(cams[i],xyz)-subset[i]).ravel() for i in (0,2,3)])
        return np.r_[pixel,(par[:2]-initial[:2])/[110,90],par[2:5]/.003,par[5:8]/.7,par[14:17]/.003,par[17:20]/.7]
    fit=least_squares(training_residual,initial,loss='soft_l1',f_scale=.35,max_nfev=80).x
    cams=cameras(fit)
    xyz=triangulate(cams,tracks)
    good=np.all([np.linalg.norm(project(cams[i],xyz)-tracks[i],axis=1)<2 for i in (0,2,3)],axis=0)
    xyz,tracks=xyz[good],tracks[:,good]
    seen=np.flatnonzero(np.isfinite(tracks[1,:,0]))
    control=seen[::4]
    test=np.setdiff1d(seen,control)
    def held_out_pose(par):
        cam=camera(1,par[:3],par[6],par[3:6])
        measured=(project(cam,xyz[control])-tracks[1,control]).ravel()
        return np.r_[measured,par[:3]/.009,par[3:6]/1.2,(par[6]-fit[0])/60]
    par=least_squares(held_out_pose,np.r_[np.zeros(6),fit[0]],loss='soft_l1',f_scale=.4,max_nfev=100).x
    cams[1]=camera(1,par[:3],par[6],par[3:6])
    good=np.ones(len(xyz),bool)
    for _ in range(4):
        center=np.median(xyz[good],axis=0)
        _,_,v=np.linalg.svd(xyz[good]-center,full_matrices=False)
        normal=v[-1] if v[-1,2]<0 else -v[-1]
        height=(xyz-center)@normal
        good=abs(height-np.median(height))<3.5*np.median(abs(height-np.median(height)))
    center+=normal*np.median(height[good])
    np.savez(STUDY/'相机与三角测量.npz',C=[c[1] for c in cams],R=[c[0] for c in cams],f=[c[2] for c in cams],
             T=tracks,x=xyz,org=center,n=normal,test=test)


if __name__=='__main__':
    solve()
