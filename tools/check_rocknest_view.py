"""Project the Demo's packed Rocknest texture and measured mesh into the held-out 0491 camera."""
import base64
import json
import struct

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from build_rocknest_sand import SIZE, SOURCE, STUDY, TEXEL_MM, axes, photograph, project, sample


def maps():
    package = (SOURCE.parent/'substrate-scans.js').read_text()
    asset = json.loads(package.split(' = ',1)[1].removesuffix(';\n'))['redSand']
    def decode(key):
        return cv2.imdecode(np.frombuffer(base64.b64decode(asset[key]),np.uint8),cv2.IMREAD_COLOR)
    meta = json.loads((SOURCE/'rocknest_58-calibration.json').read_text())
    assert np.isclose(asset['heightRatio'],meta['heightRatio'])
    packed = decode('roughness')
    height = packed[:,:,2].astype(np.float32)/255*(meta['maxHeightMm']-meta['minHeightMm'])+meta['minHeightMm']
    return decode('color'),decode('normal'),height,meta,asset


class Grid:
    def __init__(self, height):
        self.axis = np.unique(np.r_[np.arange(0,SIZE,4),SIZE-1])
        self.h = height[np.ix_(self.axis,self.axis)]
    def at(self, uv):
        a = self.axis
        px,py = np.clip(uv,0,SIZE-1).T
        x,y = [np.clip(np.searchsorted(a,p,side='right')-1,0,len(a)-2) for p in (px,py)]
        tx,ty = (px-a[x])/(a[x+1]-a[x]),(py-a[y])/(a[y+1]-a[y])
        z = self.h
        return np.where(tx+ty<=1,z[y,x]+(z[y,x+1]-z[y,x])*tx+(z[y+1,x]-z[y,x])*ty,
                        z[y+1,x+1]+(z[y+1,x]-z[y+1,x+1])*(1-tx)+(z[y,x+1]-z[y+1,x+1])*(1-ty))


def intersections(cal,camera,xy,grid,flat=False):
    n,org = cal['n'],cal['org']
    right,down = axes(n)
    rays = np.column_stack(((xy[:,0]-791.5)/cal['f'][camera],(xy[:,1]-591.5)/cal['f'][camera],np.ones(len(xy))))@cal['R'][camera]
    origin = cal['C'][camera]
    denominator = rays@n
    height = 0
    for _ in range(7):
        points = origin+rays*((height+(org-origin)@n)/denominator)[:,None]
        uv = np.column_stack(((points-org)@right,(points-org)@down))/TEXEL_MM + SIZE/2
        if flat:
            break
        height = grid.at(uv)
    return points,uv


def glb(grid, asset):
    # glTF is Y-up and uses metres. UVs match texel centres in the packed Demo maps.
    a = grid.axis
    y,x = np.meshgrid(a,a,indexing='ij')
    pos = np.stack(((x-SIZE/2)*TEXEL_MM,grid.h,(y-SIZE/2)*TEXEL_MM),axis=-1).reshape(-1,3).astype('<f4')*.001
    uv = (np.stack((x,y),axis=-1).reshape(-1,2)+.5).astype('<f4')/SIZE
    ids = np.arange(x.size).reshape(x.shape)
    a,b,c,d = ids[:-1,:-1],ids[:-1,1:],ids[1:,:-1],ids[1:,1:]
    idx = np.stack((a,c,b,c,d,b),axis=-1).astype('<u4').ravel()
    # Explicit geometric normals keep the texture's tangent space stable in viewers.
    faces=idx.reshape(-1,3)
    face_normal=np.cross(pos[faces[:,1]]-pos[faces[:,0]],pos[faces[:,2]]-pos[faces[:,0]])
    normals=np.zeros_like(pos)
    for k in range(3):
        np.add.at(normals,faces[:,k],face_normal)
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-15)
    blocks=[pos.tobytes(),uv.tobytes(),idx.tobytes(),normals.tobytes(),
            *[base64.b64decode(asset[name]) for name in ('color','normal','roughness')]]
    buf=bytearray()
    views=[]
    for i,block in enumerate(blocks):
        views.append(dict(buffer=0,byteOffset=len(buf),byteLength=len(block)))
        if i<4:
            views[-1]['target']=34963 if i==2 else 34962
        buf.extend(block)
        buf.extend(bytes(-len(buf)%4))
    accessors=[dict(bufferView=0,componentType=5126,count=len(pos),type='VEC3',min=pos.min(axis=0).tolist(),max=pos.max(axis=0).tolist()),
               dict(bufferView=1,componentType=5126,count=len(uv),type='VEC2'),
               dict(bufferView=2,componentType=5125,count=len(idx),type='SCALAR'),
               dict(bufferView=3,componentType=5126,count=len(pos),type='VEC3')]
    material={'doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':2},'metallicFactor':0},
              'normalTexture':{'index':1,'scale':.45}}
    doc={'asset':{'version':'2.0','copyright':'NASA/JPL-Caltech/MSSS (source photography)'},'scene':0,'scenes':[{'nodes':[0]}],
         'nodes':[{'mesh':0}],'meshes':[{'name':'Rocknest 58 / 32.768 mm','primitives':[{'attributes':{'POSITION':0,'TEXCOORD_0':1,'NORMAL':3},'indices':2,'material':0}]}],
         'materials':[material],'textures':[{'source':i} for i in range(3)],'images':[{'mimeType':'image/jpeg','bufferView':4+i} for i in range(3)],
         'buffers':[{'byteLength':len(buf)}],'bufferViews':views,'accessors':accessors}
    meta=json.dumps(doc,separators=(',',':')).encode()
    meta+=b' '*(-len(meta)%4)
    (STUDY/'暖红砂样块.glb').write_bytes(struct.pack('<4sII',b'glTF',2,28+len(meta)+len(buf))+struct.pack('<I4s',len(meta),b'JSON')+meta+struct.pack('<I4s',len(buf),b'BIN\0')+buf)


