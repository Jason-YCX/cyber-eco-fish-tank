(function () {
  'use strict';

  // All dimensions are fractions of total length. Nose points along +Z, belly toward -Y.
  const anatomy = {
    guppy: { name:'AquariumGuppy', length:.046, height:.023, speed:.063 },
    pandaCory: { name:'AquariumPandaCory', length:.052, height:.022, speed:.039 },
    otocinclus: { name:'AquariumOtocinclus', length:.043, height:.011, speed:.041 },
  };
  for (const [species, data] of Object.entries(anatomy)) {
    Object.assign(data, window.AQUARIUM_FISH_PHOTOS[species].profile);
  }

  const { clamp, lerp, smoothstep } = THREE.MathUtils;

  function decodePhoto(source) {
    const ids = atob(source.index);
    const colors = atob(source.palette);
    const rgb = new Uint8Array(ids.length * 3);
    for (let i = 0; i < ids.length; i++) {
      const base = 3 * ids.charCodeAt(i);
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = colors.charCodeAt(base + c);
    }
    return rgb;
  }

  function texture(data, width, height, colorSpace = THREE.NoColorSpace) {
    const map = new THREE.DataTexture(data, width, height);
    map.colorSpace = colorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 4;
    map.needsUpdate = true;
    return map;
  }

  const skinSurfaces = new Map();

  function cellNoise(row, column, salt) {
    let n = Math.imul(row + 19, 1597334677) ^ Math.imul(column + salt + 137, 3812015801);
    n = Math.imul(n ^ (n >>> 15), 2246822519);
    return ((n ^ (n >>> 13)) >>> 0) / 4294967296;
  }

  // Height is measured in body-length units. A 0.002-high free margin on a
  // 46 mm fish is 92 microns; the normal is derived from the actual mm per UV.
  function buildSkinSurface(species, rings) {
    const width = 896, height = 256;
    const heights = new Float32Array(width * height);
    const polish = new Float32Array(heights.length);
    const occlusion = new Float32Array(heights.length);
    const guppy = species === 'guppy', panda = species === 'pandaCory';
    const columns = guppy ? 30 : 33;
    const rows = guppy ? 8 : panda ? 2 : 4;
    const spacingX = 1 / columns, spacingY = .9 / rows;
    for (let row = 0; row < rows; row++) {
      // Holotype BMNH 1969.7.15.8: 23 dorsal and 20 ventral scutes.
      const rowSpacing = panda ? .73 / (row ? 23 : 20) : spacingX;
      const rowCenter = .05 + spacingY * (row + .5);
      for (let column = 0; column <= Math.ceil(.83/rowSpacing); column++) {
        const seed = cellNoise(row, column, 0);
        const uCenter = rowSpacing * (column + (row % 2) * (guppy ? .5 : .22)
          + .17 * (seed - .5) + .22 * Math.sin(column*.54 + row*.91));
        if (uCenter > .83) continue;
        const vCenter = rowCenter + .022 * Math.sin(5.5 * uCenter + .32 * row)
          + spacingY * .11 * (cellNoise(row, column, 3) - .5);
        const spanY = spacingY * (guppy ? .73 : .58) * (.94 + .12 * cellNoise(row,column,7));
        const nick = seed > .939, nickAt = cellNoise(row,column,8) * 1.32 - .66;
        const exposure = (.70 + .44 * seed) * (guppy ? .00265 : panda ? .00165 : .00155);
        const minY = Math.max(0, Math.floor((vCenter-spanY)*height));
        const maxY = Math.min(height-1, Math.ceil((vCenter+spanY)*height));
        const minX = Math.max(0, Math.floor((uCenter-.96*rowSpacing)*width));
        const maxX = Math.min(width-1, Math.ceil((uCenter+1.3*rowSpacing)*width));
        for (let y = minY; y <= maxY; y++) {
          const v = (y + .5) / height;
          const t = (v-vCenter) / spanY;
          if (Math.abs(t) >= 1) continue;
          const blend = 1 - smoothstep(Math.abs(t), guppy ? .67 : .84, 1);
          const tip = guppy ? -.65 + (.66+.12*seed)*t*t :
            -.51 + (.22+.17*seed)*t*t + (row%2 ? -.38 : .42)*t
              + .085*Math.sin(t*4.4 + column*.5 + row);
          const edge = tip + .018*Math.sin(t*16 + seed*4) +
            (nick ? .12 * (1-smoothstep(Math.abs(t-nickAt),.025,.17)) : 0);
          for (let x = minX; x <= maxX; x++) {
            const u = (x+.5)/width;
            const d = (u-uCenter)/rowSpacing - edge;
            if (d < -.21 || d > 1.15) continue;
            // Fins, the operculum and the ventral skin break up the plated area.
            const mask = smoothstep(u,.015,.095) * (1-smoothstep(u,.65,.76))
              * smoothstep(v, guppy ? .035 : .055, guppy ? .16 : .23) * (1-smoothstep(v,.90,.985));
            const ventral = guppy ? 1 : .45 + .55*smoothstep(v,.12,.54);
            const wornEdge = .84 + .16 * Math.sin(t*4.1 + seed*7.8);
            const weight = blend * mask * ventral;
            const i = y*width+x;
            const seam = 1-smoothstep(Math.abs(d+.060),.012,.11);
            occlusion[i] = Math.max(occlusion[i], weight*seam*(nick ? .72 : 1));
            if (d < -.045) continue;
            const face = smoothstep(d,-.045,guppy?.09:.15) * (1-smoothstep(d,.11,1.06));
            const lip = smoothstep(d,-.02,.10) * (1-smoothstep(d,.13,guppy?.28:.39));
            const striae = guppy ? .038*Math.cos((d+.23*t*t)*31) :
              .080*Math.cos((Math.abs(t)+.13*d)*17 + seed*3);
            const keel = !guppy && !panda ? .17*(1-smoothstep(Math.abs(t+.10*d),.1,.38)) : 0;
            const h = weight*exposure*(face*(.67+striae+keel) + .34*lip*wornEdge);
            if (h <= heights[i]) continue;
            heights[i]=h;
            polish[i]=weight*(.35*face+.65*lip*wornEdge) * (nick ? .65 : 1);
          }
        }
      }
    }

    // The operculum sweeps around the gill opening ahead of the scale rows;
    // its border is a single soft groove. Leave the snout, eye, and belly smooth.
    for (let y=0; y<height; y++) {
      const v=(y+.5)/height;
      const extent=smoothstep(v,.17,.38)*(1-smoothstep(v,.78,.90));
      const curve=(guppy?.764:panda?.736:.706) + .14*(v-.51)**2 + .026*(v-.5);
      for(let x=Math.floor((curve-.032)*width);x<=Math.ceil((curve+.030)*width);x++) {
        const d=(x+.5)/width-curve, i=y*width+x;
        const seam=1-smoothstep(Math.abs(d),.0008,.0050);
        const cover=smoothstep(d,-.0035,.0035)*(1-smoothstep(d,.005,.021));
        heights[i]+=extent*(.00053*cover-.00028*seam);
        occlusion[i]=Math.max(occlusion[i],extent*seam*.51);
      }
    }

    const stride = rings.at(-1)[0] - rings[0][0];
    const normals = new Uint8Array(heights.length*4);
    const finish = new Uint8Array(normals.length);
    let section = 0;
    for (let x=0; x<width; x++) {
      const u=(x+.5)/width, z=rings[0][0]+u*stride;
      while(section+2<rings.length && z>rings[section+1][0]) section++;
      const a=rings[section], b=rings[section+1], mix=(z-a[0])/(b[0]-a[0]);
      const depth=lerp(a[1],b[1],mix), breadth=lerp(a[2]-a[3],b[2]-b[3],mix);
      for(let y=0;y<height;y++) {
        const v=(y+.5)/height, i=y*width+x, j=i*4;
        const vx=2*v-1;
        // UV v follows vertical height. Use the skin arc length at this latitude.
        const meridian=Math.hypot(breadth, 2*depth*vx/Math.sqrt(Math.max(.028,1-vx*vx)));
        const du=(heights[y*width+Math.min(x+1,width-1)]-heights[y*width+Math.max(0,x-1)])*width/(2*stride);
        const dv=(heights[Math.min(height-1,y+1)*width+x]-heights[Math.max(0,y-1)*width+x])*height/(2*meridian);
        const nz=1/Math.hypot(du,dv,1);
        normals[j]=Math.round(127.5*(1-du*nz));
        normals[j+1]=Math.round(127.5*(1-dv*nz));
        normals[j+2]=Math.round(127.5*(1+nz)); normals[j+3]=255;
        finish[j]=255;
        finish[j+1]=Math.round(255*clamp((guppy?.47:panda?.56:.52)-polish[i]*(guppy?.19:.145)+occlusion[i]*.10,.28,.7));
        finish[j+2]=0; finish[j+3]=255;
      }
    }
    return { width, height, heights, polish, occlusion,
      normalMap:texture(normals,width,height), roughnessMap:texture(finish,width,height) };
  }

  function skinMaterial(species, photoSet, layers) {
    const photo = photoSet.body;
    const { width, height } = photo;
    const source = decodePhoto(photo);
    const color = new Uint8ClampedArray(width*height*4);
    const guppy = species === 'guppy';
    for (let y=0;y<height;y++) {
      for (let x=0;x<width;x++) {
        const i=y*width+x, j=4*i;
        let r=source[3*i],g=source[3*i+1],b=source[3*i+2];
        const k=Math.floor((y+.5)*layers.height/height)*layers.width+
          Math.floor((x+.5)*layers.width/width);
        // Shallow inter-plate occlusion survives diffuse tank lighting. Most contrast comes from the moving normal.
        const shade=1-(guppy?.124:.092)*layers.occlusion[k];
        const pearl=guppy ? 5.8*layers.polish[k] : 2.3*layers.polish[k];
        color[j]=r*shade+pearl; color[j+1]=g*shade+pearl; color[j+2]=b*shade+pearl; color[j+3]=255;
      }
    }
    return new THREE.MeshPhysicalMaterial({
      map:texture(new Uint8Array(color.buffer),width,height,THREE.SRGBColorSpace),
      normalMap:layers.normalMap,normalScale:new THREE.Vector2(1.22,1.22),roughnessMap:layers.roughnessMap,roughness:1,metalness:0,
      clearcoat:.10,clearcoatRoughness:.36,iridescence:guppy?.13:0,iridescenceIOR:1.28,
    });
  }

  function finMaterial(species, kind, photoSet) {
    const photo = photoSet[kind];
    const source = photo && decodePhoto(photo);
    const paleLace = photoSet === window.AQUARIUM_FISH_PHOTOS.guppyLace;
    const width = photo?.width ?? 192, height = photo?.height ?? 96;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const guppy = species === 'guppy';
    for (let y = 0; y < height; y++) {
      const reach = (y+.5)/height;
      const branches = smoothstep(reach, .42, .96);
      for (let x = 0; x < width; x++) {
        const p = (x+.5)/width;
        const i = y*width+x;
        const rayCount = kind === 'tail' ? 15 : 8;
        const spoke = rayCount*p + .15*Math.sin(p*15+reach*3) + .095*Math.sin(p*41);
        const dist = Math.abs(spoke - Math.round(spoke));
        const midRay = 1 - smoothstep(dist, .020, .086);
        const split = 1 - smoothstep(Math.abs(dist - .28*branches), .010, .055);
        const rays = Math.max(midRay*(1-.3*branches), split*.68*branches);
        let r=180,g=176,b=145,alpha=.18 + .60*rays;
        if (source) {
          r=source[i*3]; g=source[i*3+1]; b=source[i*3+2];
          if (paleLace) {
            // The pale tail was photographed over grey gravel. Its dark marginal
            // spots and green iridescent rays stay opaque as the membrane clears.
            const pigment = 1-smoothstep(.25*r+.60*g+.15*b,77,158);
            const iridescent = smoothstep(g-b,12,49);
            alpha = (.17+.67*pigment+.36*iridescent+.13*rays)*(1-.18*smoothstep(reach,.84,1));
          } else if (guppy) {
            // A blue tank background is visible through the clear outer margin in the photograph.
            const clear = smoothstep(b - Math.max(r,g), 6, 60);
            r=lerp(r,168,clear); g=lerp(g,172,clear); b=lerp(b,161,clear);
            alpha = .88-.62*clear+.09*rays;
          } else {
            const ink = 1 - smoothstep((r*.24+g*.63+b*.13)/255, .14, .68);
            const greenBackdrop = smoothstep(g-Math.max(r,b), 3, 60);
            r=lerp(181,50,ink); g=lerp(175,46,ink); b=lerp(143,39,ink);
            alpha=.27+.54*ink+.16*rays-.15*greenBackdrop;
          }
        }
        if (kind === 'tail') {
          const rootBlend = (1-smoothstep(reach,0,.27)) * .78;
          const neutral = guppy ? [132,103,59] : species === 'pandaCory' ? [133,119,94] : [99,89,66];
          r=lerp(r,neutral[0],rootBlend); g=lerp(g,neutral[1],rootBlend); b=lerp(b,neutral[2],rootBlend);
          alpha=lerp(alpha,.92,rootBlend);
        }
        const rayPigment = source ? rays*.12 : rays*.32;
        pixels[4*i]=lerp(r,218,rayPigment);
        pixels[4*i+1]=lerp(g,210,rayPigment);
        pixels[4*i+2]=lerp(b,174,rayPigment);
        pixels[4*i+3]=255*clamp(alpha, .09, .98);
      }
    }
    return new THREE.MeshStandardMaterial({
      map:texture(new Uint8Array(pixels.buffer),width,height,THREE.SRGBColorSpace),
      roughness:.47, side:THREE.DoubleSide, transparent:true, depthWrite:false, forceSinglePass:true,
    });
  }

  function eyeSurface(photoSet) {
    const image = photoSet.eye;
    const raw = decodePhoto(image);
    const pixels = new Uint8Array(image.width * image.height * 4);
    for (let i = 0; i < raw.length / 3; i++) {
      const nx = 2 * ((i % image.width) + .5) / image.width - 1;
      const ny = 2 * (Math.floor(i / image.width) + .5) / image.height - 1;
      const edge = smoothstep(Math.hypot(nx,ny), .90, 1);
      for (let c=0; c<3; c++) pixels[4*i+c] = lerp(raw[3*i+c], 24, .60*edge);
      pixels[4*i+3] = 255;
    }
    const geometry=new THREE.SphereGeometry(1,28,16);
    const {position, uv}=geometry.attributes;
    for(let i=0;i<uv.count;i++) uv.setXY(i,(position.getX(i)+1)/2,(position.getY(i)+1)/2);
    const material=new THREE.MeshPhysicalMaterial({
      map:texture(pixels,image.width,image.height,THREE.SRGBColorSpace), roughness:.24,
      clearcoat:.6,clearcoatRoughness:.14,
    });
    return {geometry,material};
  }

  function bodyGeometry(rings, layers) {
    const vertices = [], uvs = [], indices = [];
    const sides = 64;
    // A short taper is embedded in the caudal fin so the trunk ends in a flexible root.
    const [tail, halfWidth, upper, lower] = rings[0];
    const profile = [[tail-.008, halfWidth*.08, upper*.59, lower*.59],
      [tail-.004, halfWidth*.49, upper*.80, lower*.77], ...rings];
    // Interpolate each outline with a monotone cubic to round the head and avoid a kink at each ring.
    const sections=[];
    for (let k=0;k<profile.length-1;k++) {
      const a=profile[k], b=profile[k+1], prev=profile[Math.max(0,k-1)], next=profile[Math.min(profile.length-1,k+2)];
      const dz=b[0]-a[0];
      const steps = Math.max(3, Math.ceil(dz * 180));
      for (let n=0;n<steps;n++) {
        const t=n/steps, section=[a[0]+t*dz];
        for (let c=1;c<4;c++) {
          const delta=b[c]-a[c];
          let da=(b[c]-prev[c])*dz/(b[0]-prev[0]), db=(next[c]-a[c])*dz/(next[0]-a[0]);
          da=delta ? delta*clamp(da/delta,0,2) : 0;
          db=delta ? delta*clamp(db/delta,0,2) : 0;
          section.push(lerp(a[c],b[c],t*t*(3-2*t)) + t*(1-t)*((1-t)*da-t*db));
        }
        sections.push(section);
      }
    }
    sections.push(profile.at(-1));
    const length = rings[rings.length-1][0] - tail;
    for (const [k, [z, radius, top, bottom]] of sections.entries()) {
      for (let i = 0; i < sides; i++) {
        const angle = i * Math.PI * 2 / sides;
        const v = (1 + Math.sin(angle)) * .5;
        const u = Math.max(0,(z-tail)/length);
        const ix = Math.min(layers.width-1,Math.floor(u*layers.width));
        const iy = Math.min(layers.height-1,Math.floor(v*layers.height));
        // A low physical component also changes the grazing silhouette. The tangential
        // normal map resolves sharper lips between these vertices.
        const relief=.28*layers.heights[iy*layers.width+ix];
        vertices.push((radius+relief)*Math.cos(angle),lerp(bottom,top,v)+relief*Math.sin(angle),z);
        uvs.push(u,v);
        const a = k * sides + i, b = k * sides + (i + 1) % sides;
        if (k < sections.length - 1) indices.push(a, b, a + sides, b, b + sides, a + sides);
        if (i > 0 && i < sides - 1) {
          if (k === 0) indices.push(0, a + 1, a);
          if (k === sections.length - 1) indices.push(k * sides, a, a + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function fin(kind, side, root, edge, material) {
    const positions=[], uvs=[], flex=[], indices=[];
    const spokes=(edge.length-1)*4+1, bands=10;
    const caudal=kind==='caudal';
    for(let row=0;row<=bands;row++) {
      const reach=row/bands;
      for(let i=0;i<spokes;i++) {
        const segment=Math.min(Math.floor(i/4),edge.length-2);
        const t=i/4-segment, p=i/(spokes-1);
        const end=edge[segment].map((value,axis)=>lerp(value,edge[segment+1][axis],t));
        const ripple=!side ? .004*(Math.sin(16*p+1.3*reach)+.38*Math.sin(47*p))*reach**1.6 : 0;
        positions.push(lerp(root[0],end[0],reach)+ripple,
          lerp(root[1]+(caudal ? .026*(2*p-1) : 0),end[1],reach),
          lerp(root[2]+(caudal ? 0 : .010*Math.sin(p*Math.PI)),end[2],reach));
        uvs.push(p,reach);
        flex.push(reach);
        if(row && i+1<spokes) {
          const a=row*spokes+i;
          indices.push(a-spokes,a,a-spokes+1,a,a+1,a-spokes+1);
        }
      }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setAttribute('finFlex',new THREE.Float32BufferAttribute(flex,1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name='AquariumFish'+kind;
    mesh.userData={kind,side};
    return mesh;
  }

  function makeTemplate(species, variant, prepareSwim) {
    const key = species==='guppy' && variant ? 'guppyLace' : species;
    const photoSet = window.AQUARIUM_FISH_PHOTOS[key];
    const data = photoSet.profile;
    if (!skinSurfaces.has(key)) skinSurfaces.set(key,buildSkinSurface(species,data.rings));
    const layers = skinSurfaces.get(key);
    const body = new THREE.Mesh(bodyGeometry(data.rings,layers), skinMaterial(species,photoSet,layers));
    const tailMaterial = finMaterial(species, 'tail', photoSet);
    const dorsalMaterial = finMaterial(species, 'dorsal', photoSet);
    const membrane = finMaterial(species, 'membrane', photoSet);
    body.name = 'AquariumFishBody';
    body.receiveShadow = true;
    const guppy = species === 'guppy', panda = species === 'pandaCory';
    // The fan and dorsal margins are the traced edges of the same photographed
    // individual as the trunk. The UV edge stations match the baked photo rays.
    const midFin = (name, points, material) => fin(name, 0, [0,...points.root],
      points.edge.map(([y,z]) => [0,y,z]), material);
    const parts = [body, midFin('caudal', data.tail, tailMaterial),
      midFin('dorsal', data.dorsal, dorsalMaterial)];
    const anal = guppy ? {root:[-.047,.074],edge:[[-.048,.112],[-.071,.017],[-.067,-.026],[-.051,-.067]]} :
      {root:[-.052,-.12],edge:[[-.051,-.08],[-.092,-.177],[-.085,-.225],[-.046,-.184]]};
    parts.push(midFin('anal', anal, membrane));
    if (panda) parts.push(midFin('adipose',
      {root:[.125,-.06],edge:[[.117,-.027],[.143,-.081],[.135,-.101],[.105,-.09]]},membrane));
    const fixed = [];
    const eye = eyeSurface(photoSet);
    const skin = new THREE.MeshStandardMaterial({
      color:panda ? '#ba9e83' : '#bbad86',roughness:.58,
    });
    for (const s of [-1,1]) {
      const [ey,ez] = data.eye, r = data.eyeSize;
      const row = data.rings.findIndex((ring)=>ring[0]>=ez);
      const a=data.rings[row-1], b=data.rings[row];
      const t=(ez-a[0])/(b[0]-a[0]);
      const width=lerp(a[1],b[1],t), top=lerp(a[2],b[2],t), bottom=lerp(a[3],b[3],t);
      const yn=(ey-(top+bottom)*.5)/((top-bottom)*.5);
      const ex=width*Math.sqrt(Math.max(0,1-yn*yn));
      const normal = new THREE.Vector3(s,.50*yn,-(b[1]-a[1])/(b[0]-a[0])).normalize();
      const globe = new THREE.Mesh(eye.geometry,eye.material);
      globe.name='Eye';
      globe.scale.set(r,r*.94,r*.42);
      globe.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
      globe.position.set(s*ex,ey,ez).addScaledVector(normal,-.12*r);
      fixed.push(globe);
      const pelvic = data.paired;
      const attachment = guppy ? .023 : panda ? .080 : .071;
      parts.push(fin('pelvic', s, [s*attachment,...pelvic.root],
        pelvic.edge.map(([y,z],i) => [s*(attachment+.043*Math.sin(i*Math.PI/(pelvic.edge.length-1))),y,z]),
        membrane));
      const px = guppy ? .044 : panda ? .093 : .069;
      const py = guppy ? -.015 : panda ? -.040 : -.030;
      const pz = guppy ? .22 : panda ? .18 : .22;
      parts.push(fin('pectoral', s, [s*px,py,pz], [
        [s*px,py+.020,pz+.013], [s*(px+.085),py+.003,pz-.030],
        [s*(px+.102),py-.016,pz-.076],[s*(px+.044),py-.022,pz-.096],[s*px,py-.011,pz-.041],
      ], membrane));
      if (panda) {
        for (const [outer, length] of [[.038,.080],[.020,.065]]) {
          const path = new THREE.CatmullRomCurve3([
            new THREE.Vector3(s*outer,-.057,.453), new THREE.Vector3(s*(outer+.009),-.072,.478),
            new THREE.Vector3(s*(outer+.80*length),-.092,.493-(outer>.03?.023:0)),
          ]);
          const tube = new THREE.TubeGeometry(path, 9, .0038, 5, false);
          const ring = tube.attributes.position;
          const point = new THREE.Vector3(), center = new THREE.Vector3();
          for(let i=0;i<ring.count;i++) {
            const t=Math.floor(i/6)/9;
            path.getPointAt(t,center);
            point.fromBufferAttribute(ring,i).sub(center).multiplyScalar(1-.84*t).add(center);
            ring.setXYZ(i,point.x,point.y,point.z);
          }
          const barbel = new THREE.Mesh(tube, skin);
          barbel.name = 'Barbel';
          fixed.push(barbel);
        }
      }
    }
    if (species === 'otocinclus') {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(.030,.006,8,24), skin);
      lip.name = 'SuckerLip';
      lip.rotation.x = Math.PI/2;
      lip.scale.set(1,.74,1);
      lip.position.set(0,-.042,.421);
      fixed.push(lip);
    }
    return { animated: parts.map(prepareSwim), fixed };
  }

  window.aquariumFishSpecies = { anatomy, makeTemplate };
})();
