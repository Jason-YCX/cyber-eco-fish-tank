"""Bake rectified fish photographs into indexed, synchronous Three.js texture inputs.

Run with Python 3, numpy and ffmpeg. Source image names and credits are in assets/fish.
Landmarks use a right-facing 800-pixel-wide reference view, rotated for the guppy.
"""
from base64 import b64encode
from pathlib import Path
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets/fish"
# Orthographic photo coordinates after the rigid rotations/flips in sample().
# The outline contains (x, dorsal y, ventral y); extruded widths are separate.
# Baseline only positions the fish origin. One scale serves both image axes.
FISH = {
    "guppy": {
        "file": "Guppy1.jpg", "size": (2445, 1800), "frame": (142,949,394),
        "outline": [(463,357,429),(503,350,437),(548,345,431),(598,333,425),
                    (641,321,429),(669,313,440),(710,316,447),(753,320,447),
                    (789,325,445),(824,333,439),(858,345,440),(887,357,428),
                    (911,366,415),(932,375,403),(943,386,400),(949,394,396)],
        "widths": [(0,.10),(.18,.30),(.40,.69),(.66,1),(.82,.96),(.93,.83),(.97,.48),(1,.04)],
        "half_width": .071, "eye": (895,391,18.5,19,-52,-2),
        "tail": ((467,394),[(472,428),(444,500),(385,580),(354,612),(322,626),
                            (294,627),(264,607),(220,584),(180,536),(164,466),
                            (144,412),(140,358),(150,316),(167,291),(197,275),
                            (231,278),(311,303),(384,322),(431,336),(463,356)]),
        "dorsal": ((580,342),[(654,318),(643,303),(620,287),(601,280),(583,275),
                              (560,277),(534,284),(498,286),(467,288),(452,296),
                              (430,296),(414,302),(406,315),(420,329),(463,345),(501,349)]),
        "paired": ((702,437),[(731,442),(719,461),(697,487),(666,511),(689,478),(698,452)]),
    },
    "guppyLace": {
        # Native pixels. A second photograph of this same male shows the crown in a turn.
        "file":"guppy-lace-side.jpg","size":(499,384),"frame":(42,341,149),
        "outline":[(153,132,169),(171,131,169),(191,129,169),(214,127,171),
                   (235,124,174),(256,123,174),(277,125,172),(293,125,170),
                   (307,124,168),(320,126,164),(331,130,158),(338,135,150),(341,140,146)],
        "widths":[(0,.11),(.26,.42),(.58,.88),(.75,1),(.90,.82),(.98,.43),(1,.08)],
        "half_width":.065,"eye":(317,149,7,7,-12,1),
        "tail":((155,150),[(156,168),(140,178),(117,190),(85,196),(53,199),(44,196),
                           (42,184),(42,160),(43,138),(45,126),(46,117),(62,115),
                           (79,112),(100,118),(129,125),(152,134)]),
        "dorsal":((190,132),[(220,124),(197,118),(193,112),(184,111),(174,114),
                             (165,117),(159,123),(153,129),(165,132)]),
        "paired":((236,165),[(250,168),(239,177),(218,182),(204,183),(217,176)]),
    },
    "pandaCory": {
        "file": "Corydoras_panda_1.jpg", "size": (1600,1200), "frame": (280,593,274),
        "outline": [(368,243,271),(380,240,278),(393,239,285),(409,236,291),
                    (427,231,297),(444,226,299),(461,220,301),(479,221,301),
                    (499,225,302),(516,228,305),(532,232,306),(547,236,303),
                    (557,238,299),(568,251,296),(578,266,292),(586,278,297),(593,289,296)],
        "widths": [(0,.15),(.14,.31),(.34,.65),(.56,.94),(.68,1),(.79,.94),(.89,.75),(.96,.47),(1,.10)],
        # At pectoral-spine origin the holotype's width is 13.0 mm / 41.9 mm SL.
        "half_width": (13/41.9)*(593-368)/(593-280)/2,
        "eye": (530,269.5,10.5,10,-7,-17),
        "tail": ((372,257),[(372,273),(346,271),(317,268),(291,266),(287,261),
                             (298,254),(307,247),(307,237),(300,228),(286,212),
                             (280,200),(284,196),(301,201),(321,215),(348,231),(370,245)]),
        "dorsal": ((436,232),[(457,221),(446,207),(438,196),(431,187),(428,185),
                              (425,190),(417,193),(412,201),(405,207),(404,218),(415,230)]),
        "paired": ((482,292),[(494,295),(485,312),(476,323),(455,326),(466,305)]),
    },
    "otocinclus": {
        "file": "Otocinclus_macrospilus_2.jpg", "size": (800,361), "frame": (1,740,214),
        "outline": [(141,185,262),(174,184,259),(212,178,251),(258,166,247),
                    (309,156,245),(353,145,244),(401,137,244),(440,128,245),
                    (475,125,247),(515,129,249),(553,132,249),(589,139,249),
                    (622,152,251),(652,163,251),(678,181,247),(700,198,244),
                    (726,209,241),(736,217,236),(740,226,231)],
        "widths": [(0,.16),(.18,.32),(.34,.49),(.46,.78),(.60,1),(.74,.91),(.85,.85),(.95,.61),(1,.17)],
        "half_width": (86/337)*(740-141)/(740-1)/2, "eye": (651,223,17,17,-49,-12),
        # The lower lobe partially leaves the photographer's left frame.
        "tail": ((145,220),[(146,258),(92,278),(35,300),(3,308),(9,285),
                             (22,267),(29,238),(22,214),(2,193),(2,182),
                             (27,180),(60,182),(93,184),(141,188)]),
        "dorsal": ((427,138),[(475,125),(455,102),(424,79),(392,63),(361,49),
                               (347,47),(345,57),(352,81),(353,106),(351,139),(364,146)]),
        "paired": ((564,237),[(578,241),(568,258),(539,282),(507,295),(516,282),(538,264)]),
    },
}

