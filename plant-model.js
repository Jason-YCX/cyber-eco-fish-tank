(function () {
  'use strict';

  // Azimuth, petiole height/reach, blade reach/rise, half-width, arch, twist, and texture variant.
  const leaves = [
    [0.10, .032, .016, .085, .021, .0124, .015, -.46, 2],
    [1.20, .041, .016, .075, .029, .0122, .018, .54, 1],
    [2.18, .028, .018, .087, .018, .0118, .014, -.63, 2],
    [3.30, .035, .014, .089, .027, .0132, .017, .39, 1],
    [4.43, .045, .012, .076, .032, .0130, .013, -.31, 2],
    [5.54, .034, .016, .083, .014, .0115, .016, .64, 1],
    [.50, .061, .011, .067, .062, .0125, .021, .23, 1],
    [1.73, .050, .012, .071, .070, .0113, .024, -.37, 0],
    [2.74, .059, .013, .065, .057, .0128, .020, .53, 2],
    [3.88, .067, .010, .052, .072, .0108, .022, -.41, 1],
    [4.92, .052, .010, .058, .080, .0125, .018, .36, 0],
    [5.92, .051, .012, .066, .061, .0121, .022, -.49, 1],
    [.99, .060, .006, .038, .101, .0103, .015, -.42, 0],
    [3.06, .064, .008, .046, .118, .0113, .016, .33, 1],
    [4.57, .054, .007, .041, .107, .0097, .016, -.35, 0],
  ];

  function makeLeafMaps() {
    const size = 512;
    const tileWidth = 168;
    const padding = 8;
    const leafWidth = tileWidth - 2 * padding;
    const leafHeight = size - 2 * padding;
    const colors = [
      [78, 124, 43],
      [62, 111, 43],
      [74, 106, 40],
    ];
    const colorPixels = new Uint8Array(size * size * 4);
    const reliefPixels = new Uint8Array(colorPixels.length);

    function smoothstep(low, high, value) {
      const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
      return t * t * (3 - 2 * t);
    }

    function hash(x, y, seed) {
      let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)
        ^ Math.imul(seed + 1, 1597334677);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    }

    function noise(x, y, seed) {
      const column = Math.floor(x);
      const row = Math.floor(y);
      const u = smoothstep(0, 1, x - column);
      const v = smoothstep(0, 1, y - row);
      const a = hash(column, row, seed);
      const b = hash(column + 1, row, seed);
      const c = hash(column, row + 1, seed);
      const d = hash(column + 1, row + 1, seed);
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    }

    for (let y = 0; y < size; y += 1) {
      const v = Math.max(0, Math.min(1, (y - padding) / (leafHeight - 1)));
      const bladeVeins = smoothstep(0.025, 0.15, v) * (1 - smoothstep(0.84, 0.99, v));
      for (let x = 0; x < size; x += 1) {
        const variant = Math.min(2, Math.floor(x / tileWidth));
        const u = Math.max(0, Math.min(1, (x - variant * tileWidth - padding) / (leafWidth - 1)));
        const seed = variant * 17;
        const large = noise(u * 4.5, v * 8.2, seed);
        const patches = noise(u * 10, v * 19, seed + 1);
        const cells = noise(u * 35, v * 95, seed + 2);
        const centered = (u - 0.5) * 2 - 0.013 * Math.sin(v * 8 + variant) * Math.sin(v * Math.PI);
        const side = Math.abs(centered);
        const ribWidth = 0.009 + 0.022 * (1 - v);
        const rib = 1 - smoothstep(ribWidth * 0.50, ribWidth * 1.48, side);
        const ribEdge = 1 - smoothstep(0.003, 0.028, Math.abs(centered + ribWidth * 1.36));

        // The secondaries curve toward the leaf point as they leave the central vein.
        const arc = 0.091 * (1 - (1 - Math.min(1, side)) ** 1.65);
        const spacing = 10.8 * (v - arc) + 0.20 * Math.sin(v * 17 + variant)
          + (centered > 0 ? 0.14 : -0.14) + (large - 0.5) * 0.20;
        const veinDistance = Math.abs(spacing - Math.round(spacing));
        const branchFade = smoothstep(0.035, 0.14, side) * (1 - smoothstep(0.78, 0.99, side))
          * bladeVeins * (0.61 + 0.39 * hash(Math.round(spacing), centered > 0 ? 1 : 2, seed + 3));
        const branch = (1 - smoothstep(0.011, 0.068, veinDistance)) * branchFade;
        const branchEdge = (1 - smoothstep(0.008, 0.054, Math.abs(veinDistance - 0.067))) * branchFade;
        const forkPath = spacing - 0.24 * smoothstep(0.22, 0.87, side);
        const fork = (1 - smoothstep(0.007, 0.040, Math.abs(forkPath - Math.round(forkPath))))
          * smoothstep(0.22, 0.46, side) * branchFade * smoothstep(0.28, 0.67, patches);
        const lengthwise = (1 - smoothstep(0.012, 0.036, Math.abs(side - 0.66 - 0.05 * Math.sin(v * 7 + variant))))
          * bladeVeins * (0.45 + 0.55 * large);
        const rim = smoothstep(0.90, 1, side) * patches;
        const bronze = variant === 2 ? 0.20 * smoothstep(0.52, 0.90, large) * smoothstep(0.23, 0.83, v) : 0;
        const darkBase = 1 - smoothstep(0, 0.27, v);
        const mottling = 15 * (large - 0.5) + 11 * (patches - 0.5) + 7 * (cells - 0.5);
        const [red, green, blue] = colors[variant];
        const index = (y * size + x) * 4;
        colorPixels[index] = Math.round(red + mottling + 35 * bronze - 11 * darkBase - 8 * rib
          + 7 * ribEdge - 8 * branch + 4 * branchEdge - 3 * fork + 6 * rim);
        colorPixels[index + 1] = Math.round(green + 1.07 * mottling - 43 * bronze - 22 * darkBase - 16 * rib
          + 9 * ribEdge - 17 * branch + 4 * branchEdge - 6 * fork - 5 * lengthwise + 4 * rim);
        colorPixels[index + 2] = Math.round(blue + 0.52 * mottling - 5 * darkBase - 6 * rib
          - 5 * branch - 2 * fork - 2 * lengthwise);
        // Store optical transmission in alpha. The leaf shader keeps surface coverage opaque.
        const transmission = 0.72 + 0.125 * smoothstep(0.44, 1, side) + 0.05 * (patches - 0.5)
          - 0.31 * rib - 0.20 * darkBase - 0.19 * branch - 0.07 * fork - 0.09 * lengthwise;
        colorPixels[index + 3] = Math.round(255 * transmission);

        const height = Math.round(255 * (0.46 + 0.033 * (large - 0.5) + 0.028 * (patches - 0.5)
          + 0.031 * (cells - 0.5) + 0.114 * rib + 0.052 * branch + 0.017 * lengthwise));
        reliefPixels[index] = height;
        reliefPixels[index + 1] = height;
        reliefPixels[index + 2] = height;
        reliefPixels[index + 3] = 255;
      }
    }

    function texture(pixels, colorSpace) {
      const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
      map.colorSpace = colorSpace;
      map.magFilter = THREE.LinearFilter;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.generateMipmaps = true;
      map.anisotropy = 8;
      map.needsUpdate = true;
      return map;
    }

    function atlasUv(variant, u, v) {
      return [
        (variant * tileWidth + padding + 0.5 + u * (leafWidth - 1)) / size,
        (padding + 0.5 + v * (leafHeight - 1)) / size,
      ];
    }

    return {
      map: texture(colorPixels, THREE.SRGBColorSpace),
      bumpMap: texture(reliefPixels, THREE.NoColorSpace),
      atlasUv,
    };
  }

  function makeLeafMaterial(map, bumpMap, thinTissue = false) {
    const material = new THREE.MeshStandardMaterial({
      map, bumpMap, bumpScale: .00069, side: THREE.DoubleSide, roughness: .69,
    });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', /* glsl */ `
        #include <lights_physical_pars_fragment>
        float leafTransmission;
        vec3 leafNormal;

        void RE_Direct_AquariumLeaf(const in IncidentLight light, const in vec3 position,
            const in vec3 normal, const in vec3 viewDirection, const in vec3 clearcoatNormal,
            const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(light, position, normal, viewDirection, clearcoatNormal, material, reflectedLight);
          float backlight = saturate(dot(leafNormal, -light.direction));
          float forwardScatter = 0.44 + 0.56 * pow2(saturate(dot(viewDirection, -light.direction)));
          // The existing loops supply each light's color, range, cone and shadow factor.
          #ifdef AQUARIUM_THIN_TISSUE
            // A lamina transmits more light than it reflects. Veins and older
            // tissue store greater optical thickness in the measured leaf atlas.
            float path = 1.0 / max(0.48, backlight);
            float through = pow(max(0.02, leafTransmission), path);
            vec3 filtered = pow(max(material.diffuseColor, vec3(0.0001)), vec3(0.62))
              * vec3(0.89, 1.10, 0.61);
            reflectedLight.directDiffuse += filtered * light.color * (1.30 * RECIPROCAL_PI
              * through * backlight * (0.70 + 0.30 * forwardScatter));
          #else
            vec3 transmitted = material.diffuseColor * vec3(1.31, 1.46, 0.71);
            reflectedLight.directDiffuse += transmitted * light.color * (0.44 * RECIPROCAL_PI
              * leafTransmission * backlight * forwardScatter);
          #endif
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_AquariumLeaf
      `).replace('#include <map_fragment>', /* glsl */ `
        #include <map_fragment>
        leafTransmission = diffuseColor.a;
        #ifdef AQUARIUM_THIN_TISSUE
          leafTransmission = clamp(leafTransmission * vTissueTransmission, 0.02, 0.98);
          #ifdef AQUARIUM_TIGER_BLADE
            if (!gl_FrontFacing && vMapUv.x < 0.75) {
              float tissueLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              diffuseColor.rgb = mix(vec3(tissueLuminance), diffuseColor.rgb, 0.93);
            }
          #endif
          if (vWearSeed > 0.0) {
            // An occasional translucent bruise with an oxidised margin on an old blade.
            // Every affected leaf has its own position, size and irregular edge.
            vec2 bladeUv = vec2(fract(vMapUv.x*4.0),vMapUv.y);
            float side = fract(vWearSeed*3.71) < 0.5 ? -1.0 : 1.0;
            vec2 center = vec2(0.5 + side*(0.13 + 0.21*fract(vWearSeed*4.39)),
              0.38 + 0.37*fract(vWearSeed*7.13));
            vec2 delta = (bladeUv-center) / vec2(0.037 + 0.048*fract(vWearSeed*5.91),
              LEAF_MARK_LENGTH * (0.76+0.47*fract(vWearSeed*2.17)));
            float edge = length(delta) + 0.13*sin(4.0*delta.x-2.0*delta.y+vWearSeed);
            float bruise = 1.0-smoothstep(0.58,1.08,edge);
            float rim = bruise*smoothstep(0.35,0.78,edge);
            diffuseColor.rgb *= mix(vec3(1.0),vec3(1.08,0.81,0.59),bruise);
            diffuseColor.rgb *= 1.0-0.30*rim;
            leafTransmission = clamp(leafTransmission + 0.20*bruise - 0.47*rim,0.02,0.98);
          }
        #endif
        #ifdef AQUARIUM_ROOT_HAIR
          diffuseColor.a = clamp(1.33 - 0.71 * vTissueTransmission, 0.30, 0.83);
        #else
          diffuseColor.a = 1.0;
        #endif
      `).replace('#include <lights_physical_fragment>', /* glsl */ `
        #include <lights_physical_fragment>
        leafNormal = nonPerturbedNormal;
        material.specularColor *= 0.71;
        material.specularColorBlended *= 0.71;
        material.specularF90 *= 0.71;
      `);
      if (thinTissue) {
        shader.vertexShader = 'attribute vec2 tissueOptics; varying float vTissueTransmission; varying float vWearSeed;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTissueTransmission = tissueOptics.x; vWearSeed = tissueOptics.y;');
        shader.fragmentShader = 'varying float vTissueTransmission; varying float vWearSeed;\n' + shader.fragmentShader;
      }
      if (material.defines?.AQUARIUM_TIGER_BLADE) {
        // Front and reverse are sampled at the same UV on the same moving mesh.
        // The packed surface texture contains relief and roughness for each face.
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = roughness;
          vec4 leafSurface = texture2D(roughnessMap, vRoughnessMapUv);
          bool reverseBlade = !gl_FrontFacing && vMapUv.x < 0.75;
          roughnessFactor *= reverseBlade ? leafSurface.a : leafSurface.g;
        `).replace('#include <normal_fragment_maps>', `
          vec2 du = dFdx(vBumpMapUv), dv = dFdy(vBumpMapUv);
          vec4 hx = texture2D(bumpMap, vBumpMapUv + du);
          vec4 hy = texture2D(bumpMap, vBumpMapUv + dv);
          vec2 slope = reverseBlade ? vec2(hx.b, hy.b) - leafSurface.b
                                    : vec2(hx.r, hy.r) - leafSurface.r;
          normal = perturbNormalArb(-vViewPosition, normal, bumpScale*slope,
            reverseBlade ? 1.0 : faceDirection);
        `);
      }
    };
    if (thinTissue) material.defines = { ...material.defines, AQUARIUM_THIN_TISSUE: 1 };
    return material;
  }

  function makeSurface() {
    return { positions: [], indices: [], uvs: [], inPhase: [], outOfPhase: [] };
  }

  function addVertex(surface, x, y, z, flex, phase, leafAngle) {
    surface.positions.push(x, y, z);
    const amplitude = (.010 + .002 * Math.sin(phase)) * flex * flex;
    const delay = phase - 1.19 * flex;
    const flowX = amplitude * (.94 + .13 * Math.cos(leafAngle));
    const flowY = amplitude * .16 * Math.sin(leafAngle + .85);
    const flowZ = amplitude * (.34 + .16 * Math.sin(leafAngle));
    const cosine = Math.cos(delay);
    const sine = Math.sin(delay);
    surface.inPhase.push(flowX * cosine, flowY * cosine, flowZ * cosine);
    surface.outOfPhase.push(flowX * sine, flowY * sine, flowZ * sine);
  }

  function normalDelta(geometry, displacement) {
    const posed = new THREE.BufferGeometry();
    posed.setIndex(geometry.index);
    posed.setAttribute('position', new THREE.BufferAttribute(
      Float32Array.from(geometry.attributes.position.array, (value, i) => value + displacement[i]), 3,
    ));
    posed.computeVertexNormals();
    return new THREE.BufferAttribute(
      Float32Array.from(posed.attributes.normal.array, (value, i) => value - geometry.attributes.normal.array[i]), 3,
    );
  }

  function makeMesh(surface, material, boundsPadding = .015) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
    if (surface.uvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(surface.uvs, 2));
    if (surface.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(surface.colors, 3));
    if (surface.optics) geometry.setAttribute('tissueOptics', new THREE.Float32BufferAttribute(surface.optics, 2));
    geometry.setIndex(surface.indices);
    geometry.computeVertexNormals();
    // The two sway shapes can be negative. Keep the raycast bounds large enough in both directions.
    geometry.computeBoundingBox();
    geometry.boundingBox.expandByScalar(boundsPadding);
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.morphTargetsRelative = true;
    const displacements = [surface.inPhase, surface.outOfPhase];
    geometry.morphAttributes.position = displacements.map((data) => new THREE.Float32BufferAttribute(data, 3));
    geometry.morphAttributes.normal = displacements.map((data) => normalDelta(geometry, data));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  function buildOriginalPlant() {
    const { map, bumpMap, atlasUv } = makeLeafMaps();
    const blades = makeSurface();
    const stalks = makeSurface();
    const bladeRows = 30;
    const across = [-1, -.75, -.48, -.23, 0, .23, .48, .75, 1];
    const stalkRows = 8;
    const sides = 6;

    for (const [azimuth, stemHeight, stemReach, reach, lift, width, arch, twist, variant] of leaves) {
      const dx = Math.cos(azimuth);
      const dz = Math.sin(azimuth);
      const phase = .48 * Math.sin(2.1 * azimuth) + .26 * Math.cos(4.3 * azimuth) + .2;
      const texturePhase = azimuth * 3.7;
      const stemStart = stalks.positions.length / 3;
      for (let row = 0; row <= stalkRows; row += 1) {
        const t = row / stalkRows;
        const forward = stemReach * t * t;
        const y = -.003 + (stemHeight + .003) * t;
        const df = 2 * stemReach * t;
        const dy = stemHeight + .003;
        const tangentLength = Math.hypot(df, dy);
        const radial = dy / tangentLength;
        const up = df / tangentLength;
        const radius = .00145 - .00055 * t;
        for (let side = 0; side < sides; side += 1) {
          const angle = side * Math.PI * 2 / sides;
          const cross = radius * Math.sin(angle);
          const normalOffset = radius * Math.cos(angle);
          const along = forward - radial * normalOffset;
          addVertex(stalks, dx * along - dz * cross, y + up * normalOffset, dz * along + dx * cross,
            .30 * t, phase, azimuth);
          if (row === 0) continue;
          const a = stemStart + (row - 1) * sides + side;
          const b = stemStart + (row - 1) * sides + (side + 1) % sides;
          stalks.indices.push(a, b, a + sides, b, b + sides, a + sides);
        }
      }

      const bladeStart = blades.positions.length / 3;
      const tipDrop = .004 + .005 * reach / (reach + lift);
      for (let row = 0; row <= bladeRows; row += 1) {
        const t = row / bladeRows;
        const profile = Math.sin(Math.PI * t ** .83) ** .73;
        const forward = stemReach + reach * (.78 * t + .22 * t * t);
        const y = stemHeight + lift * t + arch * Math.sin(Math.PI * t) - tipDrop * t ** 4;
        const df = reach * (.78 + .44 * t);
        const dy = lift + Math.PI * arch * Math.cos(Math.PI * t) - 4 * tipDrop * t ** 3;
        const tangentLength = Math.hypot(df, dy);
        const normalRadial = -dy / tangentLength;
        const normalUp = df / tangentLength;
        const roll = twist * Math.sin(Math.PI * .68 * t) + .20 * Math.sin(10.5 * t + texturePhase) * t * t;
        const centerShift = .0039 * Math.sin(Math.PI * t) * Math.sin(texturePhase + 2.5 * t);
        for (let lane = 0; lane < across.length; lane += 1) {
          const s = across[lane];
          const irregular = 1 + .060 * Math.sin(30 * t + 1.9 * s + texturePhase)
            + .022 * Math.sin(57 * t - 2.4 * s + texturePhase) + .066 * s * Math.sin(8 * t + texturePhase);
          const span = (.00022 + .00039 * (1 - t) ** 9 + .92 * width * profile) * irregular;
          const fold = span * s * Math.sin(roll);
          const curl = profile * s * s * (.0012 * Math.sin(29 * t + 1.8 * s + texturePhase) - .00059);
          const relief = profile * (1 - s * s) * (.00028 + .00027 * Math.sin(46 * t - 5 * Math.abs(s) + texturePhase));
          const height = fold + curl + relief;
          const cross = centerShift + s * span * Math.cos(roll);
          const along = forward + normalRadial * height;
          addVertex(blades, dx * along - dz * cross, y + normalUp * height, dz * along + dx * cross,
            .30 + .70 * t, phase + .14 * s * t, azimuth);
          blades.uvs.push(...atlasUv(variant, (s + 1) / 2, t));
          if (row === 0 || lane === across.length - 1) continue;
          const a = bladeStart + (row - 1) * across.length + lane;
          const b = a + across.length;
          blades.indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }

    const foliage = makeMesh(blades, makeLeafMaterial(map, bumpMap));
    foliage.name = 'AquariumPlantLeaves';
    const stems = makeMesh(stalks, new THREE.MeshStandardMaterial({
      color: '#576d32', side: THREE.DoubleSide, roughness: .78,
    }));
    stems.name = 'AquariumPlantStems';
    const plant = new THREE.Group();
    plant.name = 'AquariumPlant';
    const plantPick = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ visible: false }));
    plantPick.scale.set(.086, .093, .086);
    plantPick.position.set(0, .074, 0);
    plant.add(foliage, stems, plantPick);

    return { plant, plantBounds: foliage.geometry.boundingBox, plantRadius: .011 };
  }

  function seededRandom(seed) {
    let state = seed;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  // Each atlas has three blade interiors and a narrow-structure tile for stolons or roots.
  // The two measured channels retain photographic pigment and luminance, aligned with the leaf's axes.
  const leafProfiles = {
    monteCarlo: { source: 'monte', width: 256, height: 128, relief: .000060 },
    tigerVallisneria: { source: 'ribbon', width: 512, height: 1024, relief: .000235 },
    redRootFloater: { source: 'floater', width: 512, height: 256, relief: .00019 },
  };

  function leafUv(profile, tile, u, v) {
    const w = profile.width / 4, h = profile.height;
    return [(w * tile + 3.5 + u * (w - 7)) / profile.width, (3.5 + v * (h - 7)) / h];
  }

  function makePatchMaterial(type) {
    const profile = leafProfiles[type];
    const { width, height } = profile;
    const photo = window.AQUARIUM_LEAF_PHOTOS[profile.source];
    const bytes = Uint8Array.from(atob(photo.rg), c => c.charCodeAt(0));
    const bladePixels = photo.blade && Uint8Array.from(atob(photo.blade.rgb), c => c.charCodeAt(0));
    const colors = new Uint8Array(width * height * 4);
    const surface = new Uint8Array(colors.length);
    const smooth = THREE.MathUtils.smoothstep;
    const clamp = THREE.MathUtils.clamp;
    const tileWidth = width / 4;
    // Transverse positions of the bright longitudinal striae in the grower's
    // submerged green leaf, 60.15 s. The broader outer margins are much smoother.
    const tigerStriae = [38,41,46,50,55,61,67,72,77,81].map(px => px/119);
    // Green-channel ranges along the same ten bands, measured at 12 stations
    // of Tropica's submerged blade. They modulate visibility, not measured height.
    const tigerContrast = [
      [20,55,79,99,92,88,107,60,29,15], [5,46,51,85,90,80,71,77,44,23],
      [13,59,71,92,70,59,47,58,34,19], [15,29,70,65,41,55,37,59,9,8],
      [39,65,86,122,54,64,52,34,14,5], [67,64,71,66,60,31,38,33,50,40],
      [68,90,35,49,80,44,23,39,44,41], [20,70,29,35,52,55,40,19,15,4],
      [44,50,28,77,39,47,30,34,29,6], [17,44,35,54,41,40,15,8,10,14],
      [44,29,16,30,24,36,16,5,5,8], [33,51,13,8,33,32,3,15,22,1],
    ];
    const byte = (n) => Math.round(clamp(n, 0, 255));
    function photograph(layer, u, v, channel) {
      const xx = clamp(u, 0, 1) * (photo.width - 1), yy = clamp(v, 0, 1) * (photo.height - 1);
      const ix = Math.min(photo.width - 2, Math.floor(xx)), iy = Math.min(photo.height - 2, Math.floor(yy));
      const offset = ((layer * photo.height + iy) * photo.width + ix) * 2 + channel;
      const stride = 2 * photo.width;
      const bottom = THREE.MathUtils.lerp(bytes[offset], bytes[offset+2], xx-ix);
      const top = THREE.MathUtils.lerp(bytes[offset+stride], bytes[offset+stride+2], xx-ix);
      return THREE.MathUtils.lerp(bottom, top, yy-iy) - 128;
    }
    for (let y = 0; y < height; y++) {
      const v = clamp((y - 3) / (height - 7), 0, 1);
      for (let x = 0; x < width; x++) {
        const tile = Math.floor(x / tileWidth);
        const u = clamp(((x % tileWidth) - 3) / (tileWidth - 7), 0, 1);
        const side = 2 * u - 1, s = Math.abs(side);
        let value, warmth, relief, rough, transmit, reverseRelief, reverseRough;
        if (tile === 3) {
          const strand = Math.cos(u * 6 * Math.PI + .38 * Math.sin(18*v));
          value = -7 + 9*v + 5*strand;
          warmth = 2*v;
          relief = 119 + 12*strand;
          rough = 166 + 12*v;
          transmit = 94 + 131*v - 10*strand;
        } else {
          const uPhoto = tile === 2 ? 1-u : u;
          const vPhoto = type === 'tigerVallisneria' ? .04*tile + v*(1-.05*tile) : v;
          const photoY = photograph(tile % photo.count, uPhoto, vPhoto, 0);
          const photoChroma = photograph(tile % photo.count, uPhoto, vPhoto, 1);
          const leaf = Math.sin(Math.PI*v);
          const midline = Math.abs(side - .021 * Math.sin(v*8+tile)*leaf);
          let rib = (1 - smooth(midline, .013, .075)) * (.94 - .47*v);
          let vein = 0, pigment = 0, rim = 0;
          if (type === 'tigerVallisneria') {
            const cross = u + .007*Math.sin(v*15+tile) + .004*Math.sin(v*39+tile*2);
            const station = 11*(1-Math.abs(1-((v*3.7+.198+tile*.48)%2)));
            const sample = Math.min(10,Math.floor(station));
            for (let j = 0; j < tigerStriae.length; j++) {
              const edge = Math.abs(cross-tigerStriae[j]);
              if (edge < .018) {
                const range = THREE.MathUtils.lerp(tigerContrast[sample][j],
                  tigerContrast[sample+1][j],station-sample);
                vein = Math.max(vein,(1-smooth(edge,.002,.018))*(.16+.88*smooth(range,3,100)));
              }
            }
            vein *= smooth(v,.035,.17) * (1-.55*smooth(v,.965,1));
            // Two offset tracks of short pigment dashes, measured on a live 'Tiger' blade.
            // The median dash spans 0.14 of the blade's width and is only 0.027 widths thick.
            const lane = side<0 ? 0 : 1;
            const stripe = v*(88+5*tile) + lane*.47 + .46*Math.sin(17*v+lane+tile)
              + .22*Math.sin(39*v+tile) + .12*side;
            const row = Math.round(stripe), key = row*14.73+tile*32.4+lane*27.7;
            const center = (lane ? 1 : -1)*(.14+.58*(.5+.5*Math.sin(1.39*key)));
            const halfSpan = .09+.15*(.5+.5*Math.sin(2.43*key));
            const local = (side-center)/halfSpan;
            const bentRow = stripe-row + local*(.035+.085*Math.sin(.62*key))
              + .046*Math.sin(2.3*local+key);
            const dash = (1-smooth(Math.abs(bentRow),.022,.087))
              * (1-smooth(Math.abs(local),.56,1.13));
            pigment = dash*smooth(v,.035,.19)*(.48+.52*Math.sin(key*1.57)**2) *
              (1-.58*smooth(v,.91,1));
            rim = smooth(s, .89,.99);
          } else {
            // Lateral veins arc away from the midrib and become fine before the rounded margin.
            const contour = Math.hypot(side, 2*v-1);
            const branch = (type === 'redRootFloater' ? 6.4 : 3.1) * (v - .15*s - .10*s*s)
              + .16*Math.sin(6*v + tile*.73) + .17*side;
            const distance = Math.abs(branch - Math.round(branch));
            vein = (1-smooth(distance,.014,.086)) * smooth(s,.035,.18) *
              (1-smooth(contour,.71,.98)) * smooth(v,.06,.25);
            rib *= 1 - smooth(v, .78,.99);
            rim = smooth(contour,.87,1);
            if (type === 'redRootFloater') pigment = rim*(.35+.34*tile) + .13*Math.max(0, photoChroma/42);
          }
          const ribbon = type === 'tigerVallisneria';
          const floater = type === 'redRootFloater';
          value = photoY*(ribbon ? .70 : floater ? .38 : .50) + 10*rim
            + 16*rib + (floater ? -21 : ribbon ? 21 : 13)*vein - (ribbon ? 60 : 8)*pigment;
          warmth = photoChroma*.43 + (ribbon ? 21 : 22)*pigment;
          relief = 121 + photoY*(floater ? .26 : .12) + (floater ? -19 : 24)*rib
            + (ribbon ? 34*(1-.36*pigment) : 14)*vein;
          rough = (floater ? 179 : ribbon ? 128 : 148) - 11*rib + (ribbon ? -53 : 9)*vein
            + photoY*.28 + (ribbon ? 27*pigment : 0);
          transmit = (floater ? 150 : 193) + 32*rim - 82*rib - 41*vein - 47*pigment + photoY*.40;
          if (ribbon) {
            // Inferred reverse: a broad, shallow keel and softer striae under the same pigment.
            const keel = (1-smooth(midline,.018,.14)) * (.85-.40*v);
            reverseRelief = 121 + .13*photoY + 38*keel + 23*vein*(1-.63*pigment);
            reverseRough = 159 + .22*photoY - 16*keel - 44*vein + 22*pigment;
            transmit = 164 + 76*smooth(s,.50,.98) - 65*keel - 41*vein - 126*pigment + .46*photoY;
          }
        }
        const i = (y*width+x)*4;
        colors[i] = byte(224+value+warmth);
        colors[i+1] = byte(231+value-warmth*.35);
        colors[i+2] = byte(214+value*.82-warmth*.45);
        if (bladePixels && tile !== 3) {
          const n = photo.blade.side;
          const k = (Math.round(v*(n-1))*n + Math.round(u*(n-1)))*3;
          // Preserve the observed relative colour of the midrib, scars and marginal tissue.
          // Vertex tint still varies with the age of the shoot and the water lighting.
          for (let ch=0;ch<3;ch++) {
            colors[i+ch] = byte(6 + .95*bladePixels[k+ch] + .12*(colors[i+ch]-216));
          }
        }
        colors[i+3] = byte(transmit);
        surface[i] = byte(relief);
        surface[i+1] = byte(rough);
        surface[i+2] = byte(reverseRelief ?? 0);
        surface[i+3] = byte(reverseRough ?? 255);
      }
    }
    function imageMap(data, colorSpace) {
      const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
      map.colorSpace = colorSpace;
      map.generateMipmaps = true;
      map.magFilter = THREE.LinearFilter;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.anisotropy = 8;
      map.needsUpdate = true;
      return map;
    }
    const albedo = imageMap(colors, THREE.SRGBColorSpace);
    const relief = imageMap(surface, THREE.NoColorSpace);
    const material = makeLeafMaterial(albedo, relief, true);
    if (type === 'tigerVallisneria') material.defines.AQUARIUM_TIGER_BLADE = 1;
    material.defines.LEAF_MARK_LENGTH = type === 'tigerVallisneria' ? '0.007' : '0.045';
    material.name = type + 'LeafSurface';
    material.bumpScale = profile.relief;
    material.roughness = 1;
    material.roughnessMap = relief;
    material.vertexColors = true;
    return material;
  }

  function coloredVertex(surface, point, color, flex, angle, transmission = 1) {
    addVertex(surface, point.x, point.y, point.z, flex, angle * .3, angle);
    surface.colors.push(color.r, color.g, color.b);
    surface.optics.push(transmission,surface.wearSeed || 0);
  }

  // A cupped blade with an indented base. Local coordinates start at the petiole.
  function addRoundLeaf(surface, base, angle, length, width, lift, cup, notch, color, flex) {
    const start = surface.positions.length / 3;
    const floating = notch > .1;
    const measured = window.AQUARIUM_LEAF_PHOTOS[surface.profile.source].blade;
    const segments = surface.compact ? Math.ceil(measured.outline.length / 2) : measured.outline.length;
    const rings = surface.compact ? 2 : floating ? 8 : 4;
    const phase = angle*2.7 + length*651;
    const tile = Math.floor((Math.abs(angle)*4.39 + length*2151) % 3);
    const damaged = tile !== 0 && Math.sin(phase*26.73 + length*170.32) > .80;
    surface.wearSeed = damaged ? 1+Math.abs(phase) : 0;
    const [ca,cs] = measured.center;
    const [minA,maxA,minS,maxS] = measured.bounds;
    const aspect = tile === 0 ? 1 : THREE.MathUtils.clamp(width/length/(floating?.57:.48),.90,1.12);
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const shade = color.clone(), point = new THREE.Vector3();
    const scarTint = new THREE.Color(floating ? '#9b7146' : '#a0ac59');
    function vertex(along, across, radius, scar = 0) {
      const side = across / Math.max(Math.abs(minS),Math.abs(maxS));
      const pocket = floating ? .17*length*(1-radius**3)*Math.sin(Math.PI*Math.min(1,Math.abs(side)))**1.3 : 0;
      const fold = floating ? 0 : length*.040*(1-radius*radius)*(1-Math.abs(side));
      const roll = radius*radius*cup*side*side;
      const wave = tile === 0 ? 0 : .026*length*radius**3*Math.sin(6*along+phase)*side;
      point.set(base.x+length*(dx*along-dz*across*aspect),
        base.y+lift*along+roll+pocket+fold+wave,
        base.z+length*(dz*along+dx*across*aspect));
      shade.setRGB(1,1,1).lerp(color,tile === 0 ? .04 : floating ? .39 : .17).lerp(scarTint,scar*.53);
      coloredVertex(surface,point,shade,flex,angle,1-.34*scar);
      surface.uvs.push(...leafUv(surface.profile,tile,(across-minS)/(maxS-minS),(along-minA)/(maxA-minA)));
    }
    vertex(ca,cs,0);
    for (let ring = 1; ring <= rings; ring++) {
      const radius = ring / rings;
      for (let i = 0; i < segments; i++) {
        const [tip,edge] = measured.outline[Math.floor(i * measured.outline.length / segments)];
        const scar = damaged && i===Math.floor(segments*.73) ? radius**4 : 0;
        const r = radius*(1-.13*scar);
        vertex(ca+(tip-ca)*r,cs+(edge-cs)*r,radius,scar);
        const current = start + 1 + (ring - 1) * segments + i;
        const next = start + 1 + (ring - 1) * segments + (i + 1) % segments;
        if (ring === 1) surface.indices.push(start, next, current);
        else surface.indices.push(current - segments, next, current, current - segments, next - segments, next);
      }
    }
    if (floating) {
      // Hairline rolled margin of an air-pocketed floating leaf. It remains
      // visible edge-on, while the thin submerged carpet blades stay lighter.
      const rim = start + 1 + (rings-1)*segments;
      const lower = surface.positions.length/3;
      const thickness = .00015 + .00009*Math.sin(phase)**2;
      for (let i=0; i<segments; i++) {
        const source = rim+i, offset = source*3;
        point.fromArray(surface.positions, offset);
        point.x += (base.x + dx*length*.48 - point.x)*.017;
        point.z += (base.z + dz*length*.48 - point.z)*.017;
        point.y -= thickness;
        shade.fromArray(surface.colors, offset).multiplyScalar(.93);
        coloredVertex(surface, point, shade, flex, angle, .79);
        surface.uvs.push(surface.uvs[source*2],surface.uvs[source*2+1]);
        const next = (i+1)%segments;
        surface.indices.push(rim+i, rim+next, lower+i, rim+next, lower+next, lower+i);
      }
    }
    surface.wearSeed = 0;
  }

  // Runners and submerged root filaments share one mesh with the leaves.
  function addStem(surface, points, radius, color, flex, angle, startFlex = 0, endRadius = .18, tipColor = color) {
    const start = surface.positions.length / 3;
    const direction = points[points.length - 1].clone().sub(points[0]).normalize();
    const reference = Math.abs(direction.y) > .8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
    const point = new THREE.Vector3();
    const tint = new THREE.Color();
    const sides = surface.compact || radius < .00016 ? 3 : radius < .0004 ? 4 : radius < .001 ? 6 : 9;
    points.forEach((center, i) => {
      const t = i / (points.length - 1);
      tangent.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(0, i - 1)]).normalize();
      side.crossVectors(reference, tangent).normalize();
      up.crossVectors(tangent, side);
      const width = radius * (1 + (endRadius-1)*t) * (1 + .063*Math.sin(13*t+angle)*Math.sin(Math.PI*t));
      tint.copy(color).lerp(tipColor,t);
      for (let lane = 0; lane < sides; lane++) {
        const a = lane * Math.PI * 2 / sides;
        point.copy(center).addScaledVector(side, width * Math.cos(a)).addScaledVector(up, width * Math.sin(a));
        coloredVertex(surface, point, tint, startFlex + (flex - startFlex) * t, angle, .78 + .42*t);
        if (surface.profile) surface.uvs.push(...leafUv(surface.profile, 3, lane / sides, t));
        else surface.uvs.push(lane/sides, t);
        if (i === 0) continue;
        const v = start + i * sides + lane, next = start + i * sides + (lane + 1) % sides;
        surface.indices.push(v - sides, next - sides, v, next - sides, next, v);
      }
    });
  }

  const rootIvory = new THREE.Color('#d3c29f');
  const rootOchre = new THREE.Color('#a68c5b');

  function addAnchors(surface, origin, random, count, reach, radius, angle) {
    for (let k=0; k<count; k++) {
      const heading = angle + k*2.4 + .65*random();
      const dx = Math.cos(heading), dz = Math.sin(heading);
      const length = reach*(.43 + .72*random());
      const kink = (.12 + .13*random()) * length;
      const curved = origin.clone().add(new THREE.Vector3(dx*length*.42, -.0014, dz*length*.42));
      curved.y = Math.max(.0006, curved.y);
      const knuckle = new THREE.Vector3(origin.x+dx*length*.76-dz*kink,
        Math.min(.0005,curved.y-.001), origin.z+dz*length*.76+dx*kink);
      const tip = new THREE.Vector3(origin.x+dx*length-dz*kink,
        -.0025-length*.23,origin.z+dz*length+dx*kink);
      const main = new THREE.CatmullRomCurve3([origin,curved,knuckle,tip]).getPoints(surface.compact ? 3 : 8);
      addStem(surface,main,radius*(.58+.46*random()),rootOchre,.03,heading,0,.12,rootIvory);
      if (surface.compact) continue;
      const fork = new THREE.Vector3(curved.x+(.25*dx-.36*dz)*length,
        -.0019,curved.z+(.25*dz+.36*dx)*length);
      const halfway = curved.clone().lerp(fork,.5);
      halfway.x -= dz*length*.063;halfway.z += dx*length*.063;
      addStem(surface.fibers,[curved,halfway,fork],radius*.38,rootIvory,.025,heading);
    }
  }

  function addCarpet(surface, random, variant) {
    const runners = [15, 20, 17][variant];
    const dark = new THREE.Color('#548c39'), light = new THREE.Color('#a4cf65');
    const stem = new THREE.Color('#839950');
    const nodeColor = new THREE.Color('#aabd73');
    const colonies = [[-.018,.007,.012], [.016,-.012,.006], [-.001,-.025,.016]];
    for (let i = 0; i < runners; i++) {
      const [colonyX,colonyZ,crown] = colonies[(i+variant)%colonies.length];
      const azimuth = i * 2.40 + random() * .95;
      const originX = colonyX + (random() - .5) * .023, originZ = colonyZ + (random() - .5) * .024;
      const nodes = 6 + Math.floor(random() * 6);
      const reach = (.037 + .037 * random()) * [1, 1.14, .84][variant];
      const bend = (random() - .5)*1.85;
      const ridge = .002 + random() * .008;
      const shoot = random() < .31 ? .006 + .004*random() : .003;
      const elbow = random()*Math.PI*2;
      const path = [];
      for (let j = 0; j < nodes; j++) {
        const t = j / (nodes - 1), angle = azimuth + bend*t + .24*Math.sin(6.2*t+elbow);
        const reachAt = reach * (.75*t + .25*t*t);
        const point = new THREE.Vector3(originX + reachAt * Math.cos(angle),
          .0014 + .36*crown*(1-t)**1.7 + .73*ridge*Math.sin(Math.PI*t) + shoot*t**3,
          originZ + .75 * reachAt * Math.sin(angle));
        path.push(point);
        const size = (.005 + .0034 * random()) * (1 - .32 * t ** 6);
        const color = dark.clone().lerp(light, .23 + .63 * random());
        for (const sign of [-1, 1]) {
          const leafAngle = angle + sign * (1.04 + random() * .65);
          const petiole = point.clone().add(new THREE.Vector3(.0012*Math.cos(leafAngle),.0008,.0012*Math.sin(leafAngle)));
          addStem(surface,[point,petiole],.00025,nodeColor,.13,leafAngle,.07,.75, color);
          addRoundLeaf(surface, petiole, leafAngle, size,
            size * .48, size * (.4 + .63 * random()), .00055, .035, color, .16);
        }
        if (j < nodes-2 && (j+i)%3===0) {
          const lip = point.clone().add(new THREE.Vector3(.00065*Math.cos(angle), .00012, .00065*Math.sin(angle)));
          addStem(surface,[point,lip],.00059,nodeColor,.075,angle,.07,.77);
          addAnchors(surface,point,random,2,.0075,.00032,angle+1.3);
        }
      }
      const apex = path[nodes-1];
      addRoundLeaf(surface, apex, azimuth+.38, .0036, .0016, .0032, .0004, .04, light, .18);
      addStem(surface, path, .00046, stem, .07, azimuth,.035,.63,nodeColor);
    }
  }

  // Width / full blade width, sampled along the photographed 392-pixel midrib.
  const ribbonWidths = [[0,.17],[.089,.33],[.196,.50],[.281,.75],[.357,.83],
    [.510,1],[.65,1],[.815,.92],[.893,.92],[.944,.75],[.969,.67],[.982,.58],[.995,.33],[1,.03]];
  function ribbonWidthAt(v) {
    let i = 1;
    while (i < ribbonWidths.length-1 && ribbonWidths[i][0] < v) i++;
    const [a,start] = ribbonWidths[i-1], [b,end] = ribbonWidths[i];
    return THREE.MathUtils.lerp(start,end,(v-a)/(b-a));
  }

  // Two margins of one mature 'Tiger' leaf in Tropica's rotating specimen.
  // Each row stores length/across pairs, in units of the width at the join.
  const tigerTipStations = [
    [.1719,-.5000, -.1719,.5000], [.8011,-.4863, .4662,.4881],
    [1.8142,-.4829, 1.4981,.4371], [2.5457,-.3976, 2.2736,.3939],
    [3.0430,-.3690, 2.7959,.3500], [3.3864,-.2613, 3.1978,.2874],
    [3.6388,-.1843, 3.4858,.2610], [3.8037,0, 3.8037,0],
  ];

  // Monotone cubic interpolation retains every photographed margin station and
  // does not protrude beyond adjacent measurements when an edge turns.
  const tigerTipDistance = tigerTipStations.map(row => (row[0]+row[2])*.5);
  const tigerTerminal = [];
  for (let i=0; i<tigerTipStations.length-1; i++) {
    const length = tigerTipDistance[i+1]-tigerTipDistance[i];
    const slope = (j,k) => (tigerTipStations[j+1][k]-tigerTipStations[j][k]) /
      (tigerTipDistance[j+1]-tigerTipDistance[j]);
    const tangent = (j,k) => {
      if (j===0) return slope(0,k);
      if (j===tigerTipStations.length-1) return slope(j-1,k);
      const left=slope(j-1,k), right=slope(j,k);
      if (left*right<=0) return 0;
      const before=tigerTipDistance[j]-tigerTipDistance[j-1], after=tigerTipDistance[j+1]-tigerTipDistance[j];
      return 3*(before+after)/((before+2*after)/left+(2*before+after)/right);
    };
    for (let sub=0; sub<5; sub++) {
      const t=sub/5, blend=t*t*(3-2*t);
      tigerTerminal.push(tigerTipStations[i].map((a,k) => THREE.MathUtils.lerp(a,tigerTipStations[i+1][k],blend)
        + length*t*(1-t)*((1-t)*tangent(i,k)-t*tangent(i+1,k))));
    }
  }
  tigerTerminal.push(tigerTipStations.at(-1));

  function blendMeasuredJoin(surface, first, lanes, join) {
    const read = (row,lane) => new THREE.Vector3().fromArray(surface.positions,3*(first+row*lanes+lane));
    for (let lane=0; lane<lanes; lane++) {
      const lower=read(join-5,lane), upper=read(join,lane);
      const incoming=lower.clone().sub(read(join-6,lane)).multiplyScalar(5);
      const outgoing=read(join+1,lane).sub(upper).setLength(lower.distanceTo(upper));
      for (let k=1; k<5; k++) {
        const t=k/5;
        lower.clone().lerp(upper,t*t*(3-2*t))
          .addScaledVector(incoming,t*(1-t)**2).addScaledVector(outgoing,-t*t*(1-t))
          .toArray(surface.positions,3*(first+(join-5+k)*lanes+lane));
      }
    }
  }

  function addRibbonClump(surface, random, variant) {
    const dark = new THREE.Color('#396c2c'), light = new THREE.Color('#94b950');
    const color = new THREE.Color(), point = new THREE.Vector3();
    const sheath = new THREE.Color('#c1bf8a'), collar = new THREE.Color('#a4ad68');
    const dryTip = new THREE.Color('#ad9560');
    const clumpCount = [2, 3, 2][variant], rows = 56, lanes = 5;
    let previousCrown;
    for (let clump = 0; clump < clumpCount; clump++) {
      const baseX = (clump - (clumpCount - 1) / 2) * .038, baseZ = (random() - .5) * .022;
      const crown = new THREE.Vector3(baseX,.0038,baseZ);
      addAnchors(surface,crown,random,6,.021,.00080,clump*.86);
      if (previousCrown) {
        const midpoint = previousCrown.clone().lerp(crown,.55);
        midpoint.z += .0055;
        midpoint.y = .0017;
        const runner = new THREE.CatmullRomCurve3([previousCrown,midpoint,crown]).getPoints(9);
        addStem(surface,runner,.00075,collar,.008,.2,0,.79,sheath);
        addAnchors(surface,midpoint,random,2,.0065,.00044,-1.0);
      }
      previousCrown = crown;
      const blades = 7 + Math.floor(random() * 4);
      for (let j = 0; j < blades; j++) {
        const angle = j * 2.40 + random() * .5;
        const dx = Math.cos(angle), dz = Math.sin(angle);
        const juvenile = j%4===2;
        const height = (juvenile ? .14 + .09*random() : .29 + .115*random()) * [1,.88,1.08][variant];
        const arc = .024 + random() * .056, halfWidth = juvenile ? .003+.002*random() : .0054+.0029*random();
        const phase = random() * 6.28, tipTurn = .18 + .68 * random();
        const tint = .30 + .53 * random();
        const aged = j === 1 || (j===5 && clump%2===1);
        surface.wearSeed = aged ? 1 + phase + clump*3.57 : 0;
        const scarAt = .62 + .19*random();
        const scarSide = Math.cos(phase)>0?1:-1;
        const first = surface.positions.length / 3;
        const measured = j === 3 && clump === 0;
        const join = 50, last = measured ? join + tigerTerminal.length-1 : rows;
        const axis = new THREE.Vector3(), acrossDirection = new THREE.Vector3();
        for (let row = 0; row <= last; row++) {
          const tip = measured && row >= join ? tigerTerminal[row-join] : null;
          const t = (tip ? join : row) / rows;
          const bladeT = tip ? t + (1-t)*(tip[0]+tip[2])/(2*tigerTerminal.at(-1)[0]) : t;
          const sheathBlend = 1-THREE.MathUtils.smoothstep(t, .012,.10);
          const forward = .0019 + .0041*(1-sheathBlend) + arc * t ** 1.45;
          const flow = .054 * t ** 2 + .014 * t * Math.sin(4 * t + phase);
          const cx = baseX + dx * forward + flow, cz = baseZ + dz * forward + .20 * flow;
          const y = -.0014 + height * (t - .16 * t ** 5);
          const twist = angle + tipTurn * t + .30 * Math.sin(5 * t + phase);
          const width = halfWidth * ribbonWidthAt((t-.16*t**5)/.84);
          if (tip) {
            acrossDirection.set(-Math.sin(twist),0,Math.cos(twist));
            const bend = 1.45*arc*t**.45;
            const drag = .108*t + .014*Math.sin(4*t+phase) + .056*t*Math.cos(4*t+phase);
            axis.set(dx*bend+drag, height*(1-.8*t**4), dz*bend+.20*drag);
            axis.addScaledVector(acrossDirection,-axis.dot(acrossDirection)).normalize();
            if (row === join) surface.referenceTip = { start: surface.positions.length/3, lanes, rows: tigerTerminal.length };
          }
          const apex = tip && row === last;
          for (let lane = 0; lane < (apex ? 1 : lanes); lane++) {
            const s = apex ? 0 : 2*lane/(lanes-1)-1, u = (s+1)/2;
            const nick = aged && s*scarSide>0 ? Math.max(0, 1 - Math.abs(t-scarAt)/.031)*Math.abs(s)**3 : 0;
            const across = tip ? 2*width*THREE.MathUtils.lerp(tip[1],tip[3],u) : s*width*(1-.39*nick);
            const keel = tip ? .00067*(1-s*s)*(tip[3]-tip[1]) :
              .00067*(1-s*s) - sheathBlend*.0027*s*s + width*.058*Math.sin(11*t+phase)*s;
            const brokenTip = aged ? .0022*t**18*(.6+.4*s) : 0;
            point.set(cx - Math.sin(twist)*across + Math.cos(twist)*keel, y-brokenTip,
              cz + Math.cos(twist)*across + Math.sin(twist)*keel);
            if (tip) point.addScaledVector(axis,2*width*THREE.MathUtils.lerp(tip[0],tip[2],u));
            color.copy(dark).lerp(light, tint * (.50 + .50 * bladeT)).multiplyScalar(.96+.08*(1-s*s));
            color.lerp(sheath,.80*sheathBlend).lerp(dryTip, aged ? .42*bladeT**16 + .27*nick : 0);
            coloredVertex(surface, point, color, 1.05 * bladeT, angle, .92+.10*Math.abs(s)-.29*sheathBlend-.15*nick);
            surface.uvs.push(...leafUv(surface.profile, j % 3, u, bladeT));
            if (apex) {
              const peak = surface.positions.length/3-1;
              for (let edge = peak-lanes; edge < peak-1; edge++) surface.indices.push(edge,edge+1,peak);
              break;
            }
            if (row > 0 && lane < lanes-1) {
              const v = first + row * lanes + lane;
              surface.indices.push(v-lanes,v-lanes+1,v, v-lanes+1,v+1,v);
            }
          }
        }
        if (measured) blendMeasuredJoin(surface,first,lanes,join);
        surface.wearSeed = 0;
      }
    }
  }

  function addFloaters(surface, random, variant) {
    const fresh = new THREE.Color('#84ad61'), gold = new THREE.Color('#aa9c63'), red = new THREE.Color('#ab584d');
    const roots = new THREE.Color('#a85556'), tips = new THREE.Color('#dda78a');
    const rootNeck = new THREE.Color('#a66559'), juvenile = new THREE.Color('#dbb8a1');
    const stolon = new THREE.Color('#83704d');
    const branches = [3, 5, 4][variant];
    const occupied = [];
    for (let b = 0; b < branches; b++) {
      const angle = b * 2.40 + .55 * random();
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const originX = .007*Math.cos(angle) + (random()-.5)*.010;
      const originZ = .006*Math.sin(angle) + (random()-.5)*.012;
      const reach = .030 + .029 * random(), nodes = 6 + Math.floor(random() * 3);
      const path = [];
      for (let j = 0; j < nodes; j++) {
        const t = j / (nodes - 1), sway = .009*Math.sin(4.1*t+b) + .003*t*Math.sin(8*t);
        const base = new THREE.Vector3(originX + dx*reach*t - dz*sway,
          .0005 + .00045*Math.sin(8*t + b), originZ + dz*reach*t + dx*sway);
        path.push(base);
        const size = (.0115 + random() * .0055) * (1 - .20 * t ** 5);
        const blush = THREE.MathUtils.clamp(.04 + .20*variant + .56*(1-t) + .29*(random()-.5),0,1);
        const color = fresh.clone().lerp(gold, THREE.MathUtils.smoothstep(blush, .16, .50))
          .lerp(red, THREE.MathUtils.smoothstep(blush, .38, .84));
        const preferred = angle + (j % 2 ? 1 : -1)*(.74+.95*random()) + .33*Math.cos(t*5);
        // Sessile floating leaves fan out on the surface. Avoid intersecting adjacent blades.
        const leafRadius = .54*size;
        let leafAngle = preferred, best = -Infinity, leafCenterX, leafCenterZ;
        for (const turn of [0,.42,-.42,.92,-.92,1.48,-1.48]) {
          const candidate = preferred+turn;
          const x = base.x + .50*size*Math.cos(candidate), z = base.z + .50*size*Math.sin(candidate);
          let gap = 1;
          for (const disk of occupied) gap = Math.min(gap, Math.hypot(x-disk.x,z-disk.z)/(leafRadius+disk.radius));
          if (gap <= best) continue;
          best = gap; leafAngle = candidate; leafCenterX = x; leafCenterZ = z;
          if (gap > .97) break;
        }
        if (best < .73) continue;
        occupied.push({x: leafCenterX, z: leafCenterZ, radius:leafRadius});
        const young = t**4;
        addRoundLeaf(surface, base, leafAngle, size,
          size * (.54+.12*random()), .0007 + .0020*random() + .004*young,
          .0015 + .0012*random() + .002*young, .22, color, .09);
        const petioleEnd = new THREE.Vector3(base.x + .00075 * Math.cos(leafAngle), base.y + .0003,
          base.z + .00075 * Math.sin(leafAngle));
        addStem(surface, [base, petioleEnd], .00074, color, .09, leafAngle,.04,.70);
        const socket = base.clone().add(new THREE.Vector3(.00035*dx,-.00105,.00035*dz));
        addStem(surface,[base,socket], .0010,stolon,.05,angle,.04,.79,rootNeck);
        const filaments = 3 + Math.floor(random() * 6 * (1-.68*young));
        const age = (.48+.52*random())*(1-.78*young);
        for (let k = 0; k < filaments; k++) {
          const a = random()*Math.PI*2, truncated = young < .25 && k===1 && (j+b)%4===1;
          const depth = (.026 + .035*random())*age*(truncated?.46:1);
          const spread = .002 + .010*random()*age;
          const birth = socket.clone().add(new THREE.Vector3(.00045*Math.cos(a),0,.00045*Math.sin(a)));
          const filament = [birth];
          for (let step = 1; step <= 5; step++) {
            const f = step / 5;
            const bend = .0032*Math.sin(Math.PI*f)*Math.sin(5.7*f+a)*age;
            filament.push(new THREE.Vector3(birth.x + spread*f*Math.cos(a) + .010*age*f*f + bend,
              birth.y - depth * f, birth.z + spread*f*Math.sin(a) + .0037*age*f*f - .46*bend));
          }
          const axis = new THREE.CatmullRomCurve3(filament).getPoints(10);
          addStem(surface, axis, .00024 + .00016 * random(), roots, .65, angle, .04,truncated?.56:.13,
            young>.55?juvenile:tips);
          // A tapering fringe follows the thicker root axis, with short juvenile roots near the tip.
          for (let step = 1; step < 5; step++) {
            const p = filament[step];
            const jointFlex = .65 * step / 5;
            for (let side = 0; side < 2; side++) {
              const direction = a + (step*2 + side)*2.4;
              const reach = (.0024 + .0022*Math.sin(step+a)**2)*(1-.10*step);
              const fx = Math.cos(direction), fz = Math.sin(direction);
              const mid = new THREE.Vector3(p.x+reach*.61*fx, p.y-reach*.21, p.z+reach*.61*fz);
              const end = new THREE.Vector3(p.x+reach*fx+.001, p.y-reach*(1.1+.35*side), p.z+reach*.94*fz);
              const lateral = new THREE.QuadraticBezierCurve3(p,mid,end).getPoints(4);
              addStem(surface.fibers,lateral,.000092+.000048*(1-step/5),tips,jointFlex+.04,angle,jointFlex,.10,juvenile);
            }
          }
        }
      }
      addStem(surface, path, .00068, stolon, .055, angle, .035,.55);
    }
  }

  // U. graminifolia has narrow, three-veined leaves at the nodes of creeping stolons.
  function addBladderwort(surface, random, variant) {
    const point = new THREE.Vector3(), shade = new THREE.Color();
    const baseColor = new THREE.Color('#61803b'), newGrowth = new THREE.Color('#abc96a');
    const stolon = new THREE.Color('#879659');
    const lanes = surface.compact ? [-1, 0, 1] : [-1, -.55, -.43, 0, .43, .55, 1];
    const rows = surface.compact ? 4 : 7;
    for (let runner = 0; runner < 11 + variant; runner++) {
      const heading = runner * 2.4 + random() * .6;
      let x = .018 * Math.cos(heading) * random(), z = .015 * Math.sin(heading) * random();
      const path = [];
      const nodes = 4 + Math.floor(random()*4);
      for (let node = 0; node < nodes; node++) {
        path.push(new THREE.Vector3(x, -.0006, z));
        const leaves = 2 + Math.floor(random()*3);
        for (let leaf = 0; leaf < leaves; leaf++) {
          const angle = heading + .48 + leaf*2.40 + random();
          const dx = Math.cos(angle), dz = Math.sin(angle);
          const length = .009 + random()*.011, halfWidth = .00052 + random()*.00075;
          const lean = .24 + random()*.55, tint = random()*.21;
          const start = surface.positions.length/3;
          for (let row = 0; row <= rows; row++) {
            const t = row/rows, run = length*lean*t*(.28+.72*t);
            const width = halfWidth*(.16+.84*Math.sin(Math.PI*t**1.38)**.58)*(row === rows ? .14 : 1);
            for (let i = 0; i < lanes.length; i++) {
              const lane = lanes[i], vein = Math.abs(lane) <= .43;
              const fold = width*((1-Math.abs(lane))*.12 + (vein ? .07 : 0));
              point.set(x+dx*(run+fold)-dz*width*lane, -.0004 + length*t*(1-.21*lean*t), z+dz*(run+fold)+dx*width*lane);
              shade.copy(baseColor).lerp(newGrowth,.17+.50*t+tint).multiplyScalar(vein ? 1.045 : .97);
              coloredVertex(surface,point,shade,t*.34,angle);
              surface.uvs.push((lane+1)/2,t);
              if (row && i) {
                const j = start+row*lanes.length+i, k = j-lanes.length;
                surface.indices.push(k-1,j-1,j,k-1,j,k);
              }
            }
          }
        }
        x += (.004 + random()*.002)*Math.cos(heading + .3*Math.sin(node));
        z += (.004 + random()*.002)*Math.sin(heading + .3*Math.sin(node));
      }
      addStem(surface,path,.00024,stolon,0,heading,0,.48);
    }
  }

  // Hornwort's forked leaves grow in whorls around flexible, rootless shoots.
  function addHornwort(surface, random, variant) {
    const stem = new THREE.Color('#647f42'), green = new THREE.Color('#527c37');
    const fresh = new THREE.Color('#b1ca63'), axis = new THREE.Vector3();
    const stems = [
      { x: -.020, z: -.012, height: .473, lean: -.136, depth: .022, nodes: 45 },
      { x: .018, z: -.016, height: .326, lean: .048, depth: -.018, nodes: 34 },
      { x: .002, z: .022, height: .209, lean: -.038, depth: .022, nodes: 24 },
    ];
    for (const [index, shoot] of stems.entries()) {
      const shootStart = surface.positions.length;
      const path = [], phase = index * 1.6 + variant * .67;
      const height = shoot.height * (1 - .035*variant);
      for (let i = 0; i <= shoot.nodes; i++) {
        const u = i/shoot.nodes;
        const t = 1 - (1-u)**1.85;
        const bend = t*t*(.48+.52*t);
        path.push(new THREE.Vector3(
          shoot.x + shoot.lean*bend + .013*t*Math.sin(4.5*t+phase),
          -.005 + height*t,
          shoot.z + shoot.depth*t + .012*t*Math.sin(5*t+phase)));
      }
      const sway = .83 - index*.16;
      addStem(surface,path,.00155,stem,sway,phase,0,.24,fresh);
      for (let i = 1; i < path.length; i++) {
        const u = i/shoot.nodes, center = path[i], flex = sway*u;
        axis.subVectors(path[Math.min(i+1,shoot.nodes)],path[i-1]).normalize();
        const lateral = new THREE.Vector3().crossVectors(axis,new THREE.Vector3(0,0,1)).normalize();
        const across = new THREE.Vector3().crossVectors(axis,lateral);
        const crown = THREE.MathUtils.smoothstep(u, .27, .67);
        const count = 7 + Math.round(4*crown) + Math.floor(random()*3);
        const tint = green.clone().lerp(fresh,.08+.34*u*u+.09*random());
        const bud = Math.min(1,(1-u)*6);
        for (let j = 0; j < count; j++) {
          const angle = i*2.40 + phase + (j+.23*random())*2*Math.PI/count;
          const radial = lateral.clone().multiplyScalar(Math.cos(angle)).addScaledVector(across,Math.sin(angle));
          const side = new THREE.Vector3().crossVectors(axis,radial);
          const length = (.021+.008*random())*(1+.54*crown)*(.22+.78*bud);
          const lift = .22+.22*random()+.28*crown+.48*(1-bud);
          const fork = center.clone().addScaledVector(radial,.44*length).addScaledVector(axis,.34*length*lift);
          const width = .00095 + .00060*crown;
          addStem(surface,[center,fork],width,tint,flex,phase,flex,.7);
          for (const sign of [-1,1]) {
            const spread = sign*(.14+.10*random());
            const tip = fork.clone().addScaledVector(radial,length*(.46+.17*random()))
              .addScaledVector(side,spread*length).addScaledVector(axis,(lift+.14)*length);
            // A folded, tapered blade keeps the fork legible at tank-view distance.
            const mid = fork.clone().lerp(tip,.48).addScaledVector(axis,-.065*length);
            const start = surface.positions.length / 3;
            const edge = width*(.78+.24*random());
            const points = [fork, mid.clone().addScaledVector(side,-edge),
              mid.clone().addScaledVector(axis,.55*edge), mid.clone().addScaledVector(side,edge), tip];
            const tipTint = tint.clone().lerp(fresh,.29);
            points.forEach((point,k) => coloredVertex(surface,point,k===4 ? tipTint : tint,
              k===0 ? flex : flex+.018,phase));
            surface.uvs.push(.5,0, 0,.48, .5,.48, 1,.48, .5,1);
            surface.indices.push(start,start+1,start+2, start,start+2,start+3,
              start+1,start+4,start+2, start+2,start+4,start+3);
          }
        }
      }
      // Bend each whole shoot through the shared current. The leaves at each
      // height travel with the stem, with the crown following the base later.
      const responsePhase = [-.68, .54, -.14][index] + variant*.17;
      for (let k = shootStart; k < surface.positions.length; k += 3) {
        const level = THREE.MathUtils.clamp(surface.positions[k+1]/height, 0, 1);
        const bend = height*.077*level*level;
        const delay = responsePhase - .95*level;
        const x = bend*Math.cos(delay), z = bend*Math.sin(delay);
        surface.inPhase[k] = x;
        surface.outOfPhase[k] = z;
        surface.inPhase[k+1] = -shoot.lean/height*.28*x;
        surface.outOfPhase[k+1] = -shoot.lean/height*.28*z;
        surface.inPhase[k+2] = .18*x - .11*z;
        surface.outOfPhase[k+2] = .18*z + .11*x;
      }
    }
  }

  const species = new Map([
    ['hornwort', { build: addHornwort, radius: .030, padding: .008, seed: 619 }],
    ['bladderwort', { build: addBladderwort, radius: .038, padding: .0016, seed: 463 }],
    ['monteCarlo', { build: addCarpet, radius: .045, padding: .001, seed: 113 }],
    ['tigerVallisneria', { build: addRibbonClump, radius: .026, padding: .014, seed: 227 }],
    ['redRootFloater', { build: addFloaters, radius: .045, padding: .006, seed: 367 }],
  ]);
  const templates = new Map();
  const patchMaterials = new Map();
  const fiberMaterials = new Map();
  let pickMaterial, pickGeometry;

  function buildPlantPatch(type, variant, compact) {
    const settings = species.get(type);
    const surface = { ...makeSurface(), colors: [], optics: [], profile: leafProfiles[type], compact };
    surface.fibers = { ...makeSurface(), colors: [], optics: [], profile: leafProfiles[type] };
    settings.build(surface, seededRandom(settings.seed + variant * 3953), variant);
    if (!patchMaterials.has(type)) {
      const material = surface.profile ? makePatchMaterial(type) : makeLeafMaterial(null, null);
      material.vertexColors = true;
      patchMaterials.set(type, material);
    }
    const foliage = makeMesh(surface, patchMaterials.get(type), settings.padding);
    if (type === 'hornwort') {
      foliage.geometry.boundingBox.expandByVector(new THREE.Vector3(.038,0,.003));
      foliage.geometry.boundingBox.getBoundingSphere(foliage.geometry.boundingSphere);
    }
    foliage.name = type + 'Foliage';
    if (surface.referenceTip) foliage.geometry.userData.referenceTip = surface.referenceTip;
    const plant = new THREE.Group();
    plant.add(foliage);
    const plantBounds = foliage.geometry.boundingBox.clone();
    if (surface.fibers.positions.length) {
      if (!fiberMaterials.has(type)) {
        const leafMaterial = patchMaterials.get(type);
        const fibers = leafMaterial.clone();
        fibers.onBeforeCompile = leafMaterial.onBeforeCompile;
        fibers.defines = { ...leafMaterial.defines, AQUARIUM_ROOT_HAIR: 1 };
        fibers.transparent = true;
        fibers.depthWrite = false;
        fibers.forceSinglePass = true;
        fibers.name = type + 'FineRoots';
        fiberMaterials.set(type,fibers);
      }
      const rootHairs = makeMesh(surface.fibers, fiberMaterials.get(type), settings.padding);
      rootHairs.name = type + 'FineRoots';
      rootHairs.castShadow = false;
      plant.add(rootHairs);
      plantBounds.union(rootHairs.geometry.boundingBox);
    }
    plant.name = type;
    pickGeometry ??= new THREE.SphereGeometry(1, 12, 8);
    pickMaterial ??= new THREE.MeshBasicMaterial({ visible: false });
    const pick = new THREE.Mesh(pickGeometry, pickMaterial);
    plantBounds.getCenter(pick.position);
    plantBounds.getSize(pick.scale).multiplyScalar(.5);
    plant.add(pick);
    return { plant, plantBounds, plantRadius: settings.radius };
  }

  window.createAquariumPlant = function (type = 'original', variant = 0, { compact = false } = {}) {
    if (!species.has(type)) type = 'original';
    const form = type === 'original' || !Number.isFinite(variant) ? 0 : ((Math.trunc(variant) % 3) + 3) % 3;
    const key = type + '/' + form + (compact ? '/compact' : '');
    if (!templates.has(key)) {
      templates.set(key, type === 'original' ? buildOriginalPlant() : buildPlantPatch(type, form, compact));
    }
    const template = templates.get(key);
    const plant = template.plant.clone();
    const plantPick = plant.children[plant.children.length - 1];
    const animated = plant.children.filter((mesh) => mesh.morphTargetInfluences);
    function updateSway(timeSeconds) {
      // Nearby plants share a travelling current. A slower cross-current
      // changes the angle of the bent blade without moving its rooted base.
      const drift = 4.7 * plant.position.x - 3.1 * plant.position.z;
      const cross = Math.sin(.71 * timeSeconds - 1.8 * drift + .9 * form);
      const phase = 1.42 * timeSeconds - drift + form * 1.7 + .25 * cross;
      const strength = .78 + .22 * Math.sin(.53 * timeSeconds - .73 * drift + .6);
      for (const mesh of animated) {
        mesh.morphTargetInfluences[0] = strength * Math.sin(phase);
        mesh.morphTargetInfluences[1] = strength * Math.cos(phase + .26 * cross);
      }
    }
    return { plant, plantPick, updateSway, plantBounds: template.plantBounds,
      plantRadius: template.plantRadius, isFloating: type === 'redRootFloater' };
  };
})();
