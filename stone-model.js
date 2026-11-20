(function () {
  'use strict';

  function unpack(encoded, Type) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
  }

  function makeGeometry({ positions, normals, uvs, indices }) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(unpack(positions, Float32Array), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(unpack(normals, Float32Array), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(unpack(uvs, Float32Array), 2));
    geometry.setIndex(new THREE.BufferAttribute(unpack(indices, Uint16Array), 1));
    return geometry;
  }

  const mineralNoiseShader = /* glsl */ `
    varying vec3 vStonePosition;

    float mineralHash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.12, 0.26, 0.43));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float mineralNoise(vec3 p) {
      vec3 i = floor(p);
      vec3 w = fract(p);
      w = w * w * (3.0 - 2.0 * w);
      return mix(
        mix(mix(mineralHash(i), mineralHash(i + vec3(1, 0, 0)), w.x),
            mix(mineralHash(i + vec3(0, 1, 0)), mineralHash(i + vec3(1, 1, 0)), w.x), w.y),
        mix(mix(mineralHash(i + vec3(0, 0, 1)), mineralHash(i + vec3(1, 0, 1)), w.x),
            mix(mineralHash(i + vec3(0, 1, 1)), mineralHash(i + vec3(1, 1, 1)), w.x), w.y),
        w.z);
    }

  `;

  const minerals = mineralNoiseShader + /* glsl */ `
    float veinCoverage(float distance, float width) {
      float filterWidth = max(0.00025, fwidth(distance));
      return 1.0 - smoothstep(max(0.0, width - filterWidth), width + filterWidth, abs(distance));
    }

    vec3 stoneAlbedo(vec3 photo) {
      float luma = dot(photo, vec3(0.2126, 0.7152, 0.0722));
      vec3 rock = mix(photo, luma * vec3(0.83, 0.98, 1.06), 0.85) * 0.92 + vec3(0.024, 0.030, 0.033);

      vec3 p = vStonePosition;
      float mottling = mineralNoise(p * 50.0);
      float grain = mineralNoise(p * 185.0);
      float warp = 0.009 * (mottling - 0.5) + 0.004 * (grain - 0.5);
      float layer = p.y + 0.46 * p.x - 0.20 * p.z + warp;
      float width = mix(0.00080, 0.00295, smoothstep(0.18, 0.83, mottling));
      float seam = veinCoverage(layer - 0.020, width)
        * mix(0.36, 0.95, smoothstep(0.18, 0.66, grain));
      float branch = veinCoverage(layer - 0.002 - 0.31 * p.x, 0.00095 + 0.0006 * grain)
        * smoothstep(-0.045, 0.021, p.x) * smoothstep(0.25, 0.74, mottling);
      vec3 calcite = vec3(0.40, 0.435, 0.44) * (0.64 + 0.43 * grain);
      return mix(rock, calcite, max(seam, branch));
    }
  `;

  function makeMaterial() {
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.76, aoMapIntensity: 0.8, normalScale: new THREE.Vector2(1.43, 1.43),
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vStonePosition;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvStonePosition = position;',
      );
      shader.fragmentShader = minerals + shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
        #include <map_fragment>
        diffuseColor.rgb = stoneAlbedo(diffuseColor.rgb);
      `);
    };
    return material;
  }

  async function loadTexture(encoded, colorSpace = THREE.NoColorSpace, format = 'jpeg') {
    const url = `data:image/${format};base64,${encoded}`;
    const texture = typeof createImageBitmap === 'function'
      ? new THREE.Texture(await new THREE.ImageBitmapLoader().loadAsync(url))
      : await new THREE.TextureLoader().loadAsync(url);
    texture.flipY = false;
    texture.colorSpace = colorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  function createScanStone() {
    const material = makeMaterial();
    const mesh = new THREE.Mesh(makeGeometry(window.AQUARIUM_STONE_GEOMETRY), material);
    mesh.name = 'AquariumStone';
    mesh.position.set(0.31, 0, -0.075);
    mesh.rotation.y = -0.32;
    mesh.castShadow = mesh.receiveShadow = true;

    const { positions, indices } = window.AQUARIUM_STONE_COLLISION;
    const collisionGeometry = new THREE.BufferGeometry();
    collisionGeometry.setAttribute('position', new THREE.BufferAttribute(unpack(positions, Float32Array), 3));
    collisionGeometry.setIndex(new THREE.BufferAttribute(unpack(indices, Uint16Array), 1));
    const collider = new THREE.Mesh(collisionGeometry, material);
    collider.name = 'AquariumStoneCollision';
    collider.visible = false;
    mesh.add(collider);

    const { color, normal, surface } = window.AQUARIUM_STONE_TEXTURES;
    const ready = Promise.all([
      loadTexture(color, THREE.SRGBColorSpace), loadTexture(normal), loadTexture(surface),
    ]).then(([map, normalMap, roughnessMap]) => {
      Object.assign(material, { map, normalMap, roughnessMap, aoMap: roughnessMap });
      material.needsUpdate = true;
    });
    return { mesh, collider, ready };
  }

  const rockSurfaces = {
    dragon: {
      scale: [3.0, 3.7, 3.0], strength: 1.30,
      albedo: `float iron = smoothstep(.32, .82, mineralNoise(p * 13.0 + 29.0));
        float gritLight = dot(photo,vec3(.2126,.7152,.0722));
        photo *= clamp(pow(max(.02, gritLight) / .29, .38), .73, 1.32);
        photo *= mix(vec3(1.02, .84, .64), vec3(.79, .53, .39), iron);
        float intact = smoothstep(.68, .95, vColor.r);
        photo *= mix(vec3(.48, .40, .33), vec3(1.08, 1.03, .97), intact);
        float weather = mineralNoise(p * vec3(63.0, 26.0, 59.0));
        photo *= .83 + .34*weather;`,
      roughness: `roughnessFactor = clamp(.30 + .59 * scanRough, .48, .88);`,
    },
    slate: {
      scale: [2.6, 6.8, 2.6], strength: .83,
      albedo: `float rockLight = dot(photo, vec3(.2126,.7152,.0722));
        photo = mix(photo, rockLight * vec3(1.78,.72,.61), .80);
        float fold = (mineralNoise(p * 30.0) - .5) * .007;
        float bedding = p.y + .14*p.x - .075*p.z + fold;
        float seam = scannedStoneLine(bedding + .009, .00105);
        float split = bedding + .045*p.z - .007 + (mineralNoise(p * 83.0) - .5) * .0018;
        seam = max(seam, .81 * scannedStoneLine(split, .00074));
        float veinDistance = p.z + .30*p.x + .20*p.y + fold - .016;
        float thinVein = scannedStoneLine(veinDistance, .00083)
          * smoothstep(.33, .72, mineralNoise(p * 43.0));
        photo = mix(photo, vec3(.41,.31,.28) * (.73 + .52*rockLight), max(seam*.64, thinVein*.64));`,
      roughness: `roughnessFactor = clamp(.27 + .60 * scanRough, .45, .83);`,
    },
    river: {
      scale: [4.0, 4.0, 4.0], strength: .54,
      albedo: `float rockLight = dot(photo, vec3(.2126,.7152,.0722));
        float silicate = mineralNoise(p * 19.0 + 4.0);
        vec3 cool = mix(vec3(.67,.80,.85),vec3(.85,.95,.99),silicate);
        photo = mix(photo, rockLight * cool, .84) * clamp(pow(max(.02,rockLight) / .16, .27), .80, 1.28);
        float fleck = mineralNoise(p * 71.0);
        float bend = .020*mineralNoise(p*30.0) + .0030*fleck;
        float quartzDistance = p.x - .33*p.z + .17*p.y + bend + .009;
        float band = mix(.00028, .0021, smoothstep(.30,.72,fleck));
        float quartz = scannedStoneLine(quartzDistance, .69*band)
          * smoothstep(.37, .71, silicate + .30*(fleck-.5));
        photo = mix(photo, vec3(.32,.34,.32), quartz * .36);`,
      roughness: `roughnessFactor = clamp(.22 + .43 * scanRough, .35, .64);`,
    },
  };

  function measuredGeometry(data) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(unpack(data.positions, Float32Array), 3));
    geometry.setIndex(new THREE.BufferAttribute(unpack(data.indices, Uint16Array), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
  }

  // Position is in tank metres. Each fitted camera projects directly into its
  // original photograph; adjacent atlas tiles share a dilated on-rock border.
  function specimenProjection(specimen) {
    if (!specimen?.atlas) return '';
    const tileCount = specimen.views.length > 1 ? 2 : 1;
    const vec = values => values.map(x => Number(x).toFixed(8)).join(',');
    const projections = specimen.views.map(({matrix, facing, origin, side}, i) => {
      const rows = matrix.map((row,j) => row.map((x,k) => (x - (k === 3 ? origin[j] : 0)) / side));
      return `{
        vec2 uv = vec2(dot(homogeneous,vec4(${vec(rows[0])})),dot(homogeneous,vec4(${vec(rows[1])})));
        float weight = pow(max(dot(localN,vec3(${vec(facing)})),0.), 3.5);
        vec2 atlasUv = (clamp(uv, .002, .998) + vec2(${i%tileCount}.0,${Math.floor(i/tileCount)}.0)) / ${tileCount}.0;
        registered += weight * texture2D(uSpecimenAtlas,atlasUv).rgb;
        totalWeight += weight;
      }`;
    });
    return `vec4 homogeneous = vec4(p, 1.);
      vec3 registered = vec3(0.); float totalWeight = 0.;
      ${projections.join('\n')}
      photo = mix(photo, registered / max(.00001,totalWeight), smoothstep(.0,.028,totalWeight));`;
  }

  // Object-space triplanar projection keeps the photograph on the rock as it moves.
  // Project each scan normal onto the corresponding tangent axes, then remove its
  // component along the modeled normal. All three views share the same roughness.
  function makeRockMaterial(kind, specimen) {
    const style = rockSurfaces[kind];
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
    material.defines.AQUARIUM_SCANNED_RECESS = 1;
    const maps = window.AQUARIUM_ROCK_SURFACES[kind];
    const color = { value: null };
    const surface = { value: null };
    const weathering = { value: null };
    const reference = { value: null };
    const minerals = { value: null };
    const ready = Promise.all([loadTexture(maps.color, THREE.SRGBColorSpace), loadTexture(maps.surface),
      loadTexture(maps.weathering.map, THREE.NoColorSpace, 'png'),
      specimen?.atlas ? loadTexture(specimen.atlas, THREE.SRGBColorSpace) : null,
      specimen?.detail ? loadTexture(specimen.detail.mask, THREE.NoColorSpace, 'png') : null])
      .then(([albedo, detail, relief, atlas, inclusions]) => {
        if (inclusions) {
          inclusions.wrapS = THREE.RepeatWrapping;
          inclusions.needsUpdate = true;
          minerals.value = inclusions;
        }
        reference.value = atlas;
        for (const texture of [albedo, detail, relief]) {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.needsUpdate = true;
        }
        color.value = albedo;
        surface.value = detail;
        weathering.value = relief;
      });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRockColor = color;
      if (specimen?.atlas) shader.uniforms.uSpecimenAtlas = reference;
      if (specimen?.detail) {
        shader.uniforms.uMineralMarks = minerals;
        shader.uniforms.uSpecimenRadius = { value: new THREE.Vector3(...specimen.detail.halfExtents) };
      }
      shader.uniforms.uRockSurface = surface;
      shader.uniforms.uRockWeathering = weathering;
      shader.uniforms.uRockScale = { value: new THREE.Vector3(...style.scale) };
      shader.uniforms.uRockRelief = { value: style.strength };
      shader.vertexShader = `attribute vec3 weatherPosition; attribute vec3 weatherNormal;
        varying vec3 vStonePosition; varying vec3 vRockNormal; varying vec3 vWeatherPosition;\n` + shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvStonePosition = position; vRockNormal = weatherNormal; vWeatherPosition = weatherPosition;',
      );
      shader.fragmentShader = mineralNoiseShader + `
        varying vec3 vRockNormal;
        varying vec3 vWeatherPosition;
        uniform sampler2D uRockColor;
        uniform sampler2D uRockSurface;
        uniform sampler2D uRockWeathering;
        ${specimen?.atlas ? 'uniform sampler2D uSpecimenAtlas;' : ''}
        ${specimen?.detail ? 'uniform sampler2D uMineralMarks; uniform vec3 uSpecimenRadius;' : ''}
        uniform vec3 uRockScale;
        uniform float uRockRelief;
        uniform mat3 normalMatrix;
        float scannedStoneLine(float distance, float halfWidth) {
          float pixel = max(.00001, fwidth(distance));
          float feather = max(.50 * halfWidth, .65 * pixel);
          return (1.0 - smoothstep(max(0.0, halfWidth - feather), halfWidth + feather, abs(distance)))
            * min(1.0, 2.0 * halfWidth / pixel);
        }
      ` + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 p = vStonePosition;
        vec3 coord = p * uRockScale;
        vec3 localN = normalize(vRockNormal);
        vec3 w = pow(abs(localN), vec3(5.0));
        w /= max(.0001, w.x+w.y+w.z);
        vec2 uvX = coord.zy + vec2(.34,.17);
        vec2 uvY = coord.xz + vec2(.70,.42);
        vec2 uvZ = coord.xy + vec2(.12,.76);
        vec3 photo = w.x * texture2D(uRockColor,uvX).rgb + w.y * texture2D(uRockColor,uvY).rgb
          + w.z * texture2D(uRockColor,uvZ).rgb;
        vec3 sx = texture2D(uRockSurface,uvX).rgb;
        vec3 sy = texture2D(uRockSurface,uvY).rgb;
        vec3 sz = texture2D(uRockSurface,uvZ).rgb;
        float scanRough = dot(w, vec3(sx.b,sy.b,sz.b));
        vec2 nx = 2.0*sx.rg-1.0, ny = 2.0*sy.rg-1.0, nz = 2.0*sz.rg-1.0;
        vec3 scanSlope = w.x*vec3(0.0,nx.y,nx.x) + w.y*vec3(ny.x,0.0,ny.y) + w.z*vec3(nz.x,nz.y,0.0);
        vec3 reliefX = texture2D(uRockWeathering, vWeatherPosition.zy + vec2(.37,.58)).rgb;
        vec3 reliefY = texture2D(uRockWeathering, vWeatherPosition.xz + vec2(.18,.29)).rgb;
        vec3 reliefZ = texture2D(uRockWeathering, vWeatherPosition.xy + vec2(.71,.13)).rgb;
        // R encodes signed erosion depth. GB are residual slopes after mesh displacement.
        float reliefDepth = dot(w, vec3(reliefX.r,reliefY.r,reliefZ.r)) - .5;
        vec2 gradX = (reliefX.gb-.5)*4.0, gradY = (reliefY.gb-.5)*4.0, gradZ = (reliefZ.gb-.5)*4.0;
        vec3 erodedSlope = w.x*vec3(0.,gradX.y,gradX.x) + w.y*vec3(gradY.x,0.,gradY.y) + w.z*vec3(gradZ.x,gradZ.y,0.);
        ${specimen?.mesh.colors
          ? 'photo = vec3(clamp(.84 + .64*dot(photo,vec3(.2126,.7152,.0722)), .83, 1.15));'
          : style.albedo}
        ${specimenProjection(specimen)}
        ${specimen?.detail ? `
          vec3 dir = normalize(p / uSpecimenRadius);
          vec2 st = vec2(.5 + atan(dir.z,dir.x)/6.2831853, .5 - asin(clamp(dir.y,-1.,1.))/3.1415927);
          vec3 mineralMark = texture2D(uMineralMarks,st).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.66,.62,.52),.70*mineralMark.r);
          diffuseColor.rgb = mix(diffuseColor.rgb,vec3(.37,.20,.06),.70*mineralMark.g);
          diffuseColor.rgb *= 1. - .70*mineralMark.b;
          // Register broad pigment colour to the turntable training views under
          // neutral light. Bright crystal reflections retain a near-neutral hue.
          float brightGrain = smoothstep(.28,.66,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
          diffuseColor.rgb = min(vec3(.96), diffuseColor.rgb * mix(vec3(1.46,1.90,2.75),vec3(1.38,1.45,1.52),brightGrain));
        ` : ''}
        float recess = smoothstep(.025, .31, -reliefDepth);
        photo *= 1.0 - recess*.32;
        diffuseColor.rgb *= photo * (1.0 + .055*smoothstep(.07,.32,reliefDepth));
      `).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + style.roughness
          + '\nroughnessFactor = clamp(roughnessFactor + .10*recess, .16, .94);'
          + (specimen?.detail ? 'roughnessFactor = clamp(roughnessFactor - .10*mineralMark.r + .06*mineralMark.g, .18, .94);' : ''))
        .replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          vec3 slope = uRockRelief * scanSlope + erodedSlope;
          vec3 tangentSlope = slope - localN * dot(slope, localN);
          normal = normalize(normal + normalMatrix * tangentSlope);
        `);
    };
    material.customProgramCacheKey = () => 'aquarium-scanned-rock-' + kind + (specimen?.atlas ? '-registered' : specimen?.mesh.colors ? '-pigments' : '');
    return { material, ready };
  }

  // A ring shares vertices all the way around, including the seam. The caps are single vertices.
  function ringGeometry(sides, ringCount, point) {
    const positions = [], colors = [], indices = [];
    function addVertex(fraction, angle) {
      const [x, y, z, shade = 1] = point(fraction, angle);
      positions.push(x, y, z);
      colors.push(shade, shade, shade);
    }
    addVertex(0, 0);
    for (let row = 1; row <= ringCount; row++) {
      for (let i = 0; i < sides; i++) addVertex(row / (ringCount + 1), 2 * Math.PI * i / sides);
    }
    const top = positions.length / 3;
    addVertex(1, 0);
    for (let i = 0; i < sides; i++) {
      const current = i + 1, next = 1 + (i + 1) % sides;
      indices.push(0, current, next);
      for (let row = 0; row < ringCount - 1; row++) {
        const a = current + sides * row, b = next + sides * row;
        indices.push(a, a + sides, b, b, a + sides, b + sides);
      }
      indices.push(top, next + (ringCount - 1) * sides, current + (ringCount - 1) * sides);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return geometry;
  }

  function makeDragonGeometry(variant, collision = false) {
    // Erosion follows pockets in the sediment. Some troughs join; intact patches break up the pitting.
    const cavities = [];
    let state = 10913 + variant * 107;
    function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    }
    for (let i = 0; i < 57; i++) {
      const y = 1 - (2 * i + random() * 1.6) / 57;
      const azimuth = i * 2.39996 + .68 * (random() - .5) + 1.7 * variant;
      const radius = Math.sqrt(1 - y * y);
      const x = radius * Math.cos(azimuth), z = radius * Math.sin(azimuth);
      const lean = .22 + .29 * random();
      const width = .048 + .143 * random() ** .92;
      cavities.push({ x, y, z, tx: -Math.sin(azimuth), tz: Math.cos(azimuth),
        vx: -y * Math.cos(azimuth), vy: radius, vz: -y * Math.sin(azimuth),
        lean, width, length: width * (1.55 + 1.58 * random()),
        erosion: .40 + .60 * random(), phase: random() * Math.PI * 2 });
    }
    return ringGeometry(collision ? 28 : 144, collision ? 17 : 83, (fraction, angle) => {
      const latitude = (fraction - 0.5) * Math.PI, y = Math.sin(latitude);
      const x = Math.cos(latitude) * Math.cos(angle), z = Math.cos(latitude) * Math.sin(angle);
      let cavity = 0, lip = 0;
      for (const hole of cavities) {
        if (x * hole.x + y * hole.y + z * hole.z < 0.85) continue;
        const u = x * hole.tx + z * hole.tz;
        const v = x * hole.vx + y * hole.vy + z * hole.vz;
        const along = v / hole.length;
        const across = (u - hole.lean * v) / hole.width + .15 * Math.sin(along * 3.8 + hole.phase);
        const distance = (Math.abs(across) ** 1.6 + Math.abs(along) ** 2.3)
          * (1 + .18 * Math.sin(6.8 * along + hole.phase) + .11 * Math.sin(7.1 * across - .6 * hole.phase));
        if (distance >= 1.6) continue;
        const wall = (1 - THREE.MathUtils.smoothstep(distance, .04, 1.06)) * hole.erosion;
        cavity = Math.max(cavity, wall);
        lip = Math.max(lip, (.7 + .3 * along) * hole.erosion * (1 - Math.abs(distance - 1.06) / .43));
      }
      const facets = 0.06 * Math.sin(x * 5.5 + y * 3.8 - z * 3.1 + variant)
        + 0.045 * Math.cos(z * 7.2 - y * 4.8) + 0.025 * Math.sin(x * 12 + y * 6 + z * 9);
      const ridge = Math.abs(Math.sin(5.8 * x + 1.7 * y - 3.9 * z + variant));
      const bedding = 13.5 * x - 7.3 * z + 2.1 * y + .65 * Math.sin(4.5*z + 3.2*y);
      const cleft = Math.exp(-5.5 * Math.abs(Math.sin(bedding)));
      const radial = 1 + facets + .05 * ridge - .37 * cavity + .026 * lip
        - .044 * cleft * (.53 + .47 * Math.sin(3.3*x + 4.4*y - z));
      const taper = 1 - (variant ? 0.19 : 0.32) * y;
      const height = variant ? 0.068 : 0.112;
      return [x * radial * taper * (variant ? 0.124 : 0.079) + 0.021 * (y + 0.25),
        y * radial * height, z * radial * taper * (variant ? 0.071 : 0.077),
        1 - 0.48 * cavity + 0.05 * lip];
    });
  }

  function makeSlateGeometry(variant, collision = false) {
    // Successive rims are offset slices of the same slab, making real ledges along its edges.
    const profile = variant
      ? [[0,-1],[0.70,-0.98],[0.88,-0.88],[0.90,-0.60],[0.76,-0.55],[0.78,-0.43],
        [1,-0.35],[0.99,-0.08],[0.78,-0.04],[0.76,0.12],[0.91,0.20],[0.91,0.46],
        [0.69,0.49],[0.68,0.60],[0.77,0.68],[0.73,0.89],[0.50,0.97],[0,1]]
      : [[0,-1],[0.69,-0.98],[0.92,-0.82],[0.98,-0.50],[0.92,-0.30],[1,-0.15],
        [0.97,0.23],[0.94,0.30],[0.97,0.43],[0.92,0.72],[0.70,0.90],[0,1]];
    // Interpolate within each shelf. The broad upper and lower faces need more
    // samples than the narrow ledges so their chipped skin can cast real shadows.
    const layers = [profile[0]];
    for (let i = 1; i < profile.length; i++) {
      const [previousR, previousY] = profile[i-1];
      const [r, level] = profile[i];
      const steps = collision ? 1 : Math.max(2, Math.ceil(Math.abs(r-previousR)*33), Math.ceil((level-previousY)*10));
      for (let j=1; j<=steps; j++) {
        const t = j/steps;
        layers.push([previousR+(r-previousR)*t, previousY+(level-previousY)*t]);
      }
    }
    return ringGeometry(collision ? 40 : 112, layers.length - 2, (fraction, angle) => {
      const [r, level] = layers[Math.round(fraction * (layers.length - 1))];
      const edge = 1 + 0.09 * Math.sin(3 * angle + 0.7 + variant)
        + 0.06 * Math.cos(5 * angle - variant) + 0.032 * Math.cos(7 * angle);
      const shift = variant ? 0.018 * level : 0.004 * level;
      const corner = Math.cos(angle), side = Math.sin(angle);
      const chipped = 1 - .13 * Math.max(0, Math.cos(2.7 * angle - .51 * level + variant)) ** 12
        + .021 * Math.cos(14 * angle + 1.6 * level);
      const x = r * edge * chipped * .124 * Math.sign(corner) * Math.abs(corner) ** .72 + shift;
      const z = r * edge * chipped * .076 * Math.sign(side) * Math.abs(side) ** .72 - .45 * shift;
      const y = level * (variant ? 0.049 : 0.030) - 0.14 * x + 0.075 * z
        + r * (0.0025 * Math.sin(3 * angle - 0.8) + 0.001 * Math.sin(5 * angle + level));
      return [x, y, z, 0.89 + 0.11 * Math.cos(level * 18 + r * 2)];
    });
  }

  function makeRiverGeometry(variant, collision = false) {
    return ringGeometry(collision ? 20 : 112, collision ? 12 : 63, (fraction, angle) => {
      const latitude = (fraction - 0.5) * Math.PI, y = Math.sin(latitude);
      const x = Math.cos(latitude) * Math.cos(angle), z = Math.cos(latitude) * Math.sin(angle);
      const surface = 1 + 0.045 * Math.sin(3.7 * x + 2.1 * y + variant) * Math.cos(2.8 * z)
        + 0.020 * Math.sin(5.3 * z + 3 * y);
      // A pebble develops a few broad worn contact faces before its corners are rounded by water.
      const worn = Math.max(0, .74*x + .47*y - .49*z - .67);
      const wornTop = y - .34*Math.max(0, y + .20*x + .14*z - .61);
      return [(x * surface - .27*worn) * (variant ? 0.077 : 0.111) * (1 - 0.13 * z),
        wornTop * surface * (variant ? 0.064 : 0.040),
        z * surface * (variant ? 0.085 : 0.071), 1 - 0.06 * Math.cos(3.5 * x - z)];
    });
  }

  const geometryBuilders = { dragon: makeDragonGeometry, slate: makeSlateGeometry, river: makeRiverGeometry };
  function displaceWeatheredSkin(geometry, kind, variant, strength = .68) {
    const field = window.AQUARIUM_ROCK_SURFACES[kind].weathering;
    const grid = unpack(field.coarse, Uint8Array);
    const n = field.coarseSize;
    function height(u, v) {
      const x = (u-Math.floor(u))*n-.5, y = (v-Math.floor(v))*n-.5;
      const ix = Math.floor(x), iy = Math.floor(y), fx = x-ix, fy = y-iy;
      const left = (ix+n)%n, right = (ix+1)%n, top = (iy+n)%n*n, bottom = (iy+1)%n*n;
      const a = grid[top+left]*(1-fx) + grid[top+right]*fx;
      const b = grid[bottom+left]*(1-fx) + grid[bottom+right]*fx;
      return ((a*(1-fy)+b*fy)/255-.5)*2*field.range;
    }
    const positions = geometry.attributes.position;
    const baseNormals = geometry.attributes.normal.clone();
    const coordinates = new THREE.Float32BufferAttribute(new Float32Array(positions.count*3),3);
    for (let i=0; i<positions.count; i++) {
      const nx = baseNormals.getX(i), ny = baseNormals.getY(i), nz = baseNormals.getZ(i);
      const wx = Math.abs(nx)**5, wy = Math.abs(ny)**5, wz = Math.abs(nz)**5;
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const u = x/field.period + .33*variant, v = y/field.period + .24*variant, t = z/field.period + .37*variant;
      coordinates.setXYZ(i,u,v,t);
      const h = strength * (wx*height(t+.37,v+.58) + wy*height(u+.18,t+.29) + wz*height(u+.71,v+.13))
        / Math.max(.0001,wx+wy+wz);
      positions.setXYZ(i,x+h*nx,y+h*ny,z+h*nz);
    }
    geometry.setAttribute('weatherPosition',coordinates);
    geometry.setAttribute('weatherNormal',baseNormals);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
  }

  const tripoAssets = new Map();
  function tripoOhko(kind) {
    if (tripoAssets.has(kind)) return tripoAssets.get(kind);
    const original = window.AQUARIUM_TRIPO_OHKO;
    const weathered = kind === 'tripoOhkoWeathered';
    const data = weathered ? window.AQUARIUM_TRIPO_OHKO_WEATHERED : original;
    const material = new THREE.MeshStandardMaterial();
    const ready = Promise.all([
      loadTexture(data.color, THREE.SRGBColorSpace),
      loadTexture(data.normal, THREE.NoColorSpace, weathered ? 'png' : 'jpeg'),
      loadTexture(data.surface),
    ]).then(([map, normalMap, surface]) => {
      Object.assign(material, { map, normalMap, roughnessMap: surface, metalnessMap: surface, metalness: 1 });
      material.needsUpdate = true;
    });
    const asset = {
      visible: makeGeometry(data),
      collision: measuredGeometry(original.collision), material, ready,
    };
    tripoAssets.set(kind, asset);
    return asset;
  }

  const geometryCache = new Map(), materialCache = new Map();
  window.createAquariumStone = function (kind = 'original', variant = 0) {
    if (kind === 'tripoOhko' || kind === 'tripoOhkoWeathered') return assembleStone(kind, 0, tripoOhko(kind));
    if (!Object.hasOwn(geometryBuilders, kind)) return createScanStone();
    const shape = Math.abs(Math.trunc(variant) || 0) % 2;
    const key = kind + '-' + shape;
    const specimen = shape === 0 ? window.AQUARIUM_STONE_SPECIMENS?.[kind]
      : kind === 'river' ? window.AQUARIUM_CARBIS_PEBBLE : null;
    if (!geometryCache.has(key) && specimen) {
      const visible = measuredGeometry(specimen.mesh);
      if (specimen.mesh.colors) {
        visible.setAttribute('color', new THREE.BufferAttribute(unpack(specimen.mesh.colors, Uint8Array), 3, true));
      } else {
        const colors = new Uint8Array(visible.attributes.position.count * 3).fill(255);
        if (specimen.mesh.shade) {
          const shade = unpack(specimen.mesh.shade, Uint8Array);
          for (let i = 0; i < shade.length; i++) colors.fill(shade[i], i * 3, i * 3 + 3);
        }
        visible.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
      }
      displaceWeatheredSkin(visible, kind, shape, specimen.mesh.colors ? 0 : .14);
      geometryCache.set(key, { visible, collision: measuredGeometry(specimen.collision) });
    }
    if (!geometryCache.has(key)) {
      const visible = geometryBuilders[kind](shape);
      displaceWeatheredSkin(visible, kind, shape);
      const collision = geometryBuilders[kind](shape, true);
      geometryCache.set(key, { visible, collision });
    }
    const materialKey = specimen?.atlas || specimen?.mesh.colors ? key : kind;
    if (!materialCache.has(materialKey)) materialCache.set(materialKey, makeRockMaterial(kind, specimen));
    const { visible, collision } = geometryCache.get(key);
    const { material, ready } = materialCache.get(materialKey);
    return assembleStone(kind, shape, { visible, collision, material, ready });
  };

  function assembleStone(kind, shape, { visible, collision, material, ready }) {
    const mesh = new THREE.Mesh(visible, material);
    mesh.name = 'AquariumStone-' + kind + '-' + shape;
    mesh.userData.kind = kind;
    mesh.userData.variant = shape;
    mesh.position.set(0.31, 0, -0.075);
    mesh.rotation.y = -0.32;
    mesh.castShadow = mesh.receiveShadow = true;
    const collider = new THREE.Mesh(collision, mesh.material);
    collider.name = 'AquariumStoneCollision';
    collider.visible = false;
    mesh.add(collider);
    return { mesh, collider, ready };
  }
})();