def fitted_profile(spec):
    left,right,base = spec["frame"]
    total = right-left
    body=np.asarray(spec["outline"])
    widths=np.asarray(spec["widths"])
    def yz(point):
        x,y=point
        return [round((base-y)/total,6),round((x-left)/total-.5,6)]
    axis=(body[:,0]-body[0,0])/(body[-1,0]-body[0,0])
    radius=np.interp(axis,widths[:,0],widths[:,1])*spec["half_width"]
    rings=[[yz((x,t))[1],round(r,6),yz((x,t))[0],yz((x,b))[0]] for (x,t,b),r in zip(body,radius)]
    ex,ey,rx,ry,*_=spec["eye"]
    data={"rings":rings,"eye":yz((ex,ey)),"eyeSize":round((rx+ry)/(2*total),6)}
    for k in ["tail","dorsal","paired"]:
        root,edge=spec[k]
        data[k]={"root":yz(root),"edge":[yz(q) for q in edge]}
    return data

def photo(spec):
    w,h = spec["size"]
    raw = subprocess.check_output(["ffmpeg","-loglevel","error","-i",str(ASSETS/spec["file"]),
                                   "-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"])
    return np.frombuffer(raw, np.uint8).reshape(h,w,3)

def sample(img, species, x, y):
    if species == "guppy":
        dx,dy = x-499.5,y-449.5
        cs,sn = np.cos(.47),np.sin(.47)
        x,y = cs*dx+sn*dy+399.5,-sn*dx+cs*dy+299.5
    elif species == "pandaCory":
        x=799-x
    scale=1 if species=="guppyLace" else img.shape[1]/800
    x,y=(x+.5)*scale-.5,(y+.5)*scale-.5
    ix,iy=np.floor(x).astype(int),np.floor(y).astype(int)
    fx,fy=(x-ix)[...,None],(y-iy)[...,None]
    return ((1-fx)*(1-fy)*img[iy,ix]+fx*(1-fy)*img[iy,ix+1]+
            (1-fx)*fy*img[iy+1,ix]+fx*fy*img[iy+1,ix+1])

