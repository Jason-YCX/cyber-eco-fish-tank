(function () {
  'use strict';

  const wallDirections = [
    { name: 'RoomWallBack', axis: 'z', inward: 1 },
    { name: 'RoomWallFront', axis: 'z', inward: -1 },
    { name: 'RoomWallLeft', axis: 'x', inward: 1 },
    { name: 'RoomWallRight', axis: 'x', inward: -1 },
    { name: 'RoomCeiling', axis: 'y', inward: -1, optional: true },
  ];

  function decodeModel(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function prepareCurtainBreeze(wall) {
    const sill = wall.getObjectByName('Projecting_interior_window_sill') || wall;
    const windowCenter = sill.getWorldPosition(new THREE.Vector3()).z;
    const point = new THREE.Vector3();
    const influences = [];

    wall.traverse((curtain) => {
      if (!curtain.isMesh || !curtain.name.startsWith('BreezeCurtain')) return;
      const source = curtain.geometry;
      const position = source.getAttribute('position');
      if (!position || Object.keys(source.morphAttributes).length > 0) return;

      const bounds = new THREE.Box3().setFromObject(curtain);
      const height = bounds.max.y - bounds.min.y;
      const width = bounds.max.z - bounds.min.z;
      if (height <= 0 || width <= 0) return;
      const opensTowardMax = bounds.getCenter(point).z < windowCenter;
      const inverse = new THREE.Matrix4().copy(curtain.matrixWorld).invert();
      // Shift the fabric into the room and lift its hem as the breeze arrives.
      const travel = new THREE.Vector3(-0.065, 0.025, 0)
        .applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse));
      const shape = new Float32Array(position.count * 3);
      const alongWave = new Float32Array(shape.length);
      const acrossWave = new Float32Array(shape.length);

      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(curtain.matrixWorld);
        const drop = THREE.MathUtils.clamp((bounds.max.y - point.y) / height, 0, 1);
        const u = THREE.MathUtils.clamp((point.z - bounds.min.z) / width, 0, 1);
        const openEdge = opensTowardMax ? u : 1 - u;
        const looseness = Math.pow(Math.max(0, (drop - 0.04) / 0.96), 1.55);
        const weight = 0.5 * looseness * THREE.MathUtils.lerp(0.53, 1, openEdge);
        const phase = -1.7 * (1 - openEdge) - 1.25 * drop;
        point.copy(travel).multiplyScalar(weight).toArray(shape, i * 3);
        const sine = Math.sin(phase);
        const cosine = Math.cos(phase);
        for (let axis = 0; axis < 3; axis++) {
          const index = i * 3 + axis;
          alongWave[index] = shape[index] * cosine;
          acrossWave[index] = shape[index] * sine;
        }
      }

      // Two phase offsets let the GPU move the cloth with three scalar weights.
      const geometry = source.clone();
      geometry.computeBoundingBox();
      geometry.boundingBox.union(geometry.boundingBox.clone().translate(travel));
      geometry.computeBoundingSphere();
      geometry.boundingSphere.radius += travel.length();
      geometry.morphTargetsRelative = true;
      geometry.morphAttributes.position = [shape, alongWave, acrossWave].map(
        (offsets) => new THREE.BufferAttribute(offsets, 3),
      );
      curtain.geometry = geometry;
      curtain.updateMorphTargets();
      influences.push(curtain.morphTargetInfluences);
    });

    return (timeSeconds) => {
      if (!influences.length || !wall.visible || !Number.isFinite(timeSeconds)) return;
      const strength = 0.73 + 0.27 * Math.sin(timeSeconds * 0.37 + 0.28);
      const phase = timeSeconds * 1.07;
      const sine = strength * Math.sin(phase);
      const cosine = strength * Math.cos(phase);
      for (const weight of influences) {
        weight[0] = strength;
        weight[1] = sine;
        weight[2] = cosine;
      }
    };
  }

  function addFurnitureContactShadows(room) {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot((x + 0.5) * 2 / size - 1, (y + 0.5) * 2 / size - 1);
        const index = (y * size + x) * 4;
        pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
        pixels[index + 3] = 255 * Math.pow(Math.max(0, 1 - distance), 1.35);
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: texture, color: '#22262c', opacity: 0.32, transparent: true, depthWrite: false,
    });

    for (const name of ['AquariumCabinet', 'Sofa', 'CoffeeTable', 'FloorLamp', 'PottedPlant']) {
      const item = room.getObjectByName(name);
      if (!item) continue;
      const bounds = new THREE.Box3().setFromObject(item);
      if (bounds.isEmpty()) continue;
      const { x, z } = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      center.y = Math.max(-0.8, bounds.min.y) + 0.002;
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(x + 0.14, z + 0.14), material);
      shadow.position.copy(room.worldToLocal(center));
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = -1;
      room.add(shadow);
    }
  }

  // The exported furniture shares one lighting atlas. Give each finish its
  // own near-field scan while retaining the baked light and photographed colour.
  const roomFinishes = [
    { match: /cushion|upholstered|padded track arm|sofa back frame/i, scan: 'linen', period: .093, strength: .68 },
    { match: /curtain/i, scan: 'linen', period: .066, strength: .38 },
    { match: /rug/i, scan: 'wool', period: .103, strength: .82 },
    { match: /oak plank floor/i, scan: 'floor', period: .27, strength: .46 },
    { match: /cabinet|oak door slab|flush back panel/i, scan: 'veneer', period: .22, strength: .44 },
    { match: /stoneware planter|stone floor|^soil$/i, scan: 'mineral', period: .085, strength: .48 },
    { match: /mineral wall|wall header|wall .*pier|hall .*wall|ceiling/i, scan: 'mineral', period: .047, strength: .15 },
  ];

  async function loadRoomScans() {
    const loader = new THREE.TextureLoader();
    return new Map(await Promise.all(Object.entries(window.AQUARIUM_ROOM_GRAIN).map(async ([name, jpeg]) => {
      const map = await loader.loadAsync('data:image/jpeg;base64,' + jpeg);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 8;
      return [name, map];
    })));
  }

  window.loadAquariumLivingRoomModel = async function () {
    const encoded = window.AQUARIUM_LIVING_ROOM_GLB;
    if (!encoded || !window.AquariumGLTFLoader) return null;

    // Parsing bundled bytes keeps the Demo usable directly from file://.
    const [{ scene: room }, scans] = await Promise.all([
      new window.AquariumGLTFLoader().parseAsync(decodeModel(encoded), ''), loadRoomScans(),
    ]);
    room.name = 'living-room-model';
    room.updateMatrixWorld(true);
    const walls = wallDirections.flatMap(({ name, axis, inward, optional }) => {
      const object = room.getObjectByName(name);
      if (!object && optional) return [];
      if (!object) throw new Error(`客厅模型缺少墙面节点 ${name}`);
      const plane = object.getWorldPosition(new THREE.Vector3())[axis];
      // Curtains and window trim can protrude well inside the structural wall.
      const bounds = new THREE.Box3().setFromObject(object);
      const edge = inward === 1 ? Math.max(plane, bounds.max[axis]) : Math.min(plane, bounds.min[axis]);
      return [{ object, axis, inward, edge }];
    });

    let hasBakedLighting = false;
    const detailedMaterials = new Map();
    room.traverse((object) => {
      if (!object.isMesh) return;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const baked = material.name === 'Room baked daylight';
        const tabletop = material.name === 'Cabinet top baked daylight';
        if (baked || tabletop || material.name === 'Window sky photograph') material.toneMapped = false;
        if (tabletop && material.map) material.map.anisotropy = 8;
        if ((baked || tabletop) && !Array.isArray(object.material)) {
          const finish = roomFinishes.find(item => item.match.test(object.name.replace(/_/g, ' ')));
          if (finish) {
            const key = material.uuid + finish.match.source;
            if (!detailedMaterials.has(key)) {
              const detailed = material.clone();
              detailed.userData.roomGrain = { map: scans.get(finish.scan), period: finish.period, strength: finish.strength };
              detailedMaterials.set(key, detailed);
            }
            object.material = detailedMaterials.get(key);
          }
        }
        hasBakedLighting ||= baked;
      }
    });
    if (!hasBakedLighting) addFurnitureContactShadows(room);
    room.userData.updateBreeze = prepareCurtainBreeze(room.getObjectByName('RoomWallRight'));
    room.userData.updateView = (cameraPosition) => {
      for (const { object, axis, inward, edge } of walls) {
        object.visible = (cameraPosition[axis] - edge) * inward > 0;
      }
    };
    return room;
  };
})();
