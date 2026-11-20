(function () {
  'use strict';

  const {
    width, depth, height, waterLevel, glassThickness: glassInset,
    matThickness: levelingMatThickness, lampLength, lampDepth, lampHeight, lampZ,
  } = window.AQUARIUM_LAYOUT;
  const bounds = Object.freeze({
    minX: -width / 2 + glassInset,
    maxX: width / 2 - glassInset,
    minZ: -depth / 2 + glassInset,
    maxZ: depth / 2 - glassInset,
  });
  const sandBrushRadius = 0.086;
  const minSandHeight = glassInset + 0.007;
  const maxSandHeight = 0.20;
  const sandSegmentsX = Math.round(width / 0.012);
  const sandSegmentsZ = Math.round(depth / 0.012);
  const sandColumns = sandSegmentsX + 1;
  const settleStep = 1 / 60;
  const markerRadius = 0.0202;
  const sandContours = [
    // Center X/Z, spread along/across, rotation, and height in meters.
    [-0.43, -0.100, 0.177, 0.135, -0.45, 0.084],
    [0.335, -0.115, 0.185, 0.117, 0.26, 0.069],
    [0.50, 0.145, 0.130, 0.130, -0.28, 0.022],
    [-0.48, 0.155, 0.130, 0.087, 0.14, 0.032],
    [-0.39, -0.050, 0.120, 0.028, -0.47, 0.0045],
    [-0.31, 0.032, 0.115, 0.033, -0.59, 0.005],
    [-0.43, 0.107, 0.124, 0.025, -0.48, -0.004],
    [0.26, -0.135, 0.130, 0.033, 0.24, 0.005],
    [0.34, -0.042, 0.140, 0.034, 0.43, -0.004],
    [0.417, 0.080, 0.125, 0.031, 0.28, 0.004],
  ].map(([x, z, along, across, angle, elevation]) => ({
    x, z, along, across, cosine: Math.cos(angle), sine: Math.sin(angle), elevation,
  }));

  const ecosystemDecor = [
    // X and Z in meters, with the front glass at positive Z.
    ['stone', 'tripoOhkoWeathered', [-.405, -.033]],
    ['stone', 'dragon', [-.177, -.144]],
    ['stone', 'river', [-.546, .137]],
    ['stone', 'river', [.115, .151]],
    ['stone', 'river', [.490, -.087]],
    ['plant', 'tigerVallisneria', [-.613, -.174]],
    ['plant', 'tigerVallisneria', [-.512, -.192]],
    ['plant', 'hornwort', [-.372, -.196]],
    ['plant', 'tigerVallisneria', [-.025, -.153]],
    ['plant', 'tigerVallisneria', [.209, -.146]],
    ['plant', 'hornwort', [.334, -.177]],
    ['plant', 'tigerVallisneria', [.501, -.209]],
    ['plant', 'tigerVallisneria', [.453, .092]],
    ['plant', 'redRootFloater', [-.536, -.078]],
    ['plant', 'redRootFloater', [-.434, -.133]],
    ['plant', 'redRootFloater', [.034, -.186]],
    ['plant', 'redRootFloater', [.427, .084]],
  ];

  const ecosystemFish = {
    // Five cardinals are already present. Positions are [x, z, y] in meters.
    cardinal: [
      [-.47, .155, .353], [-.281, .045, .398], [-.126, .166, .282], [-.018, .072, .336],
      [.157, -.052, .423], [.306, .146, .292], [.49, .032, .368], [-.352, -.185, .387],
      [.223, -.119, .328],
    ],
    guppy: [
      [-.557, .086, .476], [-.369, -.091, .488], [-.188, .165, .509],
      [.076, -.098, .469], [.318, .041, .504], [.528, -.046, .466],
    ],
    // Omitting y seats the corys just above the sand at their starting position.
    pandaCory: [
      [-.226, .244], [-.219, .157], [-.087, .197], [.101, -.013], [.321, .033], [.539, .179],
    ],
    otocinclus: [
      [-.569, -.223, .315], [-.404, .236, .195], [-.187, -.235, .349],
      [.067, .227, .155], [.333, -.217, .267], [.561, .219, .299],
    ],
  };

  function plantEcosystemCarpet(decor) {
    const options = { compact: true };
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 16; col++) {
        const x = -.618 + col * .082 + .014 * Math.sin(3.7 * col + 2.6 * row);
        const z = -.215 + row * .073 + .014 * Math.cos(2.3 * col - 3.2 * row);
        // Leave a strip of exposed sand in front for the corys.
        if (z > .060 && Math.abs(x + .055 + .19 * z) < .105) continue;
        const bladderwort = Math.sin(13 * x - 6 * z) + .65 * Math.cos(17 * z + 3 * x) > .59;
        decor.add('plant', bladderwort ? 'bladderwort' : 'monteCarlo', [x, z], options);
      }
    }
  }

  function sandHeight(x, z) {
    const intoTank = (bounds.maxZ - z) / (bounds.maxZ - bounds.minZ);
    // This base level preserves the volume of the original bed in the current tank.
    let elevation = 0.04217773 + 0.023 * intoTank;
    const channel = 0.020 + 0.095 * Math.sin(4.5 * z + 0.5);
    elevation -= 0.015 * Math.exp(-0.5 * (((x - channel) / 0.110) ** 2 + ((z - 0.035) / 0.29) ** 2));
    for (const mound of sandContours) {
      const dx = x - mound.x;
      const dz = z - mound.z;
      const u = (dx * mound.cosine + dz * mound.sine) / mound.along;
      const v = (dz * mound.cosine - dx * mound.sine) / mound.across;
      elevation += mound.elevation * Math.exp(-0.5 * (u * u + v * v));
    }
    return elevation;
  }

  function ecosystemSandHeight(x, z) {
    const back = (bounds.maxZ - z) / (bounds.maxZ - bounds.minZ);
    const leftBank = Math.exp(-.5 * (((x + .43) / .22) ** 2 + ((z + .12) / .148) ** 2));
    const rightBank = Math.exp(-.5 * (((x - .50) / .16) ** 2 + ((z + .06) / .16) ** 2));
    const lowMound = Math.exp(-.5 * (((x - .12) / .081) ** 2 + ((z - .14) / .105) ** 2));
    return .045 + .028 * back + .040 * leftBank + .018 * rightBank + .009 * lowMound;
  }

  // Broad changes in deposited fines span many grains and remain fixed on the bed.
  function sedimentPatch(x, z) {
    const i = Math.floor(x), j = Math.floor(z);
    const u = x-i, v = z-j;
    const sx = u*u*(3-2*u), sz = v*v*(3-2*v);
    function tone(a,b) {
      let h = Math.imul(a, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35) ^ 197362;
      h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
      return ((h ^ (h >>> 15)) >>> 0)/4294967296;
    }
    const lerp = THREE.MathUtils.lerp;
    return lerp(lerp(tone(i,j),tone(i+1,j),sx), lerp(tone(i,j+1),tone(i+1,j+1),sx),sz);
  }

  function makeSand({ map, normalMap, tileSize, normalStrength }, heightAt) {
    const geometry = new THREE.PlaneGeometry(
      bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, sandSegmentsX, sandSegmentsZ,
    );
    geometry.rotateX(-Math.PI / 2);
    const { position: positions, uv } = geometry.attributes;
    positions.setUsage(THREE.DynamicDrawUsage);
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = heightAt(x, z);
      const broad = sedimentPatch(4.2*x+2.5*z, 4.2*z-2.5*x);
      const small = sedimentPatch(18*x-11*z+7.2*broad, 18*z+11*x);
      const shade = .849 + .085*broad + .037*small;
      positions.setY(i, y);
      uv.setXY(i, (x - bounds.minX) / tileSize, (bounds.maxZ - z) / tileSize);
      colors.set([shade, shade, shade], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    const sand = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      map, normalMap, normalScale: new THREE.Vector2().setScalar(normalStrength), vertexColors: true, roughness: 0.93,
    }));
    sand.name = 'AquariumSandSurface';
    sand.receiveShadow = true;
    return sand;
  }

  function makeSandEdges(sandPositions, { map, normalMap, tileSize, normalStrength }) {
    const lastRow = sandSegmentsZ * sandColumns;
    const sides = [
      [0, 1, sandSegmentsX], [sandSegmentsX, sandColumns, sandSegmentsZ],
      [lastRow + sandSegmentsX, -1, sandSegmentsX], [lastRow, -sandColumns, sandSegmentsZ],
    ];
    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    const borderLinks = [];
    const top = new THREE.Color('#ede8df');
    const bottom = new THREE.Color('#876c54');
    const color = new THREE.Color();
    let edgeOrigin = 0;
    for (const [first, step, segments] of sides) {
      const start = positions.length / 3;
      for (let i = 0; i <= segments; i += 1) {
        const sandIndex = first + i * step;
        const x = sandPositions.getX(sandIndex);
        const z = sandPositions.getZ(sandIndex);
        const topY = sandPositions.getY(sandIndex);
        const layer = .42 + .18*sedimentPatch(11*x-6*z,11*z+6*x);
        const a = start + i * 3;
        const middleY = THREE.MathUtils.lerp(glassInset, topY, layer);
        positions.push(x, glassInset, z, x, middleY, z, x, topY, z);
        const along = (edgeOrigin + Math.hypot(x - sandPositions.getX(first), z - sandPositions.getZ(first))) / tileSize;
        uvs.push(along, glassInset / tileSize, along, middleY / tileSize, along, topY / tileSize);
        borderLinks.push({ sandIndex, a, layer });
        color.copy(bottom).lerp(top, layer);
        colors.push(bottom.r, bottom.g, bottom.b, color.r, color.g, color.b, top.r, top.g, top.b);
        if (i === segments) continue;
        indices.push(a, a + 3, a + 1, a + 3, a + 4, a + 1, a + 1, a + 4, a + 2, a + 4, a + 5, a + 2);
      }
      const last = first+step*segments;
      edgeOrigin += Math.hypot(sandPositions.getX(last)-sandPositions.getX(first), sandPositions.getZ(last)-sandPositions.getZ(first));
    }
    const geometry = new THREE.BufferGeometry();
    const edgePositions = new THREE.Float32BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    const edgeUv = new THREE.Float32BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', edgePositions);
    geometry.setAttribute('uv', edgeUv);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      map, normalMap, normalScale: new THREE.Vector2().setScalar(.82 * normalStrength),
      vertexColors: true, side: THREE.DoubleSide, roughness: 1,
    }));
    mesh.name = 'AquariumSandEdge';

    function syncHeights() {
      for (const { sandIndex, a, layer } of borderLinks) {
        const y = sandPositions.getY(sandIndex);
        const middleY = THREE.MathUtils.lerp(glassInset, y, layer);
        edgePositions.setY(a + 1, middleY);
        edgePositions.setY(a + 2, y);
        edgeUv.setY(a + 1, middleY / tileSize);
        edgeUv.setY(a + 2, y / tileSize);
      }
      edgePositions.needsUpdate = true;
      edgeUv.needsUpdate = true;
      geometry.computeBoundingSphere();
    }

    return { mesh, syncHeights };
  }

  function addTank(scene) {
    const box = (w, h, d, x, y, z, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    };
    const bevel = 0.00055;
    const halfWidth = width * 0.5 + 0.0008 - bevel;
    const halfDepth = depth * 0.5 + 0.0008 - bevel;
    const outline = new THREE.Shape([
      new THREE.Vector2(-halfWidth, -halfDepth), new THREE.Vector2(halfWidth, -halfDepth),
      new THREE.Vector2(halfWidth, halfDepth), new THREE.Vector2(-halfWidth, halfDepth),
    ]);
    const matGeometry = new THREE.ExtrudeGeometry(outline, {
      depth: levelingMatThickness - 2 * bevel, bevelEnabled: true, bevelSegments: 2,
      bevelSize: bevel, bevelThickness: bevel, steps: 1,
    });
    matGeometry.rotateX(-Math.PI / 2);
    matGeometry.translate(0, -levelingMatThickness + bevel, 0);
    const mat = new THREE.Mesh(matGeometry, new THREE.MeshStandardMaterial({ color: '#25292b', roughness: 0.94 }));
    mat.name = 'AquariumLevelingMat';
    scene.add(mat);

    const housing = new THREE.MeshStandardMaterial({ color: '#282c30', roughness: 0.38, metalness: 0.46 });
    const diffuser = new THREE.MeshBasicMaterial({ color: '#485153', toneMapped: false });
    box(lampLength, 0.019, lampDepth, 0, lampHeight + 0.011, lampZ, housing).name = 'AquariumLampHousing';
    // The opal cover reaches the long edges so its lit face is visible from above the tank.
    box(lampLength - 0.020, 0.0065, lampDepth + 0.0006, 0, lampHeight, lampZ, diffuser).name = 'AquariumLampDiffuser';
    for (const side of [-1, 1]) {
      box(0.010, lampHeight - height, 0.014, side * (width / 2 - 0.036), (height + lampHeight) / 2,
        lampZ - 0.037, housing);
      box(0.039, 0.008, 0.027, side * (width / 2 - 0.020), height - 0.001, lampZ - 0.037, housing);
    }
    return diffuser;
  }

  function addFilterPipes(scene, caustics) {
    const pipes = new THREE.Group();
    pipes.name = 'AquariumFilterPipes';
    const material = new THREE.MeshStandardMaterial({ color: '#303635', roughness: .56 });
    caustics.apply(material, 'plant');
    const inside = bounds.minZ + .026;
    const outside = bounds.minZ - glassInset - .018;

    function pipe(points, radius) {
      const path = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 40, radius, 12), material);
      mesh.receiveShadow = true;
      pipes.add(mesh);
    }

    function riser(x, bottom) {
      const top = height + .035;
      pipe([
        [x, -.025, outside], [x, height + .013, outside], [x, top, outside + .018],
        [x, top, inside - .018], [x, height + .013, inside], [x, bottom, inside],
      ], .009);
    }

    const inlet = bounds.minX + .056;
    riser(inlet, .205);
    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .0026, 16), material);
      ring.position.set(inlet, .205 + .004 * i, inside);
      pipes.add(ring);
    }

    const outlet = bounds.maxX - .058;
    const outletHeight = waterLevel - .036;
    riser(outlet, outletHeight + .022);
    pipe([
      [outlet, outletHeight + .024, inside], [outlet - .015, outletHeight, inside + .012],
      [outlet - .059, outletHeight, inside + .032],
    ], .009);
    scene.add(pipes);
  }

  function addLights(scene, diffuser, lighting) {
    const { uDaySunDirection, uDaySunColor, uDaySun, uDaySky, uDayLamp, uDayLampColor } = lighting;
    const lampColor = uDayLampColor.value;
    const ambient = new THREE.HemisphereLight('#f0f0ed', '#63635e', 1.42);
    scene.add(ambient);
    const key = new THREE.DirectionalLight('#fff2dc', 0);
    key.target.position.set(0, 0.19, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    const shadowMargin = Math.hypot(width / 2, depth / 2) + 0.075;
    Object.assign(key.shadow.camera, {
      left: -shadowMargin, right: shadowMargin, top: height + 0.08, bottom: -height - 0.08,
      near: 0.1, far: 2.65,
    });
    key.shadow.normalBias = 0.0012;
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight('#eceff0', 0.43);
    fill.position.set(0.31, 0.21, -0.34);
    scene.add(fill);

    const lampSections = [-1, 0, 1].map((section) => section * lampLength / 3);
    const lampSpots = lampSections.map((x) => {
      const lamp = new THREE.SpotLight(lampColor, 0, 1, 1.24, 0.70, 1.65);
      lamp.position.set(x, lampHeight - 0.001, lampZ + 0.021);
      lamp.target.position.set(x, 0.15, depth * 0.10);
      scene.add(lamp, lamp.target);
      return lamp;
    });
    // Light scattered inside the tank reaches fish and leaves on both viewing sides.
    const tankBounce = lampSections.flatMap((x) => [-1, 1].map((side) => {
      const light = new THREE.PointLight(lampColor, 0, 0.73, 0.95);
      light.position.set(x, waterLevel * 0.63, side * (depth / 2 + 0.085));
      scene.add(light);
      return light;
    }));

    const fromLamp = new THREE.Vector3(0, lampHeight - 0.001, lampZ + 0.021).sub(key.target.position).normalize();
    const toLight = new THREE.Vector3();
    const diffuserOff = new THREE.Color('#485153');
    const ambientDay = new THREE.Color('#f0f0ed');
    const ambientNight = new THREE.Color('#9eacd3');
    const diffuserOn = lampColor.clone().multiplyScalar(1.08);

    return function updateLights() {
      const sun = uDaySun.value;
      const sky = uDaySky.value;
      const glowing = uDayLamp.value;
      const lampShadows = 0.92 * glowing * (1 - sun);
      key.intensity = 2.15 * sun + lampShadows;
      const lampShare = lampShadows / Math.max(key.intensity, 0.001);
      key.color.copy(uDaySunColor.value).lerp(uDayLampColor.value, lampShare);
      // Flat-water refraction gives the direction of the sun's shadows inside the tank.
      toLight.copy(uDaySunDirection.value).multiplyScalar(-1 / 1.333);
      toLight.y = Math.sqrt(1 - toLight.x ** 2 - toLight.z ** 2);
      toLight.lerp(fromLamp, lampShare).normalize();
      key.position.copy(key.target.position).addScaledVector(toLight, 1.34);
      ambient.intensity = 0.28 + 1.14 * sky;
      ambient.color.copy(ambientNight).lerp(ambientDay, sky);
      fill.intensity = 0.06 + 0.37 * sky;
      for (const lamp of lampSpots) lamp.intensity = 0.80 * glowing;
      for (const light of tankBounce) light.intensity = 0.31 * glowing;
      diffuser.color.copy(diffuserOff).lerp(diffuserOn, glowing);
    };
  }

  function makeFishSchool(scene, sandHeightAt, obstacles, lightFish) {
    const models = createAquariumFishModels(scene, lightFish);
    const environment = { bounds, waterLevel, groundHeight: sandHeightAt, stone: () => obstacles[0], stones: () => obstacles };
    const food = createAquariumFood({ scene, ...environment });
    const motion = createFishMotion({
      ...environment, fishSpecs: models.specs, food: food.points, eat: food.eat,
    });

    function update(frameSeconds) {
      food.update(frameSeconds);
      motion.update(frameSeconds);
      models.render(motion.fish);
    }

    return { update, dropFood: food.drop, addFish: (type, position) => models.addFish(type, motion, position) };
  }

  window.createAquariumScene = function (canvas, { ecosystem = false } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Keep captured colors and the direct view in the same linear color pipeline.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39.5, 1, 0.04, 18);
    const target = new THREE.Vector3(0, height / 2, 0);
    const cameraDirection = new THREE.Vector3();
    const minElevation = THREE.MathUtils.degToRad(-8);
    const maxElevation = THREE.MathUtils.degToRad(72);
    const radiansPerPixel = 0.006;
    const minOrbitRadius = Math.hypot(width / 2, depth / 2) + 0.16;
    const minViewRadius = minOrbitRadius / 2;
    let azimuth = Math.atan2(0.45, 3.28);
    let elevation = THREE.MathUtils.degToRad(14.5);
    let orbitRadius = null;
    let viewRadius = null;
    let maxRadius = null;
    const viewCenter = new THREE.Vector2();
    let fitOpeningView = false;

    const daylight = createAquariumDaylight();
    const lighting = daylight.uniforms;
    const sunlight = lighting.uDaySunDirection.value;
    scene.background = daylight.background;
    let livingRoom = null;
    const updateLights = addLights(scene, addTank(scene), lighting);
    const opticalSurfaces = new THREE.Group();
    opticalSurfaces.name = 'AquariumOpticalSurfaces';
    scene.add(opticalSurfaces);

    const sceneDepth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    const refractionTarget = new THREE.WebGLRenderTarget(1, 1, {
      colorSpace: THREE.LinearSRGBColorSpace,
      depthTexture: sceneDepth,
      samples: 2,
    });
    refractionTarget.texture.name = 'Aquarium refraction capture';
    const refractionStrength = { value: 1 };
    const optics = { scene: opticalSurfaces, sceneColor: refractionTarget.texture, sceneDepth, refractionStrength, lighting };
    const glass = createAquariumGlass({ ...optics, width, depth, height, thickness: glassInset, waterLevel });
    const water = createAquariumWater({
      ...optics, width: bounds.maxX - bounds.minX, depth: bounds.maxZ - bounds.minZ, waterLevel,
    });
    const caustics = createAquariumCaustics({
      bounds, waterLevel, sunlight, sunStrength: lighting.uDaySun, sunColor: lighting.uDaySunColor,
      time: water.time, surfaceSlopeGLSL: water.surfaceSlopeGLSL,
    });
    let reflectionDirty = true;
    const sandMaterial = createAquariumSandMaterial();
    const sand = makeSand(sandMaterial, ecosystem ? ecosystemSandHeight : sandHeight);
    const sandPositions = sand.geometry.attributes.position;
    const sandEdges = makeSandEdges(sandPositions, sandMaterial);
    const sandGrains = createAquariumLooseGrains(sandMaterial, bounds, maxSandHeight);
    const updateBedRelief = attachAquariumBedRelief(sand.material, sandMaterial, { scatter: true });
    const updateEdgeRelief = attachAquariumBedRelief(sandEdges.mesh.material, sandMaterial, { scatter: true });
    const scannedBed = createAquariumScannedBed(sand, sandMaterial, updateBedRelief);
    let sandGrainsDirty = true;
    const sampleMinX = sandPositions.getX(0);
    const sampleMaxX = sandPositions.getX(sandSegmentsX);
    const sampleMinZ = sandPositions.getZ(0);
    const sampleMaxZ = sandPositions.getZ(sandSegmentsZ * sandColumns);
    const sandPhysics = createSandPhysics({
      positions: sandPositions.array,
      indices: sand.geometry.index.array,
      minHeight: minSandHeight,
      maxHeight: maxSandHeight,
      reposeDegrees: 30,
    });
    const suspension = createAquariumSuspension({
      bounds, waterLevel, heightAt: sandHeightAt, columns: sandColumns, lighting,
      dx: (bounds.maxX-bounds.minX)/sandSegmentsX, dz: (bounds.maxZ-bounds.minZ)/sandSegmentsZ,
    });
    let trackSettlingSediment = false;
    let settleTime = 0;
    let settling = false;

    const decor = createAquariumDecor({
      scene, bounds, waterLevel, glassInset, height, sandHeightAt, sandPhysics, caustics,
      onChange: refreshLighting,
    });
    const originalStone = ecosystem ? null : decor.add('stone', 'original');
    const originalPlant = ecosystem ? null : decor.add('plant', 'original');
    if (ecosystem) {
      for (const [kind, type, position] of ecosystemDecor) {
        if (!decor.add(kind, type, position)) throw new Error(`生态缸摆位冲突 ${type} (${position})`);
      }
      plantEcosystemCarpet(decor);
      addFilterPipes(scene, caustics);
    } else {
      for (const type of ['dragon', 'slate', 'river']) decor.add('stone', type);
      for (const type of ['monteCarlo', 'tigerVallisneria', 'redRootFloater']) decor.add('plant', type);
      decor.add('stone', 'tripoOhkoWeathered');
      decor.add('plant', 'bladderwort');
      decor.add('plant', 'hornwort');
    }
    decor.updateSandObstacle();
    settling = true;
    const aeration = ecosystem ? createAquariumAeration({
      scene, x: .578, z: .134, waterLevel, heightAt: sandHeightAt, caustics, lighting,
    }) : null;
    caustics.apply(sand.material);
    caustics.apply(sandGrains.material);
    scene.add(sand, sandEdges.mesh, sandGrains.mesh, scannedBed.mesh, suspension.mesh);
    const school = makeFishSchool(scene, sandHeightAt, decor.obstacles,
      (material, receiver) => caustics.apply(material, receiver, renderer));
    if (ecosystem) {
      for (const [type, positions] of Object.entries(ecosystemFish)) {
        for (const [x, z, y] of positions) {
          if (!school.addFish(type, { x, y, z })) throw new Error(`生态缸鱼群入缸失败 ${type} (${x},${z})`);
        }
      }
    } else {
      school.addFish('guppy', { x: -0.07, z: 0.02 });
      school.addFish('pandaCory', { x: 0.16, z: 0.16 });
      school.addFish('otocinclus', { x: -0.2, z: -0.18 });
    }

    let requestedSubstrate = 'original';
    async function setSubstrate(type) {
      requestedSubstrate = type;
      const surface = createAquariumSandMaterial(type);
      if (!surface.loaded) await surface.ready;
      if (requestedSubstrate !== type) return false;
      sandPhysics.setMaterial(type);
      suspension.setBed(type);
      trackSettlingSediment = false;
      for (const mesh of [sand, sandEdges.mesh]) {
        const programChanged = Boolean(mesh.material.roughnessMap) !== Boolean(surface.roughnessMap);
        mesh.material.color.setScalar(surface.wetAlbedoScale);
        mesh.material.map = surface.map;
        mesh.material.normalMap = surface.normalMap;
        mesh.material.roughnessMap = surface.roughnessMap;
        if (programChanged) mesh.material.needsUpdate = true;
      }
      scannedBed.setSurface(surface);
      updateEdgeRelief(surface);
      sand.material.normalScale.setScalar(surface.normalStrength);
      sandEdges.mesh.material.normalScale.setScalar(.82 * surface.normalStrength);
      sandGrains.setSurface(surface);
      sandGrainsDirty = true;
      reflectionDirty = true;
      return true;
    }

    function updateSandObstacle() {
      decor.updateSandObstacle();
      settling = true;
    }

    function addDecor(kind, type) {
      const item = decor.add(kind, type);
      if (item && kind === 'stone') updateSandObstacle();
      return Boolean(item);
    }

    const waterRay = new THREE.Raycaster();
    const feedingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -waterLevel);
    const feedingPoint = new THREE.Vector3();

    function feedAt(pointer) {
      waterRay.setFromCamera(pointer, camera);
      const hit = waterRay.ray.intersectPlane(feedingPlane, feedingPoint);
      if (hit && hit.x >= bounds.minX && hit.x <= bounds.maxX && hit.z >= bounds.minZ && hit.z <= bounds.maxZ) {
        school.dropFood(hit.x, hit.z);
      }
    }

    function sandHeightAt(x, z) {
      if (x < sampleMinX || x > sampleMaxX || z < sampleMinZ || z > sampleMaxZ) return null;
      const uCell = (x - sampleMinX) * sandSegmentsX / (sampleMaxX - sampleMinX);
      const vCell = (z - sampleMinZ) * sandSegmentsZ / (sampleMaxZ - sampleMinZ);
      const col = Math.min(sandSegmentsX - 1, Math.floor(uCell));
      const row = Math.min(sandSegmentsZ - 1, Math.floor(vCell));
      const a = row * sandColumns + col;
      const b = a + sandColumns;
      const d = a + 1;
      const c = b + 1;
      const u = (x - sandPositions.getX(a)) / (sandPositions.getX(d) - sandPositions.getX(a));
      const v = (z - sandPositions.getZ(a)) / (sandPositions.getZ(b) - sandPositions.getZ(a));
      const hyB = sandPositions.getY(b);
      const hyD = sandPositions.getY(d);
      // PlaneGeometry splits every square across the b–d diagonal.
      if (u + v <= 1) return sandPositions.getY(a) * (1 - u - v) + hyB * v + hyD * u;
      return hyB * (1 - u) + sandPositions.getY(c) * (u + v - 1) + hyD * (1 - v);
    }

    function syncSandHeights(showTransport = false) {
      if (showTransport) suspension.transport(sandPositions, sandPhysics.heights);
      for (let i = 0; i < sandPositions.count; i += 1) {
        sandPositions.setY(i, sandPhysics.heights[i]);
      }
      sandPositions.needsUpdate = true;
      sand.geometry.computeVertexNormals();
      sand.geometry.computeBoundingBox();
      sand.geometry.computeBoundingSphere();
      sandEdges.syncHeights();
      scannedBed.syncHeights();
      sandGrainsDirty = true;
      renderer.shadowMap.needsUpdate = true;
    }

    function beginSandStroke(point) {
      if (decor.tiltChanged(0.001)) updateSandObstacle();
      const started = sandPhysics.beginStroke(point.x, point.z, sandBrushRadius);
      if (started) suspension.beginStroke();
      return started;
    }

    function sculptSand(deltaHeight) {
      const changed = sandPhysics.deform(deltaHeight);
      if (changed) syncSandHeights(true);
      return changed;
    }

    function endSandStroke(keep) {
      suspension.endStroke(keep);
      if (sandPhysics.endStroke(keep)) syncSandHeights();
      if (keep) {
        trackSettlingSediment = true;
        if (decor.tiltChanged(0.001)) updateSandObstacle();
        settling = true;
      }
    }

    function settleSand(frameSeconds) {
      if (!settling || !(frameSeconds > 0)) return false;
      if (decor.tiltChanged(Math.PI / 90)) updateSandObstacle();
      settleTime += Math.min(frameSeconds, settleStep * 4);
      let changed = false;
      while (settleTime >= settleStep) {
        settleTime -= settleStep;
        if (!sandPhysics.settle(2, settleStep / 2)) {
          settling = decor.tiltChanged(0.001);
          if (settling) updateSandObstacle();
          settleTime = 0;
          break;
        }
        changed = true;
      }
      if (changed) syncSandHeights(trackSettlingSediment);
      if (!settling) trackSettlingSediment = false;
      return changed;
    }

    const markerMaterial = new THREE.MeshBasicMaterial({
      color: '#b6fba6', transparent: true, opacity: 0.96, side: THREE.DoubleSide,
      depthWrite: false, toneMapped: false,
    });
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.0174, markerRadius, 44), markerMaterial);
    const markerZ = new THREE.Vector3(0, 0, 1);
    const markerNormal = new THREE.Vector3();
    marker.visible = false;
    marker.renderOrder = 2;
    scene.add(marker);

    function setMarker(position, valid, surfaceNormal, radius = markerRadius) {
      marker.visible = position != null;
      if (!marker.visible) return;
      marker.scale.setScalar(radius / markerRadius);
      if (surfaceNormal) markerNormal.copy(surfaceNormal).normalize();
      else markerNormal.set(0, 1, 0);
      marker.quaternion.setFromUnitVectors(markerZ, markerNormal);
      marker.position.copy(position).addScaledVector(markerNormal, 0.0012);
      markerMaterial.color.setHex(valid ? 0xb6fba6 : 0xffaa8f);
    }

    function updateCamera() {
      const horizontal = Math.cos(elevation);
      cameraDirection.set(Math.sin(azimuth) * horizontal, Math.sin(elevation), Math.cos(azimuth) * horizontal);
      if (orbitRadius === null) {
        orbitRadius = Math.max(3.52, 2.47 / camera.aspect);
        viewRadius = orbitRadius;
        maxRadius = orbitRadius * 1.7;
      }
      camera.position.copy(target).addScaledVector(cameraDirection, orbitRadius);
      const wideView = THREE.MathUtils.smoothstep(orbitRadius, 0.95, 2.65);
      const windowOffset = camera.aspect >= 1.25 ? 0.13 * wideView * Math.max(0, Math.cos(azimuth)) : 0;
      camera.lookAt(target.x + windowOffset, target.y - 0.18 * wideView, target.z);
      camera.updateMatrixWorld();
      if (fitOpeningView) {
        camera.clearViewOffset();
        const frame = new THREE.Box2();
        for (const x of [-width / 2, width / 2]) {
          for (const y of [0, height]) {
            for (const z of [-depth / 2, depth / 2]) {
              const corner = new THREE.Vector3(x, y, z).project(camera);
              frame.expandByPoint(new THREE.Vector2(corner.x, corner.y));
            }
          }
        }
        // Match the reference margins while keeping the full tank visible on narrow screens.
        const size = frame.getSize(new THREE.Vector2());
        const fit = Math.max(size.x / (2 * 0.865), size.y / (2 * 0.73));
        viewRadius = fit * orbitRadius;
        frame.getCenter(viewCenter).multiplyScalar(orbitRadius);
        viewCenter.x += camera.aspect >= 1.25 ? 0.075 * viewRadius : 0;
        viewCenter.y -= 0.19 * viewRadius;
      }
      // Crop the perspective view so near and far details share the same zoom anchor.
      const span = viewRadius / orbitRadius;
      const left = (1 - span + viewCenter.x / orbitRadius) / 2;
      const top = (1 - span - viewCenter.y / orbitRadius) / 2;
      const aspect = camera.aspect;
      camera.setViewOffset(aspect, 1, left * aspect, top, span * aspect, span);
      livingRoom?.userData.updateView(camera.position);

      glass.updateView(camera);
      sandGrains.updateView(viewRadius);
      scannedBed.updateView(viewRadius);
      reflectionDirty = true;
    }

    const drawingSize = new THREE.Vector2();
    let closeRefraction = false;
    function resizeRefractionCapture() {
      renderer.getDrawingBufferSize(drawingSize);
      closeRefraction = viewRadius < (closeRefraction ? 1.62 : 1.45);
      const scale = closeRefraction ? Math.min(1, 1920 / Math.max(drawingSize.x, drawingSize.y)) : 1;
      refractionTarget.setSize(
        Math.max(1, Math.round(drawingSize.x * scale)),
        Math.max(1, Math.round(drawingSize.y * scale)),
      );
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const isMobile = navigator.userAgentData?.mobile || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const pixelRatio = isMobile ? Math.min((window.devicePixelRatio || 1) * 1.25, 2.25) : 3;
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      updateCamera();
      resizeRefractionCapture();
    }

    function frameFront(elevationDegrees = 9) {
      azimuth = 0;
      elevation = THREE.MathUtils.degToRad(elevationDegrees);
      fitOpeningView = true;
      updateCamera();
      resizeRefractionCapture();
    }

    function orbit(deltaX, deltaY) {
      fitOpeningView = false;
      azimuth = (azimuth - deltaX * radiansPerPixel) % (Math.PI * 2);
      elevation = THREE.MathUtils.clamp(elevation + deltaY * radiansPerPixel, minElevation, maxElevation);
      updateCamera();
    }

    function zoom(scale, anchor) {
      if (viewRadius === null || !Number.isFinite(scale) || scale <= 0) return;
      const nextRadius = THREE.MathUtils.clamp(viewRadius * scale, anchor ? minViewRadius : minOrbitRadius, maxRadius);
      if (nextRadius === viewRadius) return;
      fitOpeningView = false;
      if (anchor) {
        const limit = maxRadius - nextRadius;
        viewCenter.addScaledVector(anchor, viewRadius - nextRadius).clampScalar(-limit, limit);
      } else {
        // Preset views position the camera at a specific distance from the tank.
        orbitRadius = nextRadius;
        viewCenter.set(0, 0);
      }
      viewRadius = nextRadius;
      updateCamera();
      resizeRefractionCapture();
    }

    function captureOptics() {
      const previousTarget = renderer.getRenderTarget();
      // Keep the far glass in the refraction image and omit surfaces that sample it.
      glass.setNearVisible(false);
      water.surface.visible = false;
      try {
        renderer.setRenderTarget(refractionTarget);
        renderer.render(scene, camera);
        if (reflectionDirty) {
          opticalSurfaces.visible = false;
          water.renderReflection(renderer, scene, camera);
          reflectionDirty = false;
        }
      } finally {
        opticalSurfaces.visible = true;
        water.surface.visible = true;
        glass.setNearVisible(true);
        renderer.setRenderTarget(previousTarget);
      }
    }

    let lastPlantShadowUpdate = -Infinity;
    let lastLightingHour = NaN;
    let lastLightingRefresh = -Infinity;

    function refreshLighting() {
      reflectionDirty = true;
      renderer.shadowMap.needsUpdate = true;
    }

    function setLightingHour(hour) {
      daylight.setHour(hour);
      refreshLighting();
    }

    function setLightingMode(mode) {
      daylight.setMode(mode);
      refreshLighting();
    }

    function render(timeSeconds = 0, frameSeconds = 0) {
      if (!livingRoom) return;
      const hour = daylight.update(timeSeconds);
      updateLights();
      const difference = Math.abs(hour - lastLightingHour);
      if (!Number.isFinite(lastLightingHour) ||
          (Math.min(difference, 24 - difference) >= 0.035 && timeSeconds - lastLightingRefresh >= 0.14)) {
        refreshLighting();
        lastLightingHour = hour;
        lastLightingRefresh = timeSeconds;
      }
      livingRoom.userData.updateBreeze?.(timeSeconds);
      // Editing uses the same unwarped positions as the picking rays.
      refractionStrength.value = canvas.dataset?.tool ? 0 : 1;
      water.update(timeSeconds, camera);
      aeration?.update(timeSeconds);
      decor.updateSway(timeSeconds);
      const movingPlantShadow = viewRadius < 2.1 && timeSeconds - lastPlantShadowUpdate >= 0.20
        && (lighting.uDaySun.value > 0.08 || lighting.uDayLamp.value > 0.2);
      if (movingPlantShadow) {
        lastPlantShadowUpdate = timeSeconds;
        renderer.shadowMap.needsUpdate = true;
      }
      school.update(frameSeconds);
      suspension.update(frameSeconds, canvas.height);
      if (sandGrainsDirty && sandGrains.mesh.visible) {
        sandGrains.syncHeights(sandHeightAt);
        sandGrainsDirty = false;
      }
      captureOptics();
      renderer.render(scene, camera);
    }

    resize();
    scene.updateMatrixWorld(true);

    const ready = Promise.all([window.loadAquariumLivingRoomModel(), ...decor.items.map(item => item.ready)]).then(([model]) => {
      if (!model) throw new Error('缺少客厅素材');
      prepareRoomDaylight(model, lighting);
      model.userData.updateView(camera.position);
      scene.add(model);
      livingRoom = model;
    });

    return {
      ready, renderer, scene, camera, sand, decor, marker, bounds, sandBrushRadius, resize, frameFront, orbit, zoom, render,
      stone: originalStone?.object, plant: originalPlant?.object, plantPick: originalPlant?.plantPick,
      plantBounds: originalPlant?.plantBounds, plantRadius: originalPlant?.rootRadius, start: originalPlant?.object.position.clone(),
      stoneFootprint: originalStone?.footprint, stoneGroundOffset: .017,
      stoneSeatHeight: (x, z, rotation) => originalStone && decor.stoneSeatHeight(originalStone, x, z, rotation),
      setMarker, sandHeightAt, updateSandObstacle, addDecor, setSubstrate, addFish: school.addFish,
      beginSandStroke, sculptSand, endSandStroke, settleSand, feedAt,
      getLighting: daylight.getState, setLightingHour, setLightingMode,
    };
  };
})();
