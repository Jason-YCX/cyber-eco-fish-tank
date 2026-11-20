"""Rectify leaf interiors from credited photographs into synchronous, file://-safe texture data."""
import base64
import json
import math
import statistics
import subprocess
from pathlib import Path

from leaf_landmarks import SPECIMENS

HERE = Path(__file__).resolve().parent


def pixels(name):
    path = HERE / "source" / (name + ".png")
    shape = subprocess.check_output(["ffprobe", "-v", "error", "-of", "csv=p=0",
                                    "-show_entries", "stream=width,height", str(path)], text=True)
    width, height = map(int, shape.strip().split(","))
    rgb = subprocess.check_output(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
                                   "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    return width, height, rgb


# Each station lists a point on the midrib and offsets from it to the inner margins.
# Coordinates for the floater refer to a 525 px wide proof of the photograph.
LEAVES = {
    "monte": (48, 64, 840, [
        [(426,466,2,1), (430,458,9,3), (434,445,17,8), (436,431,25,12),
         (440,415,21,10), (445,407,11,5), (450,401,1,0)],
        [(390,324,2,0), (391,314,9,1), (393,302,16,3), (396,291,25,5),
         (397,280,23,3), (400,270,13,3), (399,265,2,0)],
    ]),
    "floater": (96, 104, 525, [
        [(224,510,0,3), (248,512,1,42), (271,514,2,69), (306,515,0,83),
         (345,514,5,83), (384,507,9,68), (410,501,13,44), (429,495,6,16), (434,493,0,1)],
        [(268,218,1,3), (245,207,-12,28), (212,188,-23,44), (172,163,-30,50),
         (141,145,-25,43), (115,130,-20,32), (91,117,-10,18), (83,116,0,2)],
    ]),
    "ribbon": (24, 256, 95, [
        [(32,297,2,0), (29,243,3,0), (28,197,4,0), (28,155,4,0),
         (27,115,4,0), (27,75,4,0), (27,40,3,0), (26,19,2,0)],
    ]),
}


def sample(picture, x, y):
    width, height, rgb = picture
    x, y = max(0, min(width-2, x)), max(0, min(height-2, y))
    xx, yy = int(x), int(y)
    mix_x, mix_y = x-xx, y-yy
    weights = [(xx, yy, (1-mix_x)*(1-mix_y)), (xx+1, yy, mix_x*(1-mix_y)),
               (xx, yy+1, (1-mix_x)*mix_y), (xx+1, yy+1, mix_x*mix_y)]
    return [sum(rgb[3*(py*width+px)+c]*w for px, py, w in weights) for c in range(3)]


def bake(name, info):
    width, height, proof_width, leaves = info
    picture = pixels(name)
    scale = picture[0] / proof_width
    data = bytearray()
    for stations in leaves:
        signals = []
        for y in range(height):
            v = y / (height-1)
            along = v*(len(stations)-1)
            i = min(len(stations)-2, int(along))
            cx, cy, dx, dy = [a+(along-i)*(b-a) for a,b in zip(stations[i], stations[i+1])]
            contour = 1 if name == "ribbon" else math.sqrt(max(.001, 1-(2*v-1)**2))
            for x in range(width):
                side = min(1, max(-1, (2*x/(width-1)-1)/contour))
                r, g, b = sample(picture, scale*(cx+side*dx), scale*(cy+side*dy))
                luminance = .21*r + .72*g + .07*b
                pigment = (r-b) / max(30, g)
                signals.append((luminance, pigment))
        # Remove capture exposure and white balance. Keep the measured local contrast and chroma.
        medians = [statistics.median(column) for column in zip(*signals)]
        for lum, hue in signals:
            data.extend((round(max(0,min(255, 128+(lum-medians[0])*1.7))),
                         round(max(0,min(255, 128+(hue-medians[1])*150)))))
    return {"width": width, "height": height, "count": len(leaves),
            "rg": base64.b64encode(data).decode("ascii")}


def measured_blade(specimen):
    # The same local coordinates drive both the 3D rim and the colour lookup.
    picture = pixels(specimen['source'])
    x0, y0, w, h = specimen['crop'] or (0, 0, *picture[:2])
    sx, sy = w/specimen['proof'][0], h/specimen['proof'][1]
    bx, by = specimen['base']
    tx, ty = specimen['apex']
    length = math.hypot(tx-bx, ty-by)
    ex, ey = (tx-bx)/length, (ty-by)/length
    pts = [(((x-bx)*ex+(y-by)*ey)/length, (-(x-bx)*ey+(y-by)*ex)/length)
           for x,y in specimen['outline']]
    area = sum(a*d-b*c for (a,b),(c,d) in zip(pts,pts[1:]+pts[:1]))
    if area < 0:
        pts.reverse()
    center = tuple(sum(p[k] for p in pts)/len(pts) for k in (0,1))
    bounds = [min(p[0] for p in pts), max(p[0] for p in pts),
              min(p[1] for p in pts), max(p[1] for p in pts)]
    side = 120 if specimen['source']=='floater-a' else 64
    rgb = bytearray()
    for row in range(side):
        a = bounds[0] + row/(side-1)*(bounds[1]-bounds[0])
        for col in range(side):
            c = bounds[2] + col/(side-1)*(bounds[3]-bounds[2])
            # Extend the rim colour into the gutter to keep bilinear and mip levels clean.
            inside = False
            best = float('inf')
            for (u,v),(xx,yy) in zip(pts,pts[1:]+pts[:1]):
                if (v>c)!=(yy>c) and a<(xx-u)*(c-v)/(yy-v)+u:
                    inside = not inside
                du,dv=xx-u,yy-v
                t=max(0,min(1,((a-u)*du+(c-v)*dv)/(du*du+dv*dv)))
                q,r = u+t*du, v+t*dv
                dist = (a-q)**2+(c-r)**2
                if dist<best:
                    best, nearest = dist, (q,r)
            q,r = (a,c) if inside else nearest
            q=.985*q+.015*center[0]
            r=.985*r+.015*center[1]
            x,y=bx+length*(ex*q-ey*r),by+length*(ey*q+ex*r)
            rgb.extend(round(n) for n in sample(picture,x0+sx*x,y0+sy*y))
    return dict(outline=[[round(n,6) for n in p] for p in pts], bounds=bounds,
                center=center, side=side, rgb=base64.b64encode(rgb).decode('ascii'))


if __name__ == "__main__":
    atlas = {name: bake(name, info) for name, info in LEAVES.items()}
    for name, specimen in SPECIMENS.items():
        atlas[name]["blade"] = measured_blade(specimen)
    (HERE / "leaf-photo-data.js").write_text("// Derived leaf photographs. Credits and licenses: SOURCES.md\n"
        "window.AQUARIUM_LEAF_PHOTOS = " + json.dumps(atlas, separators=(",", ":")) + ";\n")
