(function () {
  'use strict';

  // A handful of exposed fragments sit above the continuous, relief-mapped bed.
  // Each section changes shape with height, so chips have a fracture face and
  // compressed flakes have a thin, uneven rim even when seen in silhouette.
  function grainGeometry(form) {
    const sides = [9, 7, 6, 9][form];
    const rings = [[-.95,.34],[-.57,.83],[.06,1],[.64,.77],[.91,.35]];
    const capHeight = form === 2 ? .64 : 1;
    const positions = [0,-capHeight,0], colors = [.69,.66,.64], indices = [];
    for (const [h, radius] of rings) {
      for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides + .071 * Math.sin(i * 5.7 + form);
        const edge = 1 + .13 * Math.sin(3*a+.67*form) + .052 * Math.cos(5*a+2.1*h);
        let x = radius * edge * Math.cos(a);
        let z = radius * edge * Math.sin(a);
        let y = h + .10 * x - .055 * z + .046 * Math.sin(2*a+.8) * radius;
        let shade = .92 + .08 * h + .036 * Math.sin(3*a+form+h);
        if (form === 1) { // A split clod, with a lighter slanted fracture.
          const cut = .41 - .30*z + .23*h;
          if (x > cut) { x = cut; shade += .17; }
        } else if (form === 2) { // Cleaved mineral flake, broken at one end.
          y *= .64;
          z = Math.min(z, .46+.29*x-.11*h);
          x += .18 * h;
        } else if (form === 3) { // Two partially fused lobes, pinched at the waist.
          const waist = Math.exp(-16*(x+.09)*(x+.09));
          z *= 1-.36*waist;
          y = y * (1-.22*waist) + .14*x;
          x *= 1.10;
        }
        positions.push(x,y,z);
        colors.push(shade, shade*.993, shade*.982);
      }
    }
    const top = positions.length/3;
    positions.push(.14,.96*capHeight,-.10);
    colors.push(1.03,1.01,.98);
    for(let i=0;i<sides;i++) {
      const j=(i+1)%sides;
      indices.push(0,1+i,1+j);
      for(let row=0;row<rings.length-1;row++) {
        const a=1+row*sides+i, b=1+row*sides+j;
        indices.push(a,a+sides,b, b,a+sides,b+sides);
      }
      indices.push(top,1+(rings.length-1)*sides+j,1+(rings.length-1)*sides+i);
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    indexed.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
    indexed.setIndex(indices);
    indexed.computeVertexNormals();
    const geometry = indexed.toNonIndexed();
    const normals = geometry.attributes.normal;
    const smooth = normals.clone(), a = new THREE.Vector3(), b = new THREE.Vector3();
    geometry.computeVertexNormals();
    const rounding = [.85,.35,.18,.62][form];
    for(let i=0;i<normals.count;i++) {
      a.fromBufferAttribute(normals,i).lerp(b.fromBufferAttribute(smooth,i),rounding).normalize();
      normals.setXYZ(i,a.x,a.y,a.z);
    }
    indexed.dispose();
    return geometry;
  }

  const originalMixture = [.56,.24,.17,.03];

  window.createAquariumLooseGrains = function (surface, bounds, maxHeight) {
    const group = new THREE.Group();
    group.name = 'AquariumSandGrains';
    const relief = { value: 0 };
    const material = new THREE.MeshStandardMaterial({ roughness: .83, vertexColors: true });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSandGrainRelief = relief;
      shader.vertexShader = 'uniform float uSandGrainRelief;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= uSandGrainRelief;',
      );
    };
    const width = bounds.maxX-bounds.minX, depth = bounds.maxZ-bounds.minZ;
    const total = Math.max(16, Math.round(width*depth*6800));
    const forms = Array.from({length:4}, (_, form) => {
      const capacity = Math.ceil(total*originalMixture[form]);
      const mesh = new THREE.InstancedMesh(grainGeometry(form), material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.receiveShadow = true;
      mesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3((bounds.minX+bounds.maxX)/2,maxHeight/2,(bounds.minZ+bounds.maxZ)/2),
        Math.hypot(width/2,depth/2,maxHeight/2)+.005);
      mesh.name = ['WornGrains','SplitFragments','MineralFlakes','AggregateClods'][form];
      group.add(mesh);
      return { mesh, offsets: new Float32Array(capacity) };
    });
    const sampleColor = new THREE.Color(), transform = new THREE.Object3D();
    let procedural = true;
    function setSurface(next) {
      procedural = next.type === 'original';
      group.visible = procedural && relief.value > 0;
      if (!procedural) return;
      const {palette, flatten, relief: size} = next;
      let seed = 41891;
      function random() {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return seed / 4294967296;
      }
      for (const [form, {mesh, offsets}] of forms.entries()) {
        mesh.count = Math.round(total*originalMixture[form]);
        let clusterX, clusterZ;
        for(let i=0;i<mesh.count;i++) {
          let x = bounds.minX + random()*width, z = bounds.minZ + random()*depth;
          if (i%7===0) { clusterX=x; clusterZ=z; }
          else if (i%7 <= 2) {
            x = clusterX + (random()-.5)*.013;
            z = clusterZ + (random()-.5)*.010;
          }
          const pick = random();
          const radius = size * (.00045 + .00147 * random() ** 1.85) * (pick > .96 ? 1.60 : 1);
          const length = radius * (form===2 ? 1.34 : 1.0);
          const maxReach = 1.65*length;
          x = THREE.MathUtils.clamp(x,bounds.minX+maxReach,bounds.maxX-maxReach);
          z = THREE.MathUtils.clamp(z,bounds.minZ+maxReach,bounds.maxZ-maxReach);
          const elevation = radius * flatten * (.65+.55*random());
          const mineral = palette[Math.floor(random()*palette.length)];
          sampleColor.copy(mineral).multiplyScalar(.85 + .24 * random());
          offsets[i] = -elevation*(.12+.54*random());
          transform.position.set(x,0,z);
          transform.rotation.set((random()-.5)*.46, random()*Math.PI*2, (random()-.5)*.66, 'YXZ');
          transform.scale.set(length,elevation,radius*(.49+.52*random()));
          transform.updateMatrix();
          mesh.setMatrixAt(i,transform.matrix);
          mesh.setColorAt(i,sampleColor);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    function syncHeights(heightAt) {
      for(const {mesh, offsets} of forms) {
        const m=mesh.instanceMatrix.array;
        for(let i=0;i<mesh.count;i++) {
          const j=i*16;
          m[j+13] = heightAt(m[j+12],m[j+14]) + offsets[i];
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    function updateView(radius) {
      relief.value = 1 - THREE.MathUtils.smoothstep(radius,1.48,2.18);
      group.visible = procedural && relief.value>0;
    }
    setSurface(surface);
    updateView(Infinity);
    return { mesh:group, material, setSurface, syncHeights, updateView };
  };

  // Tesselate the visible skin independently of the editable simulation grid. Each
  // fine point uses the exact same b–d diagonal as the raycast and sand solver.
  window.createAquariumScannedBed = function (base, initialSurface, updateRelief) {
    const {width, height, widthSegments: nx, heightSegments: nz} = base.geometry.parameters;
    const source = base.geometry.attributes;
    const subdivision = 4;
    const columns = nx*subdivision+1, rows = nz*subdivision+1;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), base.material);
    mesh.name = 'AquariumRegisteredBedDetail';
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    let surface = initialSurface, strength = 0, active = false, dirty = true;
    let baseIndices, baseWeights;

    function prepare() {
      const g = new THREE.PlaneGeometry(width, height, columns-1, rows-1);
      g.rotateX(-Math.PI/2);
      const {position, normal, uv} = g.attributes;
      const count = position.count;
      const shade = new Float32Array(count*3), outline = new Float32Array(count);
      baseIndices = new Uint32Array(count*3);
      baseWeights = new Float32Array(count*3);
      for(let r=0;r<rows;r++) for(let c=0;c<columns;c++) {
        const i = r*columns+c;
        const cellX = Math.min(Math.floor(c/subdivision), nx-1);
        const cellZ = Math.min(Math.floor(r/subdivision), nz-1);
        const u = c/subdivision-cellX, v = r/subdivision-cellZ;
        const a = cellZ*(nx+1)+cellX, b = a+nx+1, d = a+1, e = b+1;
        if (u+v<=1) {
          baseIndices.set([a,b,d],3*i);
          baseWeights.set([1-u-v,v,u],3*i);
        } else {
          baseIndices.set([b,e,d],3*i);
          baseWeights.set([1-u,u+v-1,1-v],3*i);
        }
        let uu=0, vv=0, tone=0;
        for(let j=3*i;j<3*i+3;j++) {
          const k=baseIndices[j], weight=baseWeights[j];
          uu+=source.uv.getX(k)*weight;
          vv+=source.uv.getY(k)*weight;
          tone+=source.color.getX(k)*weight;
        }
        uv.setXY(i,uu,vv);
        shade[3*i]=shade[3*i+1]=shade[3*i+2]=tone;
        // Keep the physical seam where the sand meets its four glass-facing edges.
        outline[i] = Math.min(1,r,c,rows-r-1,columns-c-1);
      }
      g.setAttribute('color',new THREE.BufferAttribute(shade,3));
      g.setAttribute('bedSurfaceWeight',new THREE.BufferAttribute(outline,1));
      position.setUsage(THREE.DynamicDrawUsage);
      normal.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.dispose();
      mesh.geometry=g;
    }

    function syncHeights() {
      if (!active) { dirty=true; return; }
      if (!baseIndices) prepare();
      const {position,normal}=mesh.geometry.attributes;
      const heights=source.position.array, normals=source.normal.array;
      for(let i=0;i<position.count;i++) {
        let y=0,xn=0,yn=0,zn=0;
        for(let j=3*i;j<3*i+3;j++) {
          const k=baseIndices[j]*3, weight=baseWeights[j];
          y+=heights[k+1]*weight;
          xn+=normals[k]*weight; yn+=normals[k+1]*weight; zn+=normals[k+2]*weight;
        }
        position.setY(i,y); normal.setXYZ(i,xn,yn,zn);
      }
      position.needsUpdate=true; normal.needsUpdate=true;
      dirty=false;
    }
    function update() {
      active=surface.type!=='original' && strength>0;
      if (active && dirty) syncHeights();
      mesh.visible=active;
      base.visible=!active;
      updateRelief(surface,active?strength:0);
    }
    return { mesh, syncHeights,
      setSurface(next) { surface=next; update(); },
      updateView(radius) { strength=1-THREE.MathUtils.smoothstep(radius,1.48,2.00); update(); },
    };
  };
})();
