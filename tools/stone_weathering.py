"""Bake eroded surfaces in millimetres. The slow, broad component drives geometry;
the remaining gradient and cavity depth are read by the underwater material."""
from array import array
from base64 import b64encode
import math
import random

SIZE = 768
COARSE = 96
RANGE_MM = 3.0

# Millimetres in one repeat, impact pits, mineral nodules, fracture traces.
STYLES = {
    'dragon': (155., 310, 210, 7),
    'slate': (176., 105, 84, 11),
    'river': (166., 94, 44, 4),
}


def clamp(x, a=0., b=1.):
    return max(a, min(b, x))


def build_relief(kind, ffmpeg, scan_normal):
    rng = random.Random({'dragon': 67616, 'slate': 33573, 'river': 90486}[kind])
    period, pit_count, nodule_count, cracks = STYLES[kind]
    scale = SIZE / period
    height = array('f', [0]) * (SIZE * SIZE)
    clusters = [(rng.random()*SIZE, rng.random()*SIZE) for _ in range(7)]

    def centre():
        if rng.random() < .44:
            x, y = rng.choice(clusters)
            return x + rng.gauss(0, SIZE*.062), y + rng.gauss(0, SIZE*.062)
        return rng.random()*SIZE, rng.random()*SIZE

    # A pit can have a chipped lip only along part of its rim. A nodule has
    # unequal shoulders, dark intervening matrix, and a small flattened crown.
    def scar(pit):
        x, y = centre()
        radius = (.42 + (4.1 if pit else 2.65) * rng.random()**2) * scale
        if kind == 'river':
            radius *= .85
        if kind == 'slate':
            radius *= 1.24
        ratio = rng.uniform(.43,.88) if kind == 'slate' else rng.uniform(.64,1.)
        a = rng.uniform(-.37,.37) if kind == 'slate' else rng.random()*math.tau
        co, si = math.cos(a), math.sin(a)
        phase, chip = rng.random()*math.tau, rng.random()*math.tau
        floor = rng.uniform(.04,.35)
        depth = radius/scale * rng.uniform(.16,.51) * (.66 if kind=='river' else 1.)
        limit = math.ceil(1.29*radius)
        for py in range(int(y)-limit, int(y)+limit+1):
            for px in range(int(x)-limit, int(x)+limit+1):
                dx, dy = px+.5-x, py+.5-y
                u, v = (dx*co+dy*si)/radius, (dy*co-dx*si)/(ratio*radius)
                d = math.hypot(u,v)
                if d>1.34:
                    continue
                t = math.atan2(v,u)
                d *= 1+.13*math.cos(3*t+phase)+.065*math.sin(5*t-chip)+.042*math.cos(8*t+phase)
                if pit:
                    s = clamp((d-floor)/(1-floor))
                    dish = -(1-s*s*(3-2*s)) * (.84 + .16*math.sin(t-chip)*clamp(d))
                    lip = .23*max(0.,1-abs(d-.98)/.28)**2 * clamp(.08+.94*math.cos(t-chip))
                    h = depth*(dish+lip)
                else:
                    h = depth*(max(0., 1-d**1.7)**1.42 - .11*max(0,1-abs(d-.93)/.19))
                height[(py%SIZE)*SIZE+px%SIZE] += h

    for _ in range(pit_count):
        scar(True)
    for _ in range(nodule_count):
        scar(False)

    def fracture(x, y, angle, length, width, depth, branch=True):
        # A continuous V-shaped cut, with changing aperture. Overlapping strokes
        # at a joint keep the deepest wall instead of excavating a dot at every joint.
        groove = {}
        n = max(4, round(length/2.8))
        turn = angle
        branch_start = None
        pinch=rng.uniform(.22,.70)
        for i in range(n):
            t=(i+.5)/n
            turn += .42*(angle-turn) + rng.uniform(-.55,.55)
            step=length/n*scale*rng.uniform(.84,1.14)
            dx,dy=math.cos(turn)*step, math.sin(turn)*step
            bridge=1-.76*max(0.,1-abs(t-pinch)/.15)
            width_px=max(.66, width*scale*(.18+.82*math.sin(math.pi*t)**.60)*rng.uniform(.88,1.12)*bridge)
            sink=depth*(.12+.88*math.sin(math.pi*t)**.72)*rng.uniform(.84,1.13)*bridge
            band=width_px*1.56
            for py in range(math.floor(min(y,y+dy)-band),math.ceil(max(y,y+dy)+band)+1):
                for px in range(math.floor(min(x,x+dx)-band),math.ceil(max(x,x+dx)+band)+1):
                    qx,qy=px+.5-x,py+.5-y
                    along=clamp((qx*dx+qy*dy)/(step*step))
                    d=math.hypot(qx-along*dx,qy-along*dy)/width_px
                    if d>=1.48:
                        continue
                    k=(py%SIZE)*SIZE+(px%SIZE)
                    cut=-sink*(max(0,1-d)**1.79)
                    lip=.10*sink*max(0,1-abs(d-1.)/.47)**2 if qx*dy-qy*dx>0 else 0
                    old=groove.get(k,0.)
                    groove[k] = min(old,cut) if cut<0 or old<0 else max(old,lip)
            x+=dx
            y+=dy
            if branch and i==n//2:
                branch_start=(x,y,turn+rng.choice([-1,1])*rng.uniform(.48,1.05))
        for k,h in groove.items():
            height[k] += h
        if branch_start:
            fracture(*branch_start,length*rng.uniform(.23,.48),width*.57,depth*.60,False)

    for _ in range(cracks):
        x,y=centre()
        direction = .4 + rng.uniform(-.4,.4) if kind=='slate' else rng.uniform(0,math.tau)
        length = rng.uniform(23,88) * (.65 if kind=='river' else 1.)
        width = rng.uniform(.27,.84) * (.75 if kind=='river' else 1.)
        fracture(x,y,direction,length,width,width*rng.uniform(.86,1.50))

    def encode(value):
        return round(clamp(.5 + value/(2*RANGE_MM))*255)

    # Bilinear low-pass displacement is exactly the one sampled by the mesh.
    cell = SIZE // COARSE
    low = bytearray(COARSE*COARSE)
    for y in range(COARSE):
        for x in range(COARSE):
            block = [height[(y*cell+j)*SIZE+x*cell+k] for j in range(cell) for k in range(cell)]
            low[y*COARSE+x] = encode(sum(block)/(cell*cell))
    def coarse(x, y):
        u, v = (x+.5)/cell-.5, (y+.5)/cell-.5
        ix, iy = math.floor(u),math.floor(v)
        fx, fy = u-ix,v-iy
        a,b,c,d=[low[(j%COARSE)*COARSE+i%COARSE] for i,j in ((ix,iy),(ix+1,iy),(ix,iy+1),(ix+1,iy+1))]
        return (((a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy)/255-.5)*(2*RANGE_MM)
    # Keep some broad slope for triangles too wide to sample every impact.
    fine = array('f',(height[i]-.68*coarse(i%SIZE,i//SIZE) for i in range(SIZE*SIZE)))
    pixels = bytearray(SIZE*SIZE*3)
    # Include a second, finer scale of the source rock's measured normals on the
    # walls of the cuts. Flat, constant slopes look like knife strokes in grazing light.
    scan_size=round(math.sqrt(len(scan_normal)/3))
    strength={'dragon':.53,'slate':.27,'river':.14}[kind]
    for i,h in enumerate(height):
        x,y=i%SIZE,i//SIZE
        dx=(fine[y*SIZE+(x-1)%SIZE]-fine[y*SIZE+(x+1)%SIZE])*scale*.5
        dy=(fine[((y-1)%SIZE)*SIZE+x]-fine[((y+1)%SIZE)*SIZE+x])*scale*.5
        j = 3*((int(y*scan_size/SIZE*2.0+284)%scan_size)*scan_size + int(x*scan_size/SIZE*2.0+397)%scan_size)
        nx,ny,nz=scan_normal[j:j+3]
        local_strength=strength*(.69+.42*min(1.,abs(h)))
        dx+=local_strength*(nx-128)/max(46,nz-128)
        dy+=local_strength*(ny-128)/max(46,nz-128)
        pixels[3*i] = encode(h)
        pixels[3*i+1] = 2*round(clamp(.5+dx/4.)*127)
        pixels[3*i+2] = 2*round(clamp(.5+dy/4.)*127)
    # Lossless here preserves submillimetre grooves and avoids JPEG block normals.
    encoded=ffmpeg("-f","rawvideo","-pixel_format","rgb24","-video_size",f"{SIZE}x{SIZE}",
                   "-i","-","-frames:v","1","-c:v","png","-f","image2pipe","-",data=pixels)
    return {"period":period/1000, "coarseSize":COARSE, "range":RANGE_MM/1000,
            "coarse":b64encode(low).decode(), "map":b64encode(encoded).decode()}
