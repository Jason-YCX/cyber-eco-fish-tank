(function () {
  'use strict';

  const floorY = -0.80;
  const backZ = -1.03;
  const frontZ = 3.12;
  const halfWidth = 2.38;
  const wallHeight = 2.75;
  const cabinetTopY = -0.0045;

  const material = (color, roughness = 0.85, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });

  function group(parent, name, x = 0, y = 0, z = 0) {
    const object = new THREE.Group();
    object.name = name;
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }

  function mesh(parent, geometry, surface, x, y, z) {
    const object = new THREE.Mesh(geometry, surface);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }

  function box(parent, surface, width, height, depth, x, y, z) {
    return mesh(parent, new THREE.BoxGeometry(width, height, depth), surface, x, y, z);
  }

  function cylinder(parent, surface, top, bottom, height, x, y, z) {
    return mesh(parent, new THREE.CylinderGeometry(top, bottom, height, 24), surface, x, y, z);
  }

  function roundBox(parent, surface, width, height, depth, radius, x, y, z) {
    const bevel = Math.min(radius * 0.30, depth * 0.24);
    const w = width / 2 - bevel;
    const h = height / 2 - bevel;
    const r = Math.min(radius - bevel, w, h);
    const shape = new THREE.Shape();
    shape.moveTo(-w + r, -h);
    shape.lineTo(w - r, -h);
    shape.quadraticCurveTo(w, -h, w, -h + r);
    shape.lineTo(w, h - r);
    shape.quadraticCurveTo(w, h, w - r, h);
    shape.lineTo(-w + r, h);
    shape.quadraticCurveTo(-w, h, -w, h - r);
    shape.lineTo(-w, -h + r);
    shape.quadraticCurveTo(-w, -h, -w + r, -h);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth - 2 * bevel, bevelEnabled: true, bevelSegments: 3,
      bevelSize: bevel, bevelThickness: bevel, curveSegments: 5,
    });
    geometry.translate(0, 0, -depth / 2 + bevel);
    geometry.computeVertexNormals();
    return mesh(parent, geometry, surface, x, y, z);
  }

  function texture(size, pixel) {
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) pixel(pixels, 4 * (y * size + x), x, y, size);
    }
    const map = new THREE.DataTexture(pixels, size, size);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  }

  function woodGrain() {
    return texture(128, (pixels, index, x, y, size) => {
      const u = x / size;
      const v = y / size;
      const wave = v * 192 + Math.sin(u * 7 + v * 13) * 1.5 + Math.sin(u * 13 + v * 25) * 0.38;
      const streak = Math.sin(wave) * 6 + Math.sin(wave * 0.47) * 6 + Math.sin(wave * 2.5) * 2;
      const lightness = Math.round(225 + streak + Math.sin(u * 3 + v * 56) * 3);
      pixels[index] = lightness;
      pixels[index + 1] = lightness;
      pixels[index + 2] = lightness;
      pixels[index + 3] = 255;
    });
  }

  function shadowMaterial() {
    const map = texture(32, (pixels, index, x, y, size) => {
      const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      pixels[index + 3] = 255 * Math.pow(Math.max(0, 1 - radius * radius), 2);
    });
    return new THREE.MeshBasicMaterial({
      color: '#332b22', transparent: true, map, opacity: 0.32, depthWrite: false,
    });
  }

  function contactShadow(parent, surface, x, z, width, depth, y = floorY + 0.002) {
    const shadow = mesh(parent, new THREE.PlaneGeometry(width, depth), surface, x, y, z);
    shadow.rotation.x = -Math.PI / 2;
    return shadow;
  }

  function makeFloor(parent, grain) {
    const floor = group(parent, 'living-room-floor');
    const width = halfWidth * 2;
    const depth = frontZ - backZ;
    const underlay = mesh(floor, new THREE.PlaneGeometry(width, depth), material('#79624e'),
      0, floorY - 0.001, (frontZ + backZ) * 0.5);
    underlay.rotation.x = -Math.PI / 2;

    const boards = [];
    const rows = 25;
    const boardWidth = depth / rows;
    const boardLength = 1.13;
    for (let row = 0; row < rows; row += 1) {
      const offset = row * 0.41 % boardLength;
      for (let segment = -1; segment < 6; segment += 1) {
        const edge = -halfWidth + offset + boardLength * segment;
        const start = Math.max(-halfWidth, edge);
        const end = Math.min(halfWidth, edge + boardLength);
        if (end <= start) continue;
        boards.push([start, end, backZ + boardWidth * (row + 0.5), row, segment]);
      }
    }

    const surface = material('#ffffff', 0.78);
    surface.map = grain;
    const wood = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), surface, boards.length);
    const transform = new THREE.Object3D();
    transform.rotation.x = -Math.PI / 2;
    const base = new THREE.Color('#b39271');
    const tint = new THREE.Color();
    for (const [index, [start, end, z, row, segment]] of boards.entries()) {
      transform.position.set((start + end) * 0.5, floorY, z);
      transform.scale.set(end - start - 0.0016, boardWidth - 0.0016, 1);
      transform.updateMatrix();
      wood.setMatrixAt(index, transform.matrix);
      tint.copy(base).multiplyScalar(0.94 + 0.060 * Math.sin(row * 4.7 + segment * 8.23) + 0.05 * Math.cos(segment + row * 2.95));
      wood.setColorAt(index, tint);
    }
    wood.instanceMatrix.needsUpdate = true;
    wood.instanceColor.needsUpdate = true;
    wood.computeBoundingSphere();
    floor.add(wood);
  }

  function makeWindow(wall) {
    const window = group(wall, 'living-room-window', 1.00, 0.54, backZ);
    const width = 1.17;
    const height = 1.04;
    const frame = material('#d3c8ae');
    const jamb = material('#6c7776');
    box(window, jamb, width + 0.095, height + 0.08, 0.018, 0, 0, 0.009);
    const geometry = new THREE.PlaneGeometry(width, height);
    const colors = new Float32Array(12);
    const high = new THREE.Color('#abcbd9');
    const low = new THREE.Color('#eef0d9');
    for (let index = 0; index < 4; index += 1) {
      colors.set((geometry.attributes.position.getY(index) > 0 ? high : low).toArray(), index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mesh(window, geometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 0, 0, 0.020);
    for (const x of [-width * 0.5, 0, width * 0.5]) {
      box(window, frame, 0.028, height + 0.04, 0.043, x, 0, 0.035);
    }
    for (const y of [-height * 0.5, 0.09, height * 0.5]) {
      box(window, frame, width + 0.025, 0.029, 0.043, 0, y, 0.035);
    }
    box(window, frame, width + 0.11, 0.039, 0.13, 0, -height * 0.5 - 0.02, 0.062);

    const curtain = material('#d8c8ad', 0.96);
    const rod = material('#6a6050', 0.6, 0.32);
    const support = cylinder(window, rod, 0.009, 0.009, width + 0.36, 0, height * 0.5 + 0.083, 0.105);
    support.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const panels = new THREE.PlaneGeometry(0.17, height + 0.12, 11, 4);
      const vertices = panels.attributes.position;
      for (let i = 0; i < vertices.count; i += 1) {
        const x = vertices.getX(i);
        const y = vertices.getY(i);
        vertices.setX(i, x * (1 + 0.18 * (height * 0.5 - y)));
        vertices.setZ(i, 0.024 * Math.cos(x * 152 + y * 2) + 0.009 * Math.cos(x * 62));
      }
      panels.computeVertexNormals();
      mesh(window, panels, curtain, side * (width * 0.5 + 0.035), 0.014, 0.115);
    }
  }

  function makeWallArt(wall) {
    const darkWood = material('#74543b');
    const paper = new THREE.MeshBasicMaterial({ color: '#ddd0b5', toneMapped: false });
    const earth = new THREE.MeshBasicMaterial({ color: '#ad694f', toneMapped: false });
    const sage = new THREE.MeshBasicMaterial({ color: '#6f8270', toneMapped: false });
    const gold = new THREE.MeshBasicMaterial({ color: '#bd8d50', toneMapped: false });
    const first = group(wall, 'living-room-wall-art', -0.95, 0.47, backZ);
    box(first, darkWood, 0.37, 0.44, 0.032, 0, 0, 0.015);
    mesh(first, new THREE.PlaneGeometry(0.337, 0.407), paper, 0, 0, 0.033);
    mesh(first, new THREE.CircleGeometry(0.065, 28), gold, 0.059, 0.073, 0.034);
    const curve = new THREE.Shape();
    curve.moveTo(-0.169, -0.141);
    curve.quadraticCurveTo(-0.058, 0.066, 0.01, -0.024);
    curve.quadraticCurveTo(0.10, -0.133, 0.169, -0.048);
    curve.lineTo(0.169, -0.2035);
    curve.lineTo(-0.169, -0.2035);
    curve.closePath();
    mesh(first, new THREE.ShapeGeometry(curve), sage, 0, 0, 0.035);
    const second = group(wall, 'living-room-wall-art-small', -1.32, 0.38, backZ);
    box(second, darkWood, 0.24, 0.31, 0.032, 0, 0, 0.015);
    mesh(second, new THREE.PlaneGeometry(0.208, 0.277), paper, 0, 0, 0.033);
    mesh(second, new THREE.CircleGeometry(0.065, 24, 0, Math.PI), earth, 0, -0.035, 0.034);
    mesh(second, new THREE.PlaneGeometry(0.13, 0.014), gold, 0, -0.056, 0.034);
  }

  function makeWalls(parent) {
    const outside = floorY + wallHeight * 0.5;
    const plaster = material('#a8aca0', 0.98);
    const sidePlaster = material('#bab09c', 0.98);
    const trim = material('#c6b89f');
    const back = group(parent, 'living-room-back-wall');
    mesh(back, new THREE.PlaneGeometry(2 * halfWidth, wallHeight), plaster, 0, outside, backZ);
    box(back, trim, halfWidth * 2, 0.081, 0.026, 0, floorY + 0.0405, backZ + 0.016);
    makeWindow(back);
    makeWallArt(back);

    const left = group(parent, 'living-room-left-wall');
    const right = group(parent, 'living-room-right-wall');
    const depth = frontZ - backZ;
    const middleZ = (backZ + frontZ) * 0.5;
    mesh(left, new THREE.PlaneGeometry(depth, wallHeight), sidePlaster, -halfWidth, outside, middleZ).rotation.y = Math.PI / 2;
    mesh(right, new THREE.PlaneGeometry(depth, wallHeight), sidePlaster, halfWidth, outside, middleZ).rotation.y = -Math.PI / 2;
    box(left, trim, 0.026, 0.081, depth, -halfWidth + 0.015, floorY + 0.0405, middleZ);
    box(right, trim, 0.026, 0.081, depth, halfWidth - 0.015, floorY + 0.0405, middleZ);
    return { back, left, right };
  }

  function makeCabinet(parent, shadows) {
    const cabinet = group(parent, 'aquarium-cabinet');
    contactShadow(cabinet, shadows, 0, 0.015, 1.24, 0.78);
    const edge = material('#775038', 0.61);
    const body = material('#936140', 0.72);
    const door = material('#a16c49', 0.72);
    const recess = material('#49392f');
    const handle = material('#bc9260', 0.43, 0.5);
    const topThickness = 0.034;
    const top = box(cabinet, edge, 0.94, topThickness, 0.50, 0, cabinetTopY - topThickness * 0.5, 0);
    top.name = 'aquarium-cabinet-top';
    top.receiveShadow = true;
    roundBox(cabinet, body, 0.905, 0.6595, 0.467, 0.018, 0, -0.36375, 0);
    box(cabinet, recess, 0.87, 0.589, 0.012, 0, -0.379, 0.235);
    for (const side of [-1, 1]) {
      roundBox(cabinet, door, 0.423, 0.584, 0.021, 0.006, side * 0.215, -0.378, 0.245);
      for (let i = 0; i < 8; i += 1) {
        const x = side * 0.215 - 0.166 + i * 0.0474;
        box(cabinet, body, 0.0022, 0.568, 0.0012, x, -0.378, 0.2559);
      }
      roundBox(cabinet, handle, 0.015, 0.077, 0.018, 0.004, side * 0.043, -0.327, 0.259);
      for (const z of [-0.171, 0.171]) {
        cylinder(cabinet, recess, 0.033, 0.022, 0.109, side * 0.363, floorY + 0.0545, z);
      }
    }
    return cabinet;
  }

  function makeSofa(parent, shadows) {
    const sofa = group(parent, 'living-room-sofa', -1.24, 0, -0.62);
    contactShadow(sofa, shadows, 0, 0.028, 1.79, 0.96);
    const fabric = material('#8f967d', 0.95);
    const cushion = material('#a4a78b', 0.93);
    const backFabric = material('#a1a587', 0.96);
    const legs = material('#665342');
    const warmPillow = material('#ba835f', 0.92);
    const palePillow = material('#c3b990', 0.98);
    roundBox(sofa, fabric, 1.43, 0.24, 0.655, 0.075, 0, -0.582, 0.046);
    roundBox(sofa, fabric, 1.39, 0.40, 0.163, 0.058, 0, -0.338, -0.231);
    for (const x of [-0.636, 0.636]) {
      roundBox(sofa, fabric, 0.168, 0.36, 0.65, 0.062, x, -0.472, 0.079);
      for (const z of [-0.194, 0.261]) {
        cylinder(sofa, legs, 0.024, 0.018, 0.10, x * 0.88, floorY + 0.05, z);
      }
    }
    for (const x of [-0.268, 0.268]) {
      roundBox(sofa, cushion, 0.519, 0.118, 0.51, 0.045, x, -0.446, 0.105);
      const backing = roundBox(sofa, backFabric, 0.52, 0.322, 0.117, 0.05, x, -0.285, -0.152);
      backing.rotation.x = -0.12;
    }
    const first = roundBox(sofa, warmPillow, 0.235, 0.225, 0.079, 0.041, -0.437, -0.317, -0.001);
    first.rotation.set(-0.26, -0.26, -0.16);
    const second = roundBox(sofa, palePillow, 0.22, 0.195, 0.080, 0.039, 0.409, -0.333, 0.046);
    second.rotation.set(-0.19, 0.37, 0.13);
  }

  function makeRugAndTable(parent, shadows) {
    const rug = group(parent, 'living-room-rug', -1.01, 0, 0.55);
    const edge = material('#9a7d61', 1);
    const weave = material('#beac90', 1);
    const detail = material('#ab9274', 1);
    roundBox(rug, edge, 1.83, 1.29, 0.011, 0.05, 0, floorY + 0.0057, 0).rotation.x = -Math.PI / 2;
    roundBox(rug, weave, 1.79, 1.25, 0.007, 0.046, 0, floorY + 0.0114, 0).rotation.x = -Math.PI / 2;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i += 1) {
        box(rug, detail, 0.007, 0.0007, 1.12, side * (0.811 + i * 0.021), floorY + 0.0152, 0);
      }
    }

    const table = group(parent, 'living-room-coffee-table', -0.98, 0, 0.43);
    contactShadow(table, shadows, 0.02, 0.04, 0.91, 0.67, floorY + 0.0158);
    const top = material('#9c6844', 0.60);
    const dark = material('#655046', 0.79);
    roundBox(table, top, 0.76, 0.46, 0.055, 0.091, 0, -0.441, 0).rotation.x = -Math.PI / 2;
    for (const x of [-0.255, 0.255]) {
      for (const z of [-0.139, 0.139]) {
        const leg = cylinder(table, dark, 0.025, 0.017, 0.32, x, floorY + 0.17, z);
        leg.rotation.z = -Math.sign(x) * 0.08;
      }
    }
    const book = group(table, 'living-room-table-books', -0.092, -0.411, -0.013);
    book.rotation.y = -0.21;
    box(book, material('#798776'), 0.161, 0.023, 0.119, 0, 0.0115, 0);
    box(book, material('#e0d2b7'), 0.147, 0.011, 0.113, 0, 0.013, 0.006);
    box(book, material('#b47b55'), 0.124, 0.011, 0.090, 0.013, 0.0285, 0.005);
    const ceramic = material('#8a7158', 0.56);
    cylinder(table, ceramic, 0.029, 0.021, 0.035, 0.164, -0.3965, 0.037);
    cylinder(table, dark, 0.024, 0.024, 0.003, 0.164, -0.378, 0.037);
  }

  function makeLamp(parent, shadows) {
    const lamp = group(parent, 'living-room-floor-lamp', 0.74, 0, -0.63);
    contactShadow(lamp, shadows, 0, 0, 0.43, 0.34);
    const metal = material('#77644d', 0.43, 0.36);
    cylinder(lamp, metal, 0.126, 0.144, 0.031, 0, floorY + 0.0155, 0);
    cylinder(lamp, metal, 0.012, 0.013, 1.37, 0, floorY + 0.701, 0);
    const shade = new THREE.MeshStandardMaterial({
      color: '#d0b894', emissive: '#cfaa77', emissiveIntensity: 0.22, roughness: 1, side: THREE.DoubleSide,
    });
    mesh(lamp, new THREE.CylinderGeometry(0.138, 0.204, 0.249, 32, 1, true), shade, 0, 0.588, 0);
    cylinder(lamp, metal, 0.021, 0.018, 0.024, 0, 0.721, 0);
  }

  function makeHouseplant(parent, shadows) {
    const plant = group(parent, 'living-room-houseplant', 1.18, floorY, -0.32);
    const pottery = material('#af775e');
    const soil = material('#67513c');
    const stem = material('#6f7445');
    const leaves = [material('#627d54'), material('#78915f'), material('#506e4c')];
    contactShadow(parent, shadows, plant.position.x, plant.position.z, 0.43, 0.37);
    cylinder(plant, pottery, 0.13, 0.100, 0.218, 0, 0.109, 0);
    cylinder(plant, pottery, 0.133, 0.135, 0.026, 0, 0.216, 0);
    cylinder(plant, soil, 0.117, 0.117, 0.007, 0, 0.228, 0);
    const upright = new THREE.Vector3(0, 1, 0);
    const leafGeometry = new THREE.SphereGeometry(1, 12, 8);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * 2.39;
      const height = 0.34 + (index % 4) * 0.081;
      const stemEnd = new THREE.Vector3(Math.cos(angle) * 0.087, height, Math.sin(angle) * 0.087);
      const origin = new THREE.Vector3(0, 0.225, 0);
      const direction = stemEnd.clone().sub(origin);
      const stemMid = origin.clone().addScaledVector(direction, 0.5);
      const stalk = cylinder(plant, stem, 0.0032, 0.0045, direction.length(), stemMid.x, stemMid.y, stemMid.z);
      stalk.quaternion.setFromUnitVectors(upright, direction.normalize());
      const tip = new THREE.Vector3(Math.cos(angle) * 0.71, 0.28 + (index % 3) * 0.2, Math.sin(angle) * 0.71).normalize();
      const leafPosition = stemEnd.clone().addScaledVector(tip, 0.067);
      const leaf = mesh(plant, leafGeometry, leaves[index % leaves.length], leafPosition.x, leafPosition.y, leafPosition.z);
      leaf.scale.set(0.054, 0.112, 0.010);
      leaf.quaternion.setFromUnitVectors(upright, tip);
    }
  }

  window.createAquariumLivingRoom = function (scene) {
    const room = group(scene, 'living-room');
    const shadows = shadowMaterial();
    makeFloor(room, woodGrain());
    const { back, left, right } = makeWalls(room);
    makeCabinet(room, shadows);
    makeSofa(room, shadows);
    makeRugAndTable(room, shadows);
    makeLamp(room, shadows);
    makeHouseplant(room, shadows);

    room.userData.updateView = (cameraPosition) => {
      back.visible = cameraPosition.z > backZ;
      left.visible = cameraPosition.x > -halfWidth;
      right.visible = cameraPosition.x < halfWidth;
    };
    return room;
  };
})();
