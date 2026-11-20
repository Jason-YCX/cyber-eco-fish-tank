(function () {
  'use strict';

  const tileSize = 0.12;
  const textureSize = 512;
  const texelsPerMillimeter = textureSize / (tileSize * 1000);
  // Grain radii are in millimetres. Both the tile and the loose 3D grains use this palette.
  const beds = {
    original: {
      base: [208, 191, 165], colors: [[182, 172, 154], [202, 182, 156], [216, 197, 172], [227, 215, 192]],
      layers: [[25000, .32, .86, .25], [4700, .53, 1.66, .32]], roundness: .65, relief: 1, flatten: .58,
    },
    soil: { period: .096, wetAlbedoScale: .46, bedDepthScale: .78, residualDepthScale: .57 },
    redSand: { period: .032768 },
    gravel: { period: .082 },
  };
  const cached = new Map();

  function createGrainMaps(bed) {
    const colors = new Uint8Array(textureSize ** 2 * 4);
    const heights = new Float32Array(textureSize ** 2);
    const normals = new Uint8Array(colors.length);
    const { smoothstep } = THREE.MathUtils;
    const base = [...bed.base, 255];
    for (let i = 0; i < colors.length; i += 4) colors.set(base, i);
    let state = 197362;
    function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    }

    function scatterGrains(count, minRadius, maxRadius, heightRatio) {
      for (let i = 0; i < count; i += 1) {
        const centerX = random() * textureSize;
        const centerY = random() * textureSize;
        const radius = minRadius + (maxRadius - minRadius) * random() ** 1.8;
        const span = radius * texelsPerMillimeter;
        const extent = span * 1.2;
        const shortSpan = span * (bed.roundness + (1 - bed.roundness) * random());
        const angle = random() * Math.PI * 2;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const skew = (random() - 0.5) * 0.29;
        const peak = radius * heightRatio * (0.72 + 0.28 * random());
        const mineral = random();
        const color = bed.colors[mineral < .08 ? 0 : mineral < .36 ? 1 : mineral < .80 ? 2 : 3];
        const tint = (random() - 0.5) * 13;

        for (let y = Math.floor(centerY - extent); y <= centerY + extent; y += 1) {
          const dy = y + 0.5 - centerY;
          const row = ((y + textureSize) % textureSize) * textureSize;
          for (let x = Math.floor(centerX - extent); x <= centerX + extent; x += 1) {
            const dx = x + 0.5 - centerX;
            const u = (dx * cosine + dy * sine) / span;
            const v = (dy * cosine - dx * sine) / shortSpan;
            const squared = u * u + v * v;
            if (squared > 1.44) continue;
            const dome = 1 - squared - skew * u * (u * u - 3 * v * v);
            if (dome <= 0) continue;

            const index = row + (x + textureSize) % textureSize;
            const elevation = peak * dome * Math.sqrt(dome);
            const overlap = elevation - heights[index];
            if (overlap <= 0) continue;
            // Round the edges and blend the color where the grains overlap.
            const coverage = smoothstep(dome, 0, 0.50) * smoothstep(overlap, 0, 0.05);
            const offset = index * 4;
            for (let channel = 0; channel < 3; channel += 1) {
              const previous = colors[offset + channel];
              colors[offset + channel] = Math.round(previous + (color[channel] + tint - previous) * coverage);
            }
            heights[index] = elevation;
          }
        }
      }
    }
    for (const layer of bed.layers) scatterGrains(...layer);

    // Use the same grain profile for its shading. Both heights and texel size are in millimeters.
    const span = 2 / texelsPerMillimeter;
    for (let y = 0; y < textureSize; y += 1) {
      const down = ((y + textureSize - 1) % textureSize) * textureSize;
      const up = ((y + 1) % textureSize) * textureSize;
      const row = y * textureSize;
      for (let x = 0; x < textureSize; x += 1) {
        const dx = heights[row + (x + textureSize - 1) % textureSize] - heights[row + (x + 1) % textureSize];
        const dy = heights[down + x] - heights[up + x];
        const length = Math.hypot(dx, dy, span);
        const offset = (row + x) * 4;
        normals[offset] = Math.round(127.5 * (1 + dx / length));
        normals[offset + 1] = Math.round(127.5 * (1 + dy / length));
        normals[offset + 2] = Math.round(127.5 * (1 + span / length));
        normals[offset + 3] = 255;
      }
    }
    return { colors, normals };
  }

  function makeTexture(data, colorSpace = THREE.NoColorSpace) {
    const texture = new THREE.DataTexture(data, textureSize, textureSize, THREE.RGBAFormat);
    texture.colorSpace = colorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  async function loadScanMap(encoded, colorSpace, period) {
    const url = 'data:image/jpeg;base64,' + encoded;
    let texture;
    if (typeof createImageBitmap === 'function') {
      const bitmap = await new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', colorSpaceConversion: 'none' }).loadAsync(url);
      texture = new THREE.Texture(bitmap);
      texture.flipY = false;
    } else {
      texture = await new THREE.TextureLoader().loadAsync(url);
    }
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(tileSize / period);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  window.createAquariumSandMaterial = function (type = 'original') {
    if (cached.has(type)) return cached.get(type);
    const bed = beds[type];
    if (!Object.hasOwn(beds, type)) throw new RangeError('未知底床 ' + type);
    const palette = bed.colors?.map(([r, g, b]) => new THREE.Color((r << 16) | (g << 8) | b));
    const surface = {
      type, tileSize, palette, normalStrength: type === 'original' ? 1.08 : 1.16, relief: bed.relief, flatten: bed.flatten,
      period: bed.period ?? tileSize, wetAlbedoScale: bed.wetAlbedoScale ?? 1,
      reliefRatio: 0, loaded: false, roughnessMap: null,
    };
    if (type === 'original') {
      const { colors, normals } = createGrainMaps(bed);
      surface.map = makeTexture(colors, THREE.SRGBColorSpace);
      surface.normalMap = makeTexture(normals);
      surface.loaded = true;
    } else {
      const scan = window.AQUARIUM_SUBSTRATE_SCANS[type];
      surface.reliefRatio = scan.heightRatio;
      const detail = type === 'gravel' ? window.AQUARIUM_RIVER_DETAIL : null;
      const detailMaps = detail ? [
        loadScanMap(detail.color, THREE.SRGBColorSpace, tileSize),
        loadScanMap(detail.normal, THREE.NoColorSpace, tileSize),
        loadScanMap(detail.surface, THREE.NoColorSpace, tileSize),
      ] : [];
      surface.ready = Promise.all([
        loadScanMap(scan.color, THREE.SRGBColorSpace, bed.period),
        loadScanMap(scan.normal, THREE.NoColorSpace, bed.period),
        loadScanMap(scan.roughness, THREE.NoColorSpace, bed.period),
        ...detailMaps,
      ]).then(([map, normalMap, roughnessMap, fineColor, fineNormal, fineSurface]) => {
        for (const texture of [fineColor, fineNormal, fineSurface]) {
          if (texture) texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        }
        Object.assign(surface, { map, normalMap, roughnessMap, fineColor, fineNormal, fineSurface, loaded: true });
      }).catch((error) => {
        cached.delete(type);
        throw error;
      });
    }
    cached.set(type, surface);
    return surface;
  };

  // Each triangle corner names a real patch of the scan. The field varies only
  // the placement of those patches; a grain inside a patch keeps its measured shape.
  const bedLayoutGLSL = `
    struct BedLayout {
      vec4 a;
      vec4 b;
      vec4 c;
      vec3 weight;
    };
    vec2 bedRotate(vec2 v, vec2 cs) {
      return vec2(cs.x*v.x - cs.y*v.y, cs.y*v.x + cs.x*v.y);
    }
    vec4 bedPatch(ivec2 id) {
      uint bits = uint(id.x)*0x9e3779b9u + uint(id.y)*0x85ebca6bu + 0x68bc21ebu;
      bits ^= bits >> 16u;
      bits *= 0x7feb352du;
      bits ^= bits >> 15u;
      bits *= 0x846ca68bu;
      bits ^= bits >> 16u;
      float angle = float(bits >> 20u) * (6.2831853 / 4096.);
      return vec4(vec2(float(bits & 1023u), float((bits >> 10u) & 1023u))/1024., cos(angle), sin(angle));
    }
    vec2 bedSourceUv(vec4 placement, vec2 uv) {
      return bedRotate(uv, placement.zw) + placement.xy;
    }
    BedLayout bedLayout(vec2 uv) {
      vec2 p = bedRotate(uv, vec2(.8571673, .5150381))*1.56;
      p += .25*sin(vec2(dot(p,vec2(1.47,.64)), dot(p,vec2(-.74,1.21))) +
                   .72*sin(vec2(dot(p,vec2(.59,-1.33)), dot(p,vec2(.88,.53)))));
      vec2 triangular = vec2(p.x - .57735027*p.y, 1.15470054*p.y);
      ivec2 cell = ivec2(floor(triangular));
      vec2 f = fract(triangular);
      int stepSign = 1;
      if (f.x + f.y > 1.) {
        cell += ivec2(1);
        f = 1.-f;
        stepSign = -1;
      }
      BedLayout field;
      field.a = bedPatch(cell);
      field.b = bedPatch(cell + ivec2(stepSign, 0));
      field.c = bedPatch(cell + ivec2(0, stepSign));
      vec3 w = vec3(1.-f.x-f.y, f.x, f.y);
      // A narrow blend retains sharp edges. Only patches inside the transition
      // are sampled; across a triangle edge both triangles share the same two IDs.
      float peak = max(w.x, max(w.y,w.z));
      w = smoothstep(vec3(peak-.165),vec3(peak),w);
      field.weight = w / (w.x+w.y+w.z);
      return field;
    }
  `;

  const bedVertexHeightGLSL = `
    float bedHeight(vec2 uv) {
      float height = textureLod(uBedHeightMap, uv, uBedGeometryLod).r;
      if (uRiverDetail > .5) {
        vec2 local = (fract(uv) - vec2(.25, .50))*8.;
        float edge = min(min(local.x,local.y),min(1.-local.x,1.-local.y));
        if (edge > .005) height = mix(height,textureLod(uRiverSurface,local,uBedDetailGeometryLod).r,smoothstep(.005,.045,edge));
      }
      return height-.5;
    }
    #ifdef AQUARIUM_BED_SCATTER
      float bedPatchHeight(vec4 placement, vec2 uv) {
        vec2 source = bedSourceUv(placement,uv);
        return bedHeight(source)*riverHeightScale(source);
      }
      float bedDisplacement(vec2 uv) {
        BedLayout field = bedLayout(uv);
        float h = 0.;
        if (field.weight.x > 0.) h += field.weight.x*bedPatchHeight(field.a,uv);
        if (field.weight.y > 0.) h += field.weight.y*bedPatchHeight(field.b,uv);
        if (field.weight.z > 0.) h += field.weight.z*bedPatchHeight(field.c,uv);
        return h;
      }
    #endif
  `;

  const bedPatchSamplerGLSL = `
    // All three material channels share placement coordinates, weights and texture
    // derivatives. Normal-map XY is a vector and rotates back into bed space.
    vec4 sampleBedPatch(sampler2D coarse, sampler2D fine, int channel, vec4 placement,
                        vec2 uv, vec2 du, vec2 dv) {
      vec2 source = bedSourceUv(placement, uv);
      vec4 value = sampleRiverMap(coarse, fine, source, bedRotate(du,placement.zw), bedRotate(dv,placement.zw));
      if (channel == 1) value.r = .5 + (value.r-.5)*riverHeightScale(source);
      if (channel == 2) value.xy = .5+.5*uBedDepthScale*bedRotate(value.xy*2.-1.,vec2(placement.z,-placement.w));
      return value;
    }
    vec4 sampleBed(sampler2D coarse, sampler2D fine, int channel, BedLayout field,
                   vec2 uv, vec2 du, vec2 dv) {
      vec4 result = vec4(0.);
      if (field.weight.x > 0.) result += field.weight.x * sampleBedPatch(coarse,fine,channel,field.a,uv,du,dv);
      if (field.weight.y > 0.) result += field.weight.y * sampleBedPatch(coarse,fine,channel,field.b,uv,du,dv);
      if (field.weight.z > 0.) result += field.weight.z * sampleBedPatch(coarse,fine,channel,field.c,uv,du,dv);
      return result;
    }
  `;

  // Trace the measured relief in UV space. Colour, normals and roughness must hit
  // the same grain. Keep derivatives from the original surface at occlusion edges.
  window.attachAquariumBedRelief = function (material, initialSurface, { scatter = false } = {}) {
    if (scatter) material.defines = { ...material.defines, AQUARIUM_BED_SCATTER: 1 };
    material.defaultAttributeValues = { ...material.defaultAttributeValues, bedSurfaceWeight: [0] };
    const ratio = { value: initialSurface.reliefRatio };
    const heightMap = { value: initialSurface.roughnessMap };
    const amplitude = { value: initialSurface.reliefRatio * initialSurface.period };
    const meshStrengthUniform = { value: 0 };
    const geometryLod = { value: 0 }, detailGeometryLod = { value: 0 };
    const depthScale = { value: 1 }, residualScale = { value: 1 };
    const fineOn = { value: initialSurface.fineSurface ? 1 : 0 };
    const macroScale = { value: 1 };
    const riverHeightScaleGLSL = `
      uniform float uRiverMacroHeightScale;
      float riverHeightScale(vec2 uv) {
        if (uRiverMacroHeightScale == 1.) return 1.;
        vec2 outside = max(abs(fract(uv) - vec2(.3125, .5625)) - vec2(.0625), 0.);
        return mix(uRiverMacroHeightScale, 1., smoothstep(.04, .11, length(outside)));
      }
    `;
    const fineColor = { value: initialSurface.fineColor || initialSurface.map };
    const fineNormal = { value: initialSurface.fineNormal || initialSurface.normalMap };
    const fineSurface = { value: initialSurface.fineSurface || initialSurface.roughnessMap };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uBedReliefRatio: ratio, uBedHeightMap: heightMap,
        uBedHeightMetres: amplitude, uBedMeshStrength: meshStrengthUniform,
        uRiverDetail: fineOn, uRiverColor: fineColor, uRiverNormal: fineNormal, uRiverSurface: fineSurface,
        uRiverMacroHeightScale: macroScale, uBedGeometryLod: geometryLod, uBedDetailGeometryLod: detailGeometryLod,
        uBedDepthScale: depthScale, uBedResidualScale: residualScale,
      });
      shader.vertexShader = riverHeightScaleGLSL + (scatter ? bedLayoutGLSL : '') + `
        attribute float bedSurfaceWeight;
        uniform sampler2D uBedHeightMap;
        uniform sampler2D uRiverSurface;
        uniform float uRiverDetail;
        uniform float uBedHeightMetres, uBedMeshStrength, uBedGeometryLod, uBedDetailGeometryLod;
        varying float vBedOrigin;
        varying vec3 vBedBaseView;
      ` + bedVertexHeightGLSL + shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vBedOrigin = 0.;
        vBedBaseView = (modelViewMatrix * vec4(position, 1.)).xyz;
        #ifdef USE_ROUGHNESSMAP
          // Vertices follow broad captured peaks; trace only the residual in the fragment.
          if (bedSurfaceWeight > 0.) {
            #ifdef AQUARIUM_BED_SCATTER
              vBedOrigin = bedDisplacement(vMapUv) * uBedMeshStrength;
              transformed += objectNormal * (uBedHeightMetres * vBedOrigin);
            #else
              float localScale = riverHeightScale(vMapUv);
              vBedOrigin = bedHeight(vMapUv) * uBedMeshStrength;
              transformed += objectNormal * (uBedHeightMetres * localScale * vBedOrigin);
            #endif
          }
        #endif
      `);
      const chunks = THREE.ShaderChunk;
      shader.fragmentShader = riverHeightScaleGLSL + 'uniform float uBedReliefRatio, uBedMeshStrength, uBedResidualScale, uBedDepthScale; varying float vBedOrigin; varying vec3 vBedBaseView;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>', /* glsl */ `
        vec2 bedUv = vMapUv;
        #ifdef AQUARIUM_BED_SCATTER
          BedLayout field = bedLayout(bedUv);
        #endif
        float grainLight = 1.0;
        vec2 du = dFdx(bedUv), dv = dFdy(bedUv);
        #ifdef USE_ROUGHNESSMAP
          float proximity = 1.0 - smoothstep(.009, .040, max(length(du), length(dv)));
          if (proximity > .01) {
            vec3 n = normalize(vNormal);
            mat3 frame = getTangentFrame(vBedBaseView, n, bedUv);
            vec3 viewDir = isOrthographic ? vec3(0., 0., 1.) : normalize(vViewPosition);
            vec2 viewSlope = vec2(dot(viewDir, frame[0]), dot(viewDir, frame[1])) / max(.13, dot(n, viewDir));
            float localRatio = uBedReliefRatio;
            #ifdef AQUARIUM_BED_SCATTER
              localRatio *= mix(1.,uBedResidualScale,uBedMeshStrength);
            #else
              localRatio *= riverHeightScale(bedUv);
            #endif
            vec2 ray = proximity * localRatio * viewSlope;
            vec2 uv = bedUv;
            float texelStep = max(.0016, max(length(du), length(dv)));
            if (${scatter ? 'length(ray) > .4*texelStep' : 'true'}) {
              uv += (.5 - vBedOrigin) * ray;
              float altitude = 1.;
              float steps = ceil(clamp(length(ray) / texelStep, ${scatter ? '4., 36.' : '10., 64.'}));
              for (int i = 0; i < 64; i++) {
                if (float(i) >= steps) break;
                uv -= ray / steps;
                altitude -= 1. / steps;
                float gap = altitude - textureGrad(roughnessMap, uv, du, dv).r;
                if (gap <= 0.) {
                  float low = 0., high = 1.;
                  for (int j = 0; j < 4; j++) {
                    float mid = .5 * (low + high);
                    float atMid = textureGrad(roughnessMap, uv + ray * (mid/steps), du, dv).r;
                    if (altitude + mid/steps < atMid) low=mid; else high=mid;
                  }
                  uv += ray * (.5*(low+high)/steps);
                  break;
                }
              }
            }
            bedUv = uv;
            #if NUM_DIR_LIGHTS > 0
              vec3 l = directionalLights[0].direction;
              float nl = dot(n, l);
              float h = textureGrad(roughnessMap, uv, du, dv).r;
              vec2 towardLight = vec2(dot(l, frame[0]), dot(l, frame[1])) * localRatio;
              float nearRidge = textureGrad(roughnessMap, uv + .46 * towardLight, du, dv).r - h - .46 * nl;
              float farRidge = textureGrad(roughnessMap, uv + 1.25 * towardLight, du, dv).r - h - 1.25 * nl;
              grainLight -= .28 * proximity * smoothstep(.02, .20, max(nearRidge, farRidge)) * smoothstep(0.,.16,nl);
            #endif
          }
        #endif
        #if defined(USE_ROUGHNESSMAP) || defined(AQUARIUM_BED_SCATTER)
          diffuseColor *= textureGrad(map, bedUv, du, dv);
        #else
          #include <map_fragment>
        #endif
      `).replace('#include <roughnessmap_fragment>',
        chunks.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'textureGrad(roughnessMap, bedUv, du, dv)'))
        .replace('#include <normal_fragment_maps>', `
          #if defined(USE_ROUGHNESSMAP) || defined(AQUARIUM_BED_SCATTER)
            ${chunks.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', 'textureGrad(normalMap, bedUv, du, dv)')}
          #else
            #include <normal_fragment_maps>
          #endif
        `).replace('#include <lights_fragment_end>', `
          #include <lights_fragment_end>
          reflectedLight.directDiffuse *= grainLight;
          reflectedLight.directSpecular *= grainLight;
        `);
      // The photographic close-up covers a precise eighth of the full Ganges tile.
      // Keep its physical scale and feather only the change in texture resolution.
      function bedSampler(coarse, fine, channel) {
        return scatter ? `sampleBed(${coarse}, ${fine}, ${channel}, field,` : `sampleRiverMap(${coarse}, ${fine},`;
      }
      shader.fragmentShader = shader.fragmentShader
        .replaceAll('textureGrad(roughnessMap,', bedSampler('roughnessMap','uRiverSurface',1))
        .replaceAll('textureGrad(normalMap,', bedSampler('normalMap','uRiverNormal',2))
        .replaceAll('textureGrad(map,', bedSampler('map','uRiverColor',0))
        .replace('#include <common>', `
          #include <common>
          uniform float uRiverDetail;
          uniform sampler2D uRiverColor, uRiverNormal, uRiverSurface;
          vec4 sampleRiverMap(sampler2D coarse, sampler2D fine, vec2 uv, vec2 du, vec2 dv) {
            vec4 original = textureGrad(coarse, uv, du, dv);
            if (uRiverDetail < .5) return original;
            vec2 local = (fract(uv) - vec2(.25, .50)) * 8.;
            float toEdge = min(min(local.x, local.y), min(1.-local.x, 1.-local.y));
            float fade = smoothstep(.005, .045, toEdge) *
              (1.-smoothstep(.0008, .002, max(length(du), length(dv))));
            if (fade <= 0.) return original;
            return mix(original, textureGrad(fine, local, 8.*du, 8.*dv), fade);
          }
          ${scatter ? bedLayoutGLSL + bedPatchSamplerGLSL : ''}`);
    };
    material.customProgramCacheKey = () => scatter ? 'aquarium-bed-scatter-v1' : 'aquarium-bed-registered-relief-v4';
    let activeSurface;
    return (surface, meshStrength = 0) => {
      meshStrengthUniform.value = meshStrength;
      if (surface === activeSurface) return;
      activeSurface = surface.loaded ? surface : null;
      // The 3 mm display grid carries the coarse bed shape. Sampling the raw
      // sub-millimetre peaks at its vertices produces needle-like triangles.
      // The full-resolution maps still resolve individual grains between vertices.
      const texels = surface.roughnessMap?.image?.width || 1;
      geometryLod.value = scatter ? Math.max(0, Math.log2(.003*texels/surface.period)) : 0;
      detailGeometryLod.value = scatter && surface.fineSurface
        ? Math.max(0, Math.log2(.003*8*surface.fineSurface.image.width/surface.period)) : 0;
      depthScale.value = scatter ? beds[surface.type].bedDepthScale ?? 1 : 1;
      residualScale.value = scatter ? beds[surface.type].residualDepthScale ?? 1 : 1;
      ratio.value = surface.reliefRatio*depthScale.value;
      macroScale.value = surface.type === 'gravel' && window.AQUARIUM_RIVER_DETAIL?.macroHeightRatio
        ? window.AQUARIUM_RIVER_DETAIL.macroHeightRatio / surface.reliefRatio : 1;
      amplitude.value = ratio.value * surface.period;
      heightMap.value = surface.roughnessMap;
      fineOn.value = surface.fineSurface ? 1 : 0;
      fineColor.value = surface.fineColor || surface.map;
      fineNormal.value = surface.fineNormal || surface.normalMap;
      fineSurface.value = surface.fineSurface || surface.roughnessMap;
    };
  };
})();