def local_average(rgb,rx,ry):
    padded=np.pad(rgb,((ry,ry),(rx,rx),(0,0)),mode="edge")
    integral=np.pad(padded,((1,0),(1,0),(0,0))).cumsum(0).cumsum(1)
    w,h=2*rx+1,2*ry+1
    return (integral[h:,w:]-integral[:-h,w:]-integral[h:,:-w]+integral[:-h,:-w])/(w*h)

def maps(img, species, spec):
    u,v=np.meshgrid((np.arange(640)+.5)/640,(np.arange(160)+.5)/160)
    x,top,bottom=np.transpose(spec["outline"])
    axis=(x-x[0])/(x[-1]-x[0])
    px=np.interp(u,axis,x)
    py=np.interp(u,axis,bottom)*(1-v)+np.interp(u,axis,top)*v
    ex,ey,rx,ry,dx,dy=spec["eye"]
    radius=np.hypot((px-ex)/rx,(py-ey)/ry)
    blend=np.clip((1.25-radius)/.3,0,1)[...,None]
    flank=sample(img,species,px,py)
    # Restore the gill/flank underneath the 3D eyeball to avoid a second painted eye.
    mask_color=sample(img,species,px+dx,py+dy)
    if species == "pandaCory":
        # Sample dark skin in the eye band; it is only a few pixels from green plants.
        mask_color=sample(img,species,526+(px-ex)*.26,252+(py-ey)*.24)
    elif species == "guppy":
        mask_color=sample(img,species,864+(px-ex)*.37,383+(py-ey)*.37)
    flank=flank*(1-blend)+mask_color*blend
    # Recover neutral skin/bone colors from underwater illumination. Narrow photo contours
    # include a few refracted background pixels; compress their chroma before baking.
    lum=(flank*np.array([.25,.62,.13])).sum(axis=2,keepdims=True)
    if species == "pandaCory":
        neutral=lum*np.array([1.06,1.00,.91])
        flank=neutral*.36+flank*.64
        filtered=local_average(flank,7,3)
        plate_area=np.clip((.77-u)*19,0,1)*np.clip((u-.09)*18,0,1)
        flank+=.20*plate_area[...,None]*(filtered-flank)
    elif species == "otocinclus":
        flank=.67*flank+.33*lum*np.array([1.05,1.01,.91])
    else:
        flank=flank*.90+lum*.10
    flank=5+flank*.96-np.maximum(flank-208,0)*.31
    if species == "guppyLace":
        # A uniform rigid camera alignment from the angled portrait maps the
        # crown. These stations follow the photographed animal from tail to snout.
        back=photo({"file":"guppy-lace-turn.jpg","size":(553,519)})
        st=np.array([[0,197,183,8],[.20,248,155,11],[.42,307,126,13],
                     [.63,358,99,14],[.80,398,81,13],[.93,433,66,8],[1,451,60,1]])
        cx=np.interp(u,st[:,0],st[:,1]); cy=np.interp(u,st[:,0],st[:,2])
        off=np.interp(u,st[:,0],st[:,3])*np.sqrt(1-(2*v-1)**2)
        dorsal=back[np.rint(cy+off*.88).astype(int),np.rint(cx+off*.47).astype(int)].astype(float)
        fade=np.clip((v-.77)/.21,0,1);fade=(fade*fade*(3-2*fade))[...,None]
        flank=flank*(1-fade)+dorsal*fade
    if species == "pandaCory":
        # The bank of greenery behind the side photograph is visible at the
        # near-tangent upper contour. Map a real oblique dorsal view into the
        # crown instead. Numbers follow the 740px-wide, second turning frame.
        back=photo({"file":"panda-turn-2.jpg","size":(1024,768)})
        stations=np.array([[0,354,205,8],[.16,335,223,12],[.34,312,241,15],
                           [.52,287,264,20],[.68,264,286,20],[.82,245,308,18],
                           [.93,229,329,10],[1,216,344,4]])
        cx=np.interp(u,stations[:,0],stations[:,1])
        cy=np.interp(u,stations[:,0],stations[:,2])
        offset=np.interp(u,stations[:,0],stations[:,3])*np.sqrt(1-(2*v-1)**2)
        px=np.rint((cx+offset*.71)*1024/740).astype(int)
        py=np.rint((cy+offset*.70)*1024/740).astype(int)
        dorsal=back[py,px].astype(float)
        fade=np.clip((v-.78)/.20,0,1)
        fade=(fade*fade*(3-2*fade))[...,None]
        flank=flank*(1-fade)+dorsal*fade
    if species == "otocinclus":
        # Frontal glass photograph made perpendicular to the ventral surface. Rows
        # follow the curved body axis in its 740px-wide reference. Preserve the
        # side picture on the flank and blend the real ventral skin below it.
        belly=photo({"file":"oto-belly-KadenSlone.jpg","size":(1024,768)})
        rows=np.array([[0,403,268,282],[.18,342,267,297],[.34,286,262,308],
                       [.46,247,257,331],[.60,200,254,337],[.74,155,267,344],
                       [.85,118,270,344],[.95,84,292,337],[1,66,312,321]])
        by=np.interp(u,rows[:,0],rows[:,1])*1024/740
        left=np.interp(u,rows[:,0],rows[:,2]); right=np.interp(u,rows[:,0],rows[:,3])
        mid=(left+right)/2;span=(right-left)*.46*np.sqrt(1-(2*v-1)**2)
        patch=.5*(belly[np.rint(by).astype(int),np.rint((mid-span)*1024/740).astype(int)].astype(float)+
                  belly[np.rint(by).astype(int),np.rint((mid+span)*1024/740).astype(int)].astype(float))
        fade=np.clip((.24-v)/.18,0,1);fade=(fade*fade*(3-2*fade))[...,None]
        # The glass reference has a little green reflected light in its margins.
        patch=patch*.82+np.mean(patch,axis=2,keepdims=True)*.18
        flank=flank*(1-fade)+patch*fade
    yield "body",flank
    # The iris is fitted to a second curved surface, with highlights limited so the
    # scene's own moving light remains visible on the cornea.
    ex,ey,rx,ry={
        "guppy":(895,391,17.5,18.5), "pandaCory":(530,269.5,10.5,10),
        "otocinclus":(651,222.8,16,16),"guppyLace":(317,149,7,7),
    }[species]
    exu,eyv=np.meshgrid(2*(np.arange(80)+.5)/80-1,2*(np.arange(80)+.5)/80-1)
    eye=sample(img,species,ex+rx*exu,ey-ry*eyv)
    eye-=np.maximum(eye-152,0)*.51
    yield "eye",eye
    # Radial texture space runs from the attachment out along the actual photographed rays.
    for kind in ("tail","dorsal"):
        root,margin=spec[kind]
        u,v=np.meshgrid((np.arange(256)+.5)/256,(np.arange(192)+.5)/192)
        knots=np.linspace(0,1,len(margin))
        mx,my=np.transpose(margin)
        x=root[0]+v*(np.interp(u,knots,mx)-root[0])
        y=root[1]+v*(np.interp(u,knots,my)-root[1])
        yield kind,sample(img,species,x,y)

