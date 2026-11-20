(function () {
  'use strict';

  // Cardinal tetra pose space. Length includes the forked tail.
  const bodyHeight = .34;
  const peduncle = -.285;
  const snout = .50;
  const profiles = [
    // Z, lateral half-width, upper/lower profile and center height.
    [-.285, .063, .086, .076, -.012], [-.252, .077, .094, .084, -.014],
    [-.220, .096, .126, .108, -.017], [-.180, .126, .176, .150, -.014],
    [-.135, .159, .221, .198, -.012], [-.081, .186, .272, .247, -.014],
    [-.023, .209, .302, .293, -.018], [ .039, .221, .326, .334, -.024],
    [ .108, .225, .329, .353, -.027], [ .176, .216, .309, .339, -.027],
    [ .239, .200, .277, .302, -.022], [ .296, .176, .245, .255, -.017],
    [ .349, .153, .213, .201, -.011], [ .392, .126, .181, .153, -.005],
    [ .431, .102, .142, .116, -.004], [ .459, .078, .106, .090, -.005],
    [ .481, .047, .073, .062, -.008], [ .493, .026, .035, .032, -.012],
  ];
  const fishStyles = [
    { length: .052, height: .018, speed: .057, seed: 13707 },
    { length: .044, height: .015, speed: .061, seed: 20401 },
    { length: .040, height: .014, speed: .049, seed: 38387 },
    { length: .047, height: .017, speed: .066, seed: 47543 },
    { length: .038, height: .013, speed: .054, seed: 53657 },
  ];
  const clamp = THREE.MathUtils.clamp;

  function makeFishSkinMaterial() {
    const width = 1024;
    const height = 512;
    const colors = new Uint8Array(width * height * 4);
    const surface = new Uint8Array(colors.length);
    const { lerp, smoothstep } = THREE.MathUtils;
    const side = [158, 162, 143];
    const back = [105, 110, 82];
    const belly = [208, 205, 185];
    const red = [207, 26, 36];
    const blue = [38, 207, 239];

    function hash(x, y) {
      let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
      value = Math.imul(value ^ (value >>> 13), 1274126177);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    }

    for (let y = 0; y < height; y += 1) {
      const v = (y + .5) / height;
      const row = Math.floor(v * 14);
      const across = (v * 14 - row - .5) * 2;
      const rowFade = 1 - smoothstep(Math.abs(across), .65, 1.03);
      const rowShift = .5 * (row & 1) - .38 * across * across;
      for (let x = 0; x < width; x += 1) {
        const u = (x + .5) / width;
        const offset = (y * width + x) * 4;
        const shoulder = smoothstep(u, .07, .43);
        const stripeCenter = .552 + .095 * shoulder + .015 * smoothstep(u, .52, .9) - .012 * smoothstep(u, .83, 1);
        const stripeWidth = .019 + .027 * smoothstep(u, .15, .41) - .016 * smoothstep(u, .75, 1);
        const stripeDistance = Math.abs(v - stripeCenter - .0038 * Math.sin(u * 123));
        const iridescence = (1 - smoothstep(stripeDistance, stripeWidth * .64, stripeWidth))
          * smoothstep(u, .11, .24) * (1 - smoothstep(u, .92, .995));
        const redFloor = .406 - .139 * shoulder + .032 * smoothstep(u, .57, .85)
          + .008 * Math.sin(u * 73);
        const redFlank = smoothstep(v, redFloor - .028, redFloor + .035)
          * (1 - smoothstep(v, stripeCenter - .034, stripeCenter - .016))
          * (1 - smoothstep(u, .755, .9));
        const backTone = smoothstep(v, stripeCenter + .04, .88);
        const bellyTone = 1 - smoothstep(v, .23, .47);
        const scaleMask = (1 - smoothstep(u, .72, .89)) * smoothstep(u, .018, .135);
        const column = u * 30 + rowShift + .028 * Math.sin(51 * u + row * 1.9);
        const phase = column - Math.floor(column);
        const scaleCoverage = scaleMask * rowFade * (.69 + .31 * hash(Math.floor(column), row));
        // Toward the tail, each scale ends in a curved lip with the next scale tucked under it.
        const scaleFace = smoothstep(phase, .055, .23) * (1 - smoothstep(phase, .36, .99)) * scaleCoverage;
        const scaleLip = (1 - smoothstep(Math.abs(phase - .145), .024, .105)) * scaleCoverage;
        const scaleGap = (1 - smoothstep(Math.min(phase, 1 - phase), .013, .079)) * scaleCoverage;
        const scalesTint = (scaleFace - .28 * scaleMask) * (12 + 12 * backTone + 8 * iridescence)
          + scaleLip * (20 + 7 * backTone + 4 * iridescence) - 16 * scaleGap;

        const gillEdge = u - (.748 + 1.05 * (v - .52) ** 2);
        const gillMask = smoothstep(v, .255, .395) * (1 - smoothstep(v, .63, .76));
        const gillCrease = Math.exp(-((gillEdge * 153) ** 2)) * gillMask;
        const gillRim = Math.exp(-(((gillEdge - .014) * 97) ** 2)) * gillMask;
        const gillPlate = smoothstep(gillEdge, .010, .072) * (1 - smoothstep(u, .87, .96)) * gillMask;
        const mouth = Math.exp(-(((v - .466 - .026 * (1 - u)) * 129) ** 2)) * smoothstep(u, .928, .983);
        const mineral = (hash(x, y) - .5) * 1.8 + (hash(Math.floor(u * 41), Math.floor(v * 20)) - .5) * 5 * scaleMask;
        for (let channel = 0; channel < 3; channel += 1) {
          const base = lerp(lerp(side[channel], back[channel], backTone), belly[channel], bellyTone);
          const silver = lerp(base, belly[channel], .31 * gillPlate);
          const pigment = lerp(lerp(silver, red[channel], redFlank * .96), blue[channel], iridescence * .97);
          const tone = pigment * (1 - .29 * gillCrease - .22 * mouth) + scalesTint + 17 * gillRim + mineral;
          colors[offset + channel] = Math.round(clamp(tone, 0, 255));
        }
        colors[offset + 3] = Math.round(iridescence * 255);
        surface[offset] = Math.round(255 * (.43 + .29 * scaleFace + .12 * scaleLip
          - .088 * scaleGap - .10 * gillCrease + .055 * gillRim));
        surface[offset + 1] = Math.round(255 * (.60 - .14 * iridescence - .09 * scaleFace
          - .13 * scaleLip - .065 * gillRim));
        surface[offset + 2] = 0;
        surface[offset + 3] = 255;
      }
    }

    function makeMap(data, colorSpace) {
      const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
      texture.colorSpace = colorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      return texture;
    }

    const map = makeMap(colors, THREE.SRGBColorSpace);
    const surfaceMap = makeMap(surface, THREE.NoColorSpace);
    const material = new THREE.MeshStandardMaterial({
      map, bumpMap: surfaceMap, bumpScale: .000255, roughnessMap: surfaceMap, roughness: 1,
    });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float blueStripe = diffuseColor.a;
        diffuseColor.a = 1.0;
      `).replace('#include <lights_physical_fragment>', `
        #include <lights_physical_fragment>
        float sideView = pow2(saturate(dot(nonPerturbedNormal, normalize(vViewPosition))));
        vec3 stripeTone = mix(vec3(0.80, 0.87, 0.96), vec3(0.98, 1.29, 1.35), sideView);
        vec3 skinTone = mix(vec3(1.0), stripeTone, blueStripe);
        material.diffuseColor *= skinTone;
        material.diffuseContribution *= skinTone;
        material.specularColorBlended += blueStripe * vec3(0.008, 0.018, 0.033);
      `);
    };
    return material;
  }
  function makeFins(style, parts) {
      const { length, height } = style;
      const tint = new THREE.Color(style.fin ?? '#9ba9a3');
      const membrane = new THREE.Color('#a3b6b0').lerp(tint, 0.31);
      const rayTint = new THREE.Color('#d5ddd2').lerp(membrane, 0.37);
      const baseTint = new THREE.Color('#738682').lerp(tint, 0.43);

      function makeFin(kind, side, origin, margin, rayStrength = 1) {
        // Coordinates here are normalized to body height in X/Y and total length in Z.
        const pivot = new THREE.Vector3(origin[0] * height, origin[1] * height, origin[2] * length);
        const spokes = [];
        for (let i = 0; i < margin.length - 1; i += 1) {
          const a = margin[i];
          const b = margin[i + 1];
          for (const t of [0, 0.11, 0.50, 0.89]) {
            const web = Math.sin(Math.PI * t);
            const inward = 1 - 0.020 * web ** 2;
            spokes.push({
              x: origin[0] + (THREE.MathUtils.lerp(a[0], b[0], t) - origin[0]) * inward,
              y: origin[1] + (THREE.MathUtils.lerp(a[1], b[1], t) - origin[1]) * inward,
              z: origin[2] + (THREE.MathUtils.lerp(a[2], b[2], t) - origin[2]) * inward,
              ray: (1 - web) ** 1.7 * rayStrength,
            });
          }
        }
        const last = margin[margin.length - 1];
        spokes.push({ x: last[0], y: last[1], z: last[2], ray: rayStrength });

      const positions = [pivot.x, pivot.y, pivot.z];
      const rootTint = kind === 'caudal' ? new THREE.Color('#a0413c').lerp(baseTint, .32) : baseTint;
      const colors = [rootTint.r, rootTint.g, rootTint.b, 0.68];
        const flex = [0];
        const indices = [];
        const color = new THREE.Color();
        const rings = 5;
        for (let ring = 1; ring <= rings; ring += 1) {
          const distance = ring / rings;
          const arch = Math.sin(Math.PI * distance);
          for (let i = 0; i < spokes.length; i += 1) {
            const point = spokes[i];
            const along = i / (spokes.length - 1);
            const ripple = (0.013 + 0.008 * Math.sin(along * Math.PI * 2)) * arch;
            const x = THREE.MathUtils.lerp(origin[0], point.x, distance) + (side === 0 ? ripple : 0);
            const y = THREE.MathUtils.lerp(origin[1], point.y, distance) + (side === 0 ? 0 : ripple);
            const z = THREE.MathUtils.lerp(origin[2], point.z, distance);
            positions.push(x * height, y * height, z * length);
            const rays = point.ray * Math.sin(0.36 + distance * 2.45);
          color.copy(membrane).lerp(rootTint, 0.62 * (1 - distance) ** 2.4).lerp(rayTint, 0.67 * rays);
          colors.push(color.r, color.g, color.b, 0.30 + 0.27 * (1 - distance) ** 1.4 + 0.29 * rays);
            flex.push(distance);

            if (i === spokes.length - 1) continue;
            const current = 1 + (ring - 1) * spokes.length + i;
            if (ring === 1) indices.push(0, current, current + 1);
            else {
              const previous = current - spokes.length;
              indices.push(previous, current, previous + 1, current, current + 1, previous + 1);
            }
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
        geometry.setAttribute('finFlex', new THREE.Float32BufferAttribute(flex, 1));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, parts.fin);
        const label = kind[0].toUpperCase() + kind.slice(1);
        mesh.name = 'AquariumFish' + label + (side === 0 ? '' : side < 0 ? 'Left' : 'Right');
        mesh.userData = { kind, side };
        return mesh;
      }

      const fins = [
        makeFin('caudal', 0, [0, 0.012, -0.277], [
          [0, 0.101, -0.286], [0.008, 0.273, -0.377], [0.005, 0.433, -0.465],
          [0.017, 0.393, -0.502], [0.019, 0.281, -0.485], [0.013, 0.142, -0.446],
          [0, 0.008, -0.400], [-0.010, -0.121, -0.437], [-0.017, -0.268, -0.481],
          [-0.010, -0.373, -0.499], [0, -0.379, -0.472], [0.008, -0.243, -0.371],
          [0, -0.081, -0.287],
        ]),
        makeFin('dorsal', 0, [0, 0.273, 0.025], [
          [0, 0.315, 0.156], [0.010, 0.427, 0.113], [0.020, 0.485, 0.062],
          [0.024, 0.473, 0.012], [0.016, 0.435, -0.030], [0.009, 0.368, -0.085],
          [0, 0.251, -0.135], [0, 0.212, -0.129],
        ]),
        makeFin('anal', 0, [0, -0.209, -0.071], [
          [0, -0.292, 0.040], [0.011, -0.405, -0.005], [0.014, -0.468, -0.050],
          [0.017, -0.417, -0.096], [0.010, -0.337, -0.130], [0.004, -0.274, -0.172],
          [0, -0.169, -0.229], [0, -0.138, -0.205],
        ]),
        makeFin('adipose', 0, [0, 0.126, -0.189], [
          [0, 0.184, -0.161], [0.005, 0.257, -0.174], [0.013, 0.287, -0.195],
          [0.007, 0.238, -0.224], [0, 0.134, -0.249],
        ], 0.18),
      ];
      for (const side of [-1, 1]) {
        fins.push(
          makeFin('pectoral', side, [side * 0.186, -0.104, 0.188], [
            [side * 0.238, -0.090, 0.171], [side * 0.409, -0.108, 0.126],
            [side * 0.492, -0.164, 0.077], [side * 0.476, -0.212, 0.051],
            [side * 0.344, -0.239, 0.067], [side * 0.254, -0.192, 0.118],
          ]),
          makeFin('pelvic', side, [side * 0.110, -0.294, 0.040], [
            [side * 0.150, -0.318, 0.022], [side * 0.277, -0.384, -0.035],
            [side * 0.328, -0.425, -0.076], [side * 0.266, -0.417, -0.116],
            [side * 0.166, -0.371, -0.098],
          ], 0.81),
        );
      }
      return fins;
    }

  function createBodyGeometry() {
    const positions = [];
    const uvs = [];
    const indices = [];
    const sides = 28;
    function vertex(x, y, z) {
      positions.push(x * bodyHeight, y * bodyHeight, z);
      uvs.push((z - peduncle) / (snout - peduncle), .5 + y);
    }

    for (let ring = 0; ring < profiles.length; ring += 1) {
      const [z, width, back, belly, center] = profiles[ring];
      for (let i = 0; i < sides; i += 1) {
        const angle = i * Math.PI * 2 / sides;
        const vertical = Math.sin(angle);
        vertex(width * Math.cos(angle), center + vertical * (vertical > 0 ? back : belly), z);
        if (ring === profiles.length - 1) continue;
        const a = ring * sides + i;
        const b = ring * sides + (i + 1) % sides;
        indices.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
    const tailCap = positions.length / 3;
    const noseCap = tailCap + 1;
    vertex(0, -.012, peduncle);
    vertex(0, -.014, snout);
    const lastRing = (profiles.length - 1) * sides;
    for (let i = 0; i < sides; i += 1) {
      const next = (i + 1) % sides;
      indices.push(tailCap, next, i, noseCap, lastRing + i, lastRing + next);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function normalDelta(geometry, displacement) {
    const posed = new THREE.BufferGeometry();
    posed.setIndex(geometry.index);
    posed.setAttribute('position', new THREE.BufferAttribute(
      Float32Array.from(geometry.attributes.position.array, (value, i) => value + displacement[i]), 3,
    ));
    posed.computeVertexNormals();
    return new THREE.BufferAttribute(Float32Array.from(posed.attributes.normal.array,
      (value, i) => value - geometry.attributes.normal.array[i]), 3);
  }

  function prepareSwim(mesh) {
    const { geometry } = mesh;
    const { kind, side } = mesh.userData;
    const positions = geometry.attributes.position;
    const flex = geometry.attributes.finFlex;
    const paired = kind === 'pectoral' || kind === 'pelvic';
    const deltas = Array.from({ length: paired ? 4 : 2 }, () => new Float32Array(positions.array.length));
    for (let i = 0; i < positions.count; i += 1) {
      const z = positions.getZ(i);
      const rear = clamp((.16 - z) / .665, 0, 1);
      const trunk = clamp((.34 - z) / .845, 0, 1);
      const tip = flex ? flex.getX(i) : 0;
      // A shallow body wave grows toward the tail. Each fin starts with the same wave as its attachment.
      const membrane = paired ? 0 : tip * (kind === 'caudal' ? .37 : .29);
      const amplitude = .008 * trunk + .092 * rear * rear + .013 * membrane * tip;
      const lag = 2.12 * rear + membrane;
      const vertex = i * 3;
      deltas[0][vertex] = amplitude * Math.cos(lag);
      deltas[1][vertex] = -amplitude * Math.sin(lag);

      if (paired) {
        const sweep = (kind === 'pectoral' ? .026 : .016) * tip ** 1.5;
        const finLag = .82 * tip;
        const movement = [side * sweep, -.38 * sweep, -.49 * sweep];
        for (let axis = 0; axis < 3; axis += 1) {
          deltas[2][vertex + axis] = movement[axis] * Math.cos(finLag);
          deltas[3][vertex + axis] = -movement[axis] * Math.sin(finLag);
        }
      }
    }
    geometry.computeBoundingBox();
    geometry.boundingBox.expandByVector(new THREE.Vector3(.158, .018, .024));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = deltas.map((data) => new THREE.BufferAttribute(data, 3));
    geometry.morphAttributes.normal = deltas.map((data) => normalDelta(geometry, data));
    mesh.updateMorphTargets();
    return mesh;
  }

  function addEyes(group, eyeGeometry, irisMaterial, pupilMaterial) {
    for (const side of [-1, 1]) {
      const iris = new THREE.Mesh(eyeGeometry, irisMaterial);
      iris.name = 'AquariumFishIris';
      iris.scale.set(.023 * bodyHeight, .079 * bodyHeight, .026);
      iris.position.set(side * .108 * bodyHeight, .080 * bodyHeight, .383);
      iris.rotation.z = side * -.13;
      const pupil = new THREE.Mesh(eyeGeometry, pupilMaterial);
      pupil.name = 'AquariumFishPupil';
      pupil.scale.set(.012 * bodyHeight, .052 * bodyHeight, .017);
      pupil.position.set(side * .127 * bodyHeight, .081 * bodyHeight, .386);
      group.add(iris, pupil);
    }
  }

  window.createAquariumFishModels = function (scene, lightFish) {
    const skin = new THREE.Mesh(createBodyGeometry(), makeFishSkinMaterial());
    skin.name = 'AquariumFishBody';
    skin.receiveShadow = true;
    const fin = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: .67, side: THREE.DoubleSide, transparent: true,
      depthWrite: false, forceSinglePass: true,
    });
    const shapes = [skin, ...makeFins({ length: 1, height: bodyHeight, fin: '#adbeb0' }, { fin })].map(prepareSwim);
    const eyeGeometry = new THREE.SphereGeometry(1, 16, 12);
    const iris = new THREE.MeshStandardMaterial({ color: '#759eb0', metalness: .33, roughness: .32 });
    const pupil = new THREE.MeshStandardMaterial({ color: '#060b13', roughness: .37 });
    const models = [];
    const templates = new Map();
    function createModel({ length, height, speed, seed, species = 'cardinal', variant = 0 }) {
      const group = new THREE.Group();
      group.rotation.order = 'YXZ';
      let animated;
      if (species === 'cardinal') {
        group.name = 'AquariumCardinalTetra';
        group.scale.set(height / bodyHeight, height / bodyHeight, length);
        animated = shapes.map((shape) => shape.clone());
        addEyes(group, eyeGeometry, iris, pupil);
      } else {
        const registry = window.aquariumFishSpecies;
        const key = species + variant;
        if (!templates.has(key)) {
          templates.set(key, registry.makeTemplate(species, variant, prepareSwim));
        }
        const template = templates.get(key);
        group.name = registry.anatomy[species].name;
        group.scale.setScalar(length);
        animated = template.animated.map((shape) => shape.clone());
        group.add(...template.fixed.map((shape) => shape.clone()));
      }
      group.userData.species = species;
      group.add(...animated);
      return { group, animated, cruise: speed, seedPhase: seed / 997, previousYaw: null, bank: 0 };
    }
    function install(model) {
      const { group } = model;
      if (lightFish) group.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.receiveShadow = true;
        lightFish(mesh.material, mesh.geometry.hasAttribute('finFlex') ? 'fin' : 'fish');
      });
      scene.add(group);
      models.push(model);
    }
    fishStyles.forEach((style) => install(createModel(style)));
    const counts = new Map();
    function addFish(species, motion, position) {
      const count = counts.get(species) || 0;
      if (species !== 'cardinal' && !Object.hasOwn(window.aquariumFishSpecies.anatomy, species)) return false;
      const data = species === 'cardinal' ? fishStyles[count % fishStyles.length] :
        window.aquariumFishSpecies.anatomy[species];
      const size = species === 'cardinal' ? 1 : [1, .91, 1.06, .96][count % 4];
      const spec = { species, length: data.length * size, height: data.height * size, speed: data.speed,
        seed: Math.imul(models.length + 1, 5381) >>> 0 };
      const model = createModel(spec);
      const pose = motion.addFish(spec, position);
      if (!pose) return false;
      model.group.position.set(pose.x, pose.y, pose.z);
      install(model);
      counts.set(species, count + 1);
      return true;
    }

    function render(fish) {
      for (let i = 0; i < models.length; i += 1) {
        const pose = fish[i];
        const model = models[i];
        const { group, animated, cruise, seedPhase } = model;
        const yaw = Math.atan2(pose.headingX, pose.headingZ);
        const yawDelta = model.previousYaw === null ? 0 : yaw - model.previousYaw;
        const turn = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
        model.previousYaw = yaw;
        model.bank = THREE.MathUtils.lerp(model.bank, clamp(turn * 2.6, -.12, .12), .30);
        group.position.set(pose.x, pose.y, pose.z);
        const noseDip = pose.resting && pose.species === 'pandaCory' ?
          .055 + .05 * Math.sin(pose.elapsed * 9 + seedPhase) : 0;
        group.rotation.set(noseDip - Math.atan2(pose.headingY, Math.hypot(pose.headingX, pose.headingZ)), yaw,
          model.bank + .018 * Math.sin(pose.phase + seedPhase));

        const effort = clamp(pose.speed / cruise, .28, 1.72);
        const drive = (.62 + .31 * effort) * (pose.resting ? .14 : 1);
        const sine = drive * Math.sin(pose.phase);
        const cosine = drive * Math.cos(pose.phase);
        for (const mesh of animated) {
          const weights = mesh.morphTargetInfluences;
          weights[0] = sine;
          weights[1] = cosine;
          if (weights.length === 2) continue;
          const { kind, side } = mesh.userData;
          const finPhase = pose.phase * (kind === 'pectoral' ? 2 : 1) + .73 * side + seedPhase;
          const stroke = clamp(.74 + turn * side * 3 + (1 - effort) * .12, .4, 1);
          weights[2] = stroke * Math.sin(finPhase);
          weights[3] = stroke * Math.cos(finPhase);
        }
      }
    }

    return { specs: fishStyles.map((style) => ({ ...style })), render, addFish };
  };
})();