def board(photo,model,stats):
    overlay=np.uint8(np.rint((photo.astype(float)+model)*.5))
    def detail(rgb):
        gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY).astype(np.float32)
        return np.uint8(np.clip((gray-cv2.GaussianBlur(gray,(0,0),1.5))*2.2+105,0,255))
    a,b=detail(photo),detail(model)
    edges=np.stack((b,a,a),axis=-1)
    palette=['#192625','#f2f1e8','#b7c9bf','#dfb879']
    img=Image.new('RGB',(1290,940),palette[0]); draw=ImageDraw.Draw(img)
    def title(x,y,t,sz,color=1):
        font=ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc',sz)
        draw.text((x,y),t,fill=palette[color],font=font)
    title(25,19,'暖红砂　｜　Rocknest 同一块砂面',36)
    title(27,76,'NASA / JPL-Caltech / MSSS　·　0491 机位实拍，视线偏离砂面法线约 9°　·　原始光照下核对',19,2)
    for i,t in enumerate(['斜拍原片','三维网格与 Demo 贴图','50% 叠图']):
        title(25+420*i,122,t,22)
    box=(65,73,127,119)
    for i,data in enumerate([photo,model,overlay]):
        tile=Image.fromarray(data).resize((388,334),Image.Resampling.LANCZOS)
        bx=[v*(388 if k%2==0 else 334)/(data.shape[1] if k%2==0 else data.shape[0]) for k,v in enumerate(box)]
        ImageDraw.Draw(tile).rectangle(bx,outline=palette[3],width=2)
        img.paste(tile,(25+420*i,162))
    title(25,520,'金框放大 6 倍',20)
    title(865,520,'青色为实拍边缘，红色为模型边缘',17,2)
    for i,data in enumerate([photo,model,edges]):
        tile=Image.fromarray(data).crop(box).resize((372,276),Image.Resampling.NEAREST)
        img.paste(tile,(25+420*i,563))
    count,flat,med,p90=stats
    title(25,858,f'{count} 个留出地标　·　平面中位偏差 {flat:.2f} px　·　起伏网格 {med:.2f} px　·　90% 在 {p90:.2f} px 内',20)
    title(25,898,'原片保留显微镜头的解析度；颗粒背光边缘仍能看出红青分离。三栏使用相同裁切，没有在叠图时单独移动颗粒。',16,2)
    img.save(STUDY/'暖红砂斜拍与模型.png',optimize=True)


def main():
    color,normal,height,meta,asset = maps()
    grid=Grid(height)
    cal=np.load(STUDY/'相机与三角测量.npz')
    test=cal['test']
    original=cal['T'][1,test]
    anchor=cal['T'][3,test]
    points,uv=intersections(cal,3,anchor,grid)
    flat,_=intersections(cal,3,anchor,grid,flat=True)
    good=np.all((uv>40)&(uv<SIZE-40),axis=1)
    error=np.linalg.norm(project(cal,1,points)-original,axis=1)[good]
    simple=np.linalg.norm(project(cal,1,flat)-original,axis=1)[good]
    stats=(len(error),float(np.median(simple)),float(np.median(error)),float(np.quantile(error,.9)))
    center=np.rint(project(cal,1,cal['org'])).astype(int)
    width,height=210,181
    oy,ox=center[1]-height//2,center[0]-width//2
    py,px=np.mgrid[oy:oy+height,ox:ox+width]
    _,uv=intersections(cal,1,np.stack((px,py),axis=-1).reshape(-1,2),grid)
    uv=uv.reshape(height,width,2)
    assert uv.min()>0 and uv.max()<SIZE-1
    texture=sample(color,uv).astype(np.float32)
    n=sample(normal,uv)[:,:,::-1].astype(np.float32)/127.5-1
    coeff=np.array(meta['lightFit'])
    shade=np.clip(np.exp(coeff[0]+n@coeff[1:]-meta['lightFitMedian']),.68,1.28)
    model=np.uint8(np.clip(np.rint(texture*shade[...,None]),0,255))
    # One common lens footprint across the model crop; coordinates are untouched.
    model=cv2.GaussianBlur(model,(0,0),.48)
    cv2.imwrite(str(STUDY/'同机位模型.png'),model)
    photo=photograph(1)[oy:oy+height,ox:ox+width]
    board(cv2.cvtColor(photo,cv2.COLOR_BGR2RGB),cv2.cvtColor(model,cv2.COLOR_BGR2RGB),stats)
    glb(grid,asset)
    print('landmarks, flat median, rendered mesh median, mesh P90:',stats)
    print('sensor crop',ox,oy,width,height,'mean channel error',abs(photo.astype(float)-model).mean())


if __name__=='__main__':
    main()