def encode(pic):
    h,w,_=pic.shape
    cmd=["ffmpeg","-loglevel","error","-f","rawvideo","-pix_fmt","rgb24","-s",f"{w}x{h}",
         "-i","pipe:0","-filter_complex",
         "split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none",
         "-frames:v","1","-pix_fmt","pal8","-f","rawvideo","pipe:1"]
    pal8=subprocess.check_output(cmd,input=np.clip(pic,0,255).astype(np.uint8).tobytes())
    colors=np.frombuffer(pal8[w*h:], np.uint8).reshape(256,4)[:,[2,1,0]].copy()
    return {"width": w,"height": h,"index": b64encode(pal8[:w*h]).decode(),
            "palette": b64encode(colors.tobytes()).decode()}

if __name__ == "__main__":
    data={}
    for species,spec in FISH.items():
        data[species]={key: encode(pic) for key,pic in maps(photo(spec),species,spec)}
        data[species]["profile"]=fitted_profile(spec)
    with (ASSETS / "fish-photo-data.js").open("w") as out:
        out.write("// Rectified photographic samples. Individual credits and licenses in SOURCES.md.\n")
        out.write("window.AQUARIUM_FISH_PHOTOS = ")
        json.dump(data,out,separators=(",",":"))
        out.write(";\n")
