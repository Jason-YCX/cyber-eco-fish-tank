"""Build the three reference shapes. Dependencies: numpy, scipy, opencv-python, scikit-image, fast-simplification."""
import base64
import json
from pathlib import Path

import cv2 as cv
import fast_simplification
import numpy as np
from scipy import ndimage
from skimage.measure import marching_cubes

STONE = Path(__file__).resolve().parents[1] / 'assets' / 'stone'
SOURCE = STONE / 'specimens'
TILE = 704


def encoded(array):
    return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode('ascii')


def distance(mask):
    return cv.distanceTransform(mask.astype('uint8'), cv.DIST_L2, 5) - cv.distanceTransform((~mask).astype('uint8'), cv.DIST_L2, 5)


def silhouette(image, region):
    contours, _ = cv.findContours(region.astype('uint8'), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    mask = np.zeros(image.shape[:2], 'uint8')
    cv.drawContours(mask, [max(contours, key=cv.contourArea)], -1, 1, -1)
    return mask.astype(bool)


def view(mask, matrix, offset, image=None):
    facing = -np.cross(matrix[0], matrix[1])
    return dict(mask=mask, A=np.asarray(matrix), C=np.asarray(offset), image=image, facing=facing/np.linalg.norm(facing))


def grid(lo, hi, step):
    axes = [np.arange(a,b+step,step) for a,b in zip(lo,hi)]
    return np.stack(np.meshgrid(*axes, indexing='ij'), axis=-1)


def project(points,v):
    xy=points@v['A'].T+v['C']
    h,w=v['mask'].shape
    return np.clip(np.rint(xy[...,1]).astype(int), 0,h-1), np.clip(np.rint(xy[...,0]).astype(int), 0,w-1)


def dragon():
    obs=np.load(SOURCE/'dragon-observations.npz')
    views=[view(np.unpackbits(mask,axis=-1).astype(bool),a,c) for mask,a,c in zip(obs['masks'],obs['matrices'],obs['centers'])]
    step=3.0
    pts=grid([-275,-370,-255],[235,220,240],step)
    field=np.full(pts.shape[:3],1e3,dtype='f4')
    for v in views:
        y,x=project(pts,v);field=np.minimum(field,distance(v['mask'])[y,x])
    # A three-view visual hull constrains the observed peaks and openings. Points from
    # matched features and the footprint of visible cavities constrain its near-facing walls.
    solid=field>0
    for index,v in enumerate(views):
        mask=v['mask']; y,x=project(pts,v); depth=pts@v['facing']
        front=np.full(mask.shape,-2000,'f4')
        np.maximum.at(front,(y[solid],x[solid]),depth[solid])
        front=ndimage.maximum_filter(front,9)
        front=ndimage.gaussian_filter(np.maximum(front,-450),1.1)
        dents=np.zeros(mask.shape,'f4')
        for n,cx,cy,a,b,c,d,contrast in obs['pits']:
            if n!=index:continue
            cov=np.array([[a,b],[c,d]],float)
            r=int(np.ceil(np.sqrt(np.linalg.eigvalsh(cov)[1])*3))
            x0=max(0,int(cx)-r);x1=min(mask.shape[1],int(cx)+r+1)
            y0=max(0,int(cy)-r);y1=min(mask.shape[0],int(cy)+r+1)
            xx,yy=np.meshgrid(np.arange(x0,x1)-cx,np.arange(y0,y1)-cy)
            delta=np.stack((xx,yy),axis=-1)
            radii=np.einsum('...i,ij,...j->...',delta,np.linalg.inv(cov),delta)
            hollow=np.exp(-.25*radii)*min(15,np.sqrt(max(1,min(a,d)))*2.3)
            np.maximum(dents[y0:y1,x0:x1],hollow,out=dents[y0:y1,x0:x1])
        sparse=np.zeros_like(dents)
        points=obs['points']; sy,sx=project(points,v)
        for point,py,px in zip(points,sy,sx):
            gap=front[py,px]-point@v['facing']
            if mask[py,px] and 1<gap<55:
                cv.circle(sparse,(int(px),int(py)),5,float(min(gap,26)),-1)
        dents+=.35*ndimage.gaussian_filter(sparse,5)
        # Uniquely matched stereo patches measure recess depths along this ray.
        sampled=cv.resize(obs['depth'][index].astype('f4'),(mask.shape[1],mask.shape[0]),interpolation=cv.INTER_NEAREST)
        confidence=cv.resize(obs['confidence'][index].astype('f4')/255,(mask.shape[1],mask.shape[0]),interpolation=cv.INTER_NEAREST)
        gap=front-sampled
        confidence *= (gap>-3)&(gap<85)&mask
        measured=np.clip(gap,0,78)*confidence
        local_mass=ndimage.gaussian_filter(confidence,3.2)
        wide_mass=ndimage.gaussian_filter(confidence,11)
        local=ndimage.gaussian_filter(measured,3.2)/np.maximum(.004,local_mass)
        broad=ndimage.gaussian_filter(measured,11)/np.maximum(.004,wide_mass)
        blend=np.clip(local_mass/.13,0,1)
        body=.77*(broad*(1-.65*blend)+local*.65*blend)*np.clip(wide_mass/.075,0,1)
        dents=body+.68*dents
        # Leave the calibrated outline of each view intact.
        rim=np.clip(distance(mask)/11,0,1)
        field=np.minimum(field,front[y,x]+step*1.6-depth-dents[y,x]*rim[y,x])
    return pts, field,views,.221,'y'


def river():
    views=[]; profiles=[]
    for name,trans in [('top',[0,0,-1]),('bottom',[0,0,1]),('left',[0,-1,0]),('right',[0,1,0])]:
        # Looking down on the dorsal face, length increases down the original portrait.
        # With this screen convention, dorsal horizontal is -Z for a right-handed camera.
        im=cv.imread(str(SOURCE/f'river-{name}.jpg'))
        b,g,r=cv.split(im.astype(float));yy,xx=np.indices(b.shape)
        region=(r-b>21)&(r-g>4)&(r>55)&(xx>140)&(yy>8)&(yy<1260)
        if name=='left':
            right_edge=np.interp(yy,[0,20,40,80,110,165,220,292],[430,440,470,516,542,561,577,592])
            left_edge=np.interp(yy,[0,20,40,80,110,165,220,292],[405,398,374,350,341,327,319,314])
            region &= (yy>290)|((xx>=left_edge)&(xx<=right_edge))
        if name=='right':region&=(xx>201)&(xx<630)
        region=cv.morphologyEx(region.astype('uint8'),cv.MORPH_CLOSE,np.ones((9,9),'uint8'))
        m=silhouette(im,region);ys,xs=np.where(m);start,end=ys.min(),ys.max();span=end-start
        rows=m[start:end+1]
        lo=np.argmax(rows,axis=1);hi=m.shape[1]-1-np.argmax(rows[:,::-1],axis=1)
        t=np.linspace(-.5,.5,len(rows))
        # Remove the small in-plane roll of each independently positioned museum photograph.
        mid=(lo+hi)/2;sel=(abs(t)<.37)
        drift,center=np.polyfit(t[sel],mid[sel],1)
        matrix=np.array(trans,dtype=float)*span;matrix[0]=drift
        v=view(m,np.array([matrix,[span,0,0]]),[center,(start+end)/2],im)
        views.append(v)
        canonical=np.linspace(-.5,.5,361)
        profiles.append([np.interp(canonical,t,(edge-center-drift*t)/span) for edge in [lo,hi]])
    # Pair opposite photographs. The local half-width, half-height and off-centre axis
    # change along the entire specimen, including the triangular tip and worn margins.
    profiles=np.array(profiles)
    zlo=(-profiles[0,1]+profiles[1,0])/2;zhi=(-profiles[0,0]+profiles[1,1])/2
    ylo=(-profiles[2,1]+profiles[3,0])/2;yhi=(-profiles[2,0]+profiles[3,1])/2
    for k in (zlo,zhi,ylo,yhi):k[:]=ndimage.gaussian_filter1d(k,1.05)
    step=.0055;pts=grid([-.512,-.23,-.38],[.512,.23,.38],step)
    x,y,z=pts.transpose(3,0,1,2);xp=np.clip(x,-.5,.5)
    yl,yh,zl,zh=[np.interp(xp,canonical,k) for k in (ylo,yhi,zlo,zhi)]
    h=np.maximum(.001,(yh-yl)/2);w=np.maximum(.001,(zh-zl)/2)
    yy=(y-(yh+yl)/2)/h;zz=(z-(zh+zl)/2)/w
    power=2.40+.35*np.clip(.5+x,0,1)
    field=np.minimum(.5-abs(x),(1-(abs(yy)**power+abs(zz)**power)**(1/power))*np.minimum(h,w))
    return pts,field,views,.214,'x'


def slate():
    im=cv.imread(str(SOURCE/'slate.jpg'));h,w=im.shape[:2]
    b,g,r=cv.split(im.astype(float))
    mask=silhouette(im,(r-b>12)&(r>50))
    # The collection number has two labels. Patch them from adjoining cleavage on
    # the same face before projection, keeping the unmodified original in source.
    labels=[(1705,279,265,130,-535,56),(293,968,90,83,148,-92)]
    y,x=np.indices((h,w))
    for cx,cy,rx,ry,dx,dy in labels:
        alpha=np.clip((1.34-np.hypot((x-cx)/rx,(y-cy)/ry))/.30,0,1)[:,:,None]
        donor=im[np.clip(y+dy,0,h-1),np.clip(x+dx,0,w-1)]
        im=np.uint8(np.rint(im*(1-alpha)+donor*alpha))
    xs=np.where(mask.any(axis=0))[0];left,right=xs[0],xs[-1];span=right-left
    # Trace the meeting of the upper cleavage plane and the broken front edge.
    trace=np.array([[18,144],[24,197],[32,237],[50,263],[86,270],[131,266],[176,272],[210,279],[245,287],[274,282],[310,284],[343,288],[381,287],[407,292],[442,289],[467,294],[496,291],[511,294],[526,297]],float)*4
    edge=np.interp(np.arange(w),trace[:,0],trace[:,1])
    top=np.argmax(mask,axis=0);bottom=h-1-np.argmax(mask[::-1],axis=0)
    # One oblique photo supplies the front break and upper footprint. Depth behind
    # that edge is estimated with an orthographic elevation, not independently observed.
    elev=np.deg2rad(43);s,c=np.sin(elev),np.cos(elev)
    yc=720.; xc=(left+right)/2
    A=np.array([[span,0,0],[0,-span*c,span*s]])
    views=[view(mask,A,[xc,yc],im)]
    pts=grid([-.515,-.20,-.62],[.515,.15,.59],.0056);xx,yy,zz=pts.transpose(3,0,1,2)
    col=np.clip(np.rint(xc+span*xx).astype(int),left,right)
    upper=.050+.006*np.sin(9*xx)-.013*xx
    front=(edge[col]-yc+span*c*upper)/(span*s);back=(top[col]-yc+span*c*upper)/(span*s)
    thick=np.maximum(.014,(bottom[col]-edge[col])/(span*c))
    lower=upper-thick; depth_fraction=np.clip((upper-yy)/thick,0,1)
    # Uneven split along the physical edge. Keep it shallow relative to the slab.
    split=.0035*(np.sin((yy+.23*xx)*220)+.5*np.sin(55*xx+20*zz))
    field=np.minimum.reduce([.50-abs(xx),upper-yy,yy-lower,front-zz+split,zz-back-.016*depth_fraction])
    vy,vx=project(pts,views[0]);field=np.minimum(field,distance(mask)[vy,vx]/span)
    return pts,field,views,.215,'x'


def bake(kind,builder):
    pts,field,views,target,axis=builder();step=pts[1,0,0,0]-pts[0,0,0,0]
    verts,faces,_,_=marching_cubes(ndimage.gaussian_filter(field,.72),level=0,spacing=(step,step,step),allow_degenerate=False)
    verts+=pts[0,0,0]
    # Marching cubes returns inward winding on a positive-inside volume.
    faces=np.ascontiguousarray(faces[:,::-1],dtype=np.int32)
    volume=np.sum(np.einsum('ij,ij->i',verts[faces[:,0]],np.cross(verts[faces[:,1]],verts[faces[:,2]])))/6
    if volume<0:faces=faces[:,::-1].copy()
    center=(verts.min(axis=0)+verts.max(axis=0))/2
    factor=target/np.ptp(verts,axis=0)['xyz'.index(axis)]
    def mesh(n):
        v,f=fast_simplification.simplify(verts,faces,target_count=min(n,len(faces)-1))
        v=(v-center)*factor
        record={'positions':encoded(v.astype('<f4')),'indices':encoded(f.astype('<u2'))}
        if kind=='dragon' and n>2000:
            xyz=v/factor+center
            normals=np.zeros_like(xyz);tri=xyz[f]; fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
            for col in range(3):np.add.at(normals,f[:,col],fn)
            normals/=np.maximum(.0001,np.linalg.norm(normals,axis=1,keepdims=True))
            occlusion=np.zeros(len(xyz));normalizer=np.zeros(len(xyz))
            for k in range(40):
                t=(k+.5)/40; a=k*2.399963; h=1-2*t;q=np.sqrt(1-h*h)
                direction=np.array([q*np.cos(a),h,q*np.sin(a)])
                incidence=np.maximum(0,normals@direction)
                blocked=np.zeros(len(xyz))
                for distance_px in [5,10,19,33,50]:
                    ijk=((xyz+distance_px*direction-pts[0,0,0])/step).T
                    hits=ndimage.map_coordinates(field,ijk,order=1,mode='constant',cval=-3)
                    blocked=np.maximum(blocked,(hits>1)*np.exp(-distance_px/67))
                occlusion+=incidence*blocked;normalizer+=incidence
            shade=np.clip(1-occlusion/np.maximum(.01,normalizer)*1.15,.56,1)
            record['shade']=encoded(np.uint8(shade*255))
        return record
    record={'mesh':mesh(27000 if kind=='dragon' else 12500),'collision':mesh(1800)}
    # Each source gets a padded tile; nearest-on-object colour extends through the
    # margin so mip filtering near contours never pulls in the photo background.
    tiles=[];references=[]
    for v in views:
        m=v['mask'];ys,xs=np.where(m);x0,x1=xs.min(),xs.max();y0,y1=ys.min(),ys.max()
        side=max(x1-x0+1,y1-y0+1)*1.04;origin=np.array([(x0+x1-side)/2,(y0+y1-side)/2])
        mat=np.column_stack((v['A']/factor,v['A']@center+v['C']))
        references.append(dict(matrix=mat.tolist(),facing=v['facing'].tolist(),origin=origin.tolist(),side=float(side)))
        if v['image'] is not None:
            im=v['image'];nearest=ndimage.distance_transform_edt(~m,return_distances=False,return_indices=True)
            filled=im[tuple(nearest)];M=np.array([[TILE/side,0,-origin[0]*TILE/side],[0,TILE/side,-origin[1]*TILE/side]])
            tile=cv.warpAffine(filled,M,(TILE,TILE),flags=cv.INTER_AREA,borderMode=cv.BORDER_REPLICATE)
            tiles.append(tile)
    record['views']=references
    if tiles:
        atlas=np.zeros((TILE*2,TILE*2,3),'uint8')
        for i,tile in enumerate(tiles):
            y,x=divmod(i,2);atlas[y*TILE:(y+1)*TILE,x*TILE:(x+1)*TILE]=tile
        if len(tiles)==1:atlas=tiles[0]
        record['atlas']=encoded(cv.imencode('.jpg',atlas,[cv.IMWRITE_JPEG_QUALITY,91])[1])
    return record


if __name__=='__main__':
    specimens={k:bake(k,b) for k,b in [('dragon',dragon),('slate',slate),('river',river)]}
    (STONE/'measured-specimens.js').write_text('// Generated by tools/build_stone_specimens.py. See stone/SOURCES.md.\nwindow.AQUARIUM_STONE_SPECIMENS='+json.dumps(specimens,separators=(',',':'))+';\n')
