(function () {
  'use strict';

  const maxStoneTilt = Math.PI / 18;
  const footprintAxes = Array.from({ length: 16 }, (_, i) =>
    new THREE.Vector3(Math.cos(i * Math.PI / 8), 0, Math.sin(i * Math.PI / 8)));
  const carpetRootProbes = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

  function measurePlacementShape(object) {
    const localBounds = new THREE.Box3();
    const inverse = object.quaternion.clone().invert();
    const localAxes = footprintAxes.map(axis => axis.clone().applyQuaternion(inverse));
    const support = localAxes.map(() => -Infinity);
    const point = new THREE.Vector3();
    object.updateMatrixWorld(true);
    const worldToLocal = object.matrixWorld.clone().invert();
    object.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.material.visible) return;
      const toLocal = worldToLocal.clone().multiply(mesh.matrixWorld);
      const vertices = mesh.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(toLocal);
        localBounds.expandByPoint(point);
        for (let j = 0; j < localAxes.length; j++) {
          support[j] = Math.max(support[j], point.dot(localAxes[j]));
        }
      }
    });
    const rotation = object.quaternion.clone();
    const rotated = support.slice();
    return function atRotation(next) {
      if (rotation.equals(next)) return rotated;
      rotation.copy(next);
      inverse.copy(next).invert();
      // Expand only by the displacement from the actual bed tilt at this spot.
      const { min, max } = localBounds;
      for (let i = 0; i < localAxes.length; i++) {
        const d = point.copy(footprintAxes[i]).applyQuaternion(inverse).sub(localAxes[i]);
        rotated[i] = support[i] + d.x * (d.x < 0 ? min.x : max.x)
          + d.y * (d.y < 0 ? min.y : max.y) + d.z * (d.z < 0 ? min.z : max.z);
      }
      return rotated;
    };
  }
  function measureStoneFootprint(stone) {
    stone.geometry.computeBoundingBox();
    const { min, max } = stone.geometry.boundingBox;
    const radiusX = Math.max(-min.x, max.x);
    const radiusZ = Math.max(-min.z, max.z);
    const vertices = stone.geometry.attributes.position;
    let scale = 1;
    for (let i = 0; i < vertices.count; i += 1) {
      scale = Math.max(scale, Math.hypot(vertices.getX(i) / radiusX, vertices.getZ(i) / radiusZ));
    }
    const tiltPadding = Math.max(-min.y, max.y) * Math.sin(maxStoneTilt)
      + Math.max(radiusX, radiusZ) * scale * (1 - Math.cos(maxStoneTilt));
    return Object.freeze({
      get x() { return stone.position.x; },
      get z() { return stone.position.z; },
      angle: stone.rotation.y,
      radiusX: radiusX * scale,
      radiusZ: radiusZ * scale,
      tiltPadding,
    });
  }

  function sampleStoneUnderside(stone, footprint) {
    stone.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const offsets = [[0, 0]];
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4;
      offsets.push([Math.min(.035, footprint.radiusX * .48) * Math.cos(angle),
        Math.min(.025, footprint.radiusZ * .48) * Math.sin(angle)]);
    }
    const cos = Math.cos(stone.rotation.y);
    const sin = Math.sin(stone.rotation.y);
    const contacts = [];
    for (const [x, z] of offsets) {
      const dx = x * cos + z * sin;
      const dz = -x * sin + z * cos;
      ray.ray.origin.set(stone.position.x + dx, stone.position.y + stone.geometry.boundingBox.min.y - .01, stone.position.z + dz);
      const [hit] = ray.intersectObject(stone, false);
      if (hit) contacts.push(new THREE.Vector3(x, hit.point.y - stone.position.y, z));
    }
    if (!contacts.length) contacts.push(new THREE.Vector3(0, stone.geometry.boundingBox.min.y, 0));
    return contacts;
  }

  function makeFishObstacle(stone, stoneFootprint) {
    const { radiusX, radiusZ } = stoneFootprint;
    const { min, max } = stone.geometry.boundingBox;
    const radiusY = Math.max(-min.y, max.y);
    const vertices = stone.geometry.attributes.position;
    let scale = 1;
    // Fit a conservative ellipsoid around the entire stone mesh in its local space.
    for (let i = 0; i < vertices.count; i += 1) {
      scale = Math.max(scale, Math.hypot(
        vertices.getX(i) / radiusX,
        vertices.getY(i) / radiusY,
        vertices.getZ(i) / radiusZ,
      ));
    }
    const inverseRotation = new THREE.Matrix3();
    return {
      get x() { return stone.position.x; },
      get y() { return stone.position.y; },
      get z() { return stone.position.z; },
      angle: stoneFootprint.angle,
      get inverseRotation() { return inverseRotation.setFromMatrix4(stone.matrixWorld).transpose().elements; },
      radiusX: radiusX * scale,
      radiusY: radiusY * scale,
      radiusZ: radiusZ * scale,
    };
  }

  window.createAquariumDecor = function ({ scene, bounds, waterLevel, glassInset, height, sandHeightAt, sandPhysics, caustics, onChange }) {
    const items = [];
    const stones = [];
    const obstacles = [];
    const stoneUp = new THREE.Vector3(0, 1, 0);
    const seatNormal = new THREE.Vector3();
    const seatRotation = new THREE.Quaternion();
    const inverseSeatRotation = new THREE.Quaternion();
    const offset = new THREE.Vector3();
    const maskRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const hits = [];
    const landingRotation = new THREE.Quaternion();
    // Slope probes may reach beyond a narrow base near the glass.
    function slopeHeight(x, z) {
      return sandHeightAt(THREE.MathUtils.clamp(x, bounds.minX + 1e-7, bounds.maxX - 1e-7),
        THREE.MathUtils.clamp(z, bounds.minZ + 1e-7, bounds.maxZ - 1e-7));
    }
    function stoneSeatHeight(item, x, z, targetRotation) {
      // Average across the base so small changes in individual sand triangles do not jerk the stone.
      const { object: stone, footprint, stoneSupportSamples, stoneBurial, stoneYaw } = item;
      const span = Math.min(0.046, footprint.radiusX * .60, footprint.radiusZ * .60);
      let gradientX = 0;
      let gradientZ = 0;
      for (const side of [-span, 0, span]) {
        const left = slopeHeight(x - span, z + side);
        const right = slopeHeight(x + span, z + side);
        const front = slopeHeight(x + side, z + span);
        const back = slopeHeight(x + side, z - span);
        if (left === null || right === null || front === null || back === null) return null;
        gradientX += (right - left) / (6 * span);
        gradientZ += (front - back) / (6 * span);
      }
      const slope = Math.hypot(gradientX, gradientZ);
      const tilt = Math.min(maxStoneTilt, Math.atan(slope) * 0.72);
      const strength = slope > 0 ? Math.tan(tilt) / slope : 0;
      seatNormal.set(-gradientX * strength, 1, -gradientZ * strength).normalize();
      seatRotation.setFromUnitVectors(stoneUp, seatNormal).multiply(stoneYaw);

      // Project the local bounds onto vertical to keep the tilted underside above the glass floor.
      offset.copy(stoneUp).applyQuaternion(inverseSeatRotation.copy(seatRotation).invert());
      const { min, max } = stone.geometry.boundingBox;
      let y = glassInset + 0.001 - (offset.x * (offset.x < 0 ? max.x : min.x)
        + offset.y * min.y + offset.z * (offset.z < 0 ? max.z : min.z));
      for (const contact of stoneSupportSamples) {
        offset.copy(contact).applyQuaternion(seatRotation);
        const support = sandHeightAt(x + offset.x, z + offset.z);
        if (support === null) return null;
        y = Math.max(y, support - offset.y - stoneBurial);
      }
      targetRotation?.copy(seatRotation);
      return y;
    }

    function makeStone(type, variation) {
      const { mesh, collider, ready } = createAquariumStone(type, variation);
      const footprint = measureStoneFootprint(mesh);
      const stoneSupportSamples = sampleStoneUnderside(mesh, footprint);
      const { radiusX, radiusZ, angle, tiltPadding } = footprint;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const extentX = Math.hypot(radiusX * cos, radiusZ * sin) + tiltPadding;
      const extentZ = Math.hypot(radiusX * sin, radiusZ * cos) + tiltPadding;
      return {
        kind: 'stone', type, object: mesh, footprint, collider, ready, extentX, extentZ,
        markerRadius: Math.max(radiusX, radiusZ) + .009, stoneSupportSamples,
        stoneBurial: type === 'original' ? -stoneSupportSamples[0].y - .017 : Math.min(.004, -mesh.geometry.boundingBox.min.y * .18),
        stoneYaw: mesh.quaternion.clone(), maskRotation: new THREE.Quaternion(),
      };
    }

    function makePlant(type, variation, options) {
      const model = createAquariumPlant(type, variation, options);
      const { min, max } = model.plantBounds;
      const isCarpet = type === 'monteCarlo' || type === 'bladderwort';
      const rootRadius = isCarpet ? .024 : (model.plantRadius ?? .011);
      const extentX = Math.max(-min.x, max.x, rootRadius);
      const extentZ = Math.max(-min.z, max.z, rootRadius);
      return {
        ...model, kind: 'plant', type, object: model.plant, extentX, extentZ, rootRadius, isCarpet,
        markerRadius: Math.max(.0202, rootRadius),
      };
    }

    function carpetRotation(item, x, z, rotation) {
      const span = Math.min(.025, item.extentX, item.extentZ);
      const dx = slopeHeight(x + span, z) - slopeHeight(x - span, z);
      const dz = slopeHeight(x, z + span) - slopeHeight(x, z - span);
      rotation.setFromUnitVectors(stoneUp, seatNormal.set(-dx, 2 * span, -dz).normalize());
    }

    function carpetTouchesRock(item, rock, x, z) {
      // A rock silhouette can overlap a crest where the bed is exposed.
      return carpetRootProbes.some(([dx, dz]) => {
        const rootX = x + dx * item.rootRadius;
        const rootZ = z + dz * item.rootRadius;
        const bed = sandHeightAt(rootX, rootZ);
        if (bed === null) return false;
        maskRay.ray.origin.set(rootX, height, rootZ);
        hits.length = 0;
        maskRay.intersectObject(rock.collider, false, hits);
        return hits.length > 0 && hits[0].point.y > bed + .002;
      });
    }

    function landingReason(item, x, z) {
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return 'outside';
      landingRotation.copy(item.object.quaternion);
      if (item.kind === 'stone') {
        if (stoneSeatHeight(item, x, z, landingRotation) === null) return 'outside';
      } else if (item.isCarpet) {
        carpetRotation(item, x, z, landingRotation);
      }
      const shape = item.placementShape(landingRotation);
      if (x - shape[8] < bounds.minX || x + shape[0] > bounds.maxX ||
          z - shape[12] < bounds.minZ || z + shape[4] > bounds.maxZ) return 'outside';
      for (const other of items) {
        if (other === item || Boolean(item.isFloating) !== Boolean(other.isFloating)) continue;
        // A stone can cover groundcover as it settles onto the bed.
        if (item.kind === 'stone' && other.isCarpet) continue;
        const dx = other.object.position.x - x;
        const dz = other.object.position.z - z;
        const otherShape = other.placementShape(other.object.quaternion);
        // Foliage can overhang its neighbours. Reserve the root patch at the bed.
        const separated = footprintAxes.some((axis, i) => {
          const reach = Math.min(shape[i], item.rootRadius ?? Infinity);
          const opposite = Math.min(otherShape[(i + 8) % 16], other.rootRadius ?? Infinity);
          return dx * axis.x + dz * axis.z >= reach + opposite;
        });
        if (separated) continue;
        if (item.isCarpet && other.kind === 'stone' && !carpetTouchesRock(item, other, x, z)) continue;
        return other.kind;
      }
      return null;
    }

    function seat(item, x, z) {
      const { object } = item;
      let y;
      if (item.kind === 'stone') y = stoneSeatHeight(item, x, z, object.quaternion);
      else if (item.isFloating) y = waterLevel;
      else {
        y = sandHeightAt(x, z);
        if (y !== null && item.isCarpet) {
          carpetRotation(item, x, z, object.quaternion);
        }
      }
      if (y === null) return false;
      if (item.type === 'hornwort') object.scale.y = Math.min(1, (waterLevel - y - .008)/item.plantBounds.max.y);
      object.position.set(x, y, z);
      object.updateMatrixWorld(true);
      return true;
    }

    const startingPlaces = {
      stone: { original: [.31, -.075], dragon: [-.42, -.13], tripoOhko: [-.16, -.08], tripoOhkoWeathered: [-.16, -.08], slate: [.08, .085], river: [.49, .13] },
      plant: { hornwort: [.51, -.19], original: [-.35, .11], monteCarlo: [-.10, .15], bladderwort: [-.28, .20], tigerVallisneria: [.06, -.16], redRootFloater: [-.38, .035] },
    };

    function add(kind, type, position, options) {
      const preferred = startingPlaces[kind]?.[type];
      if (!Array.isArray(preferred)) return null;
      const variation = items.filter((item) => item.kind === kind && item.type === type).length;
      const item = kind === 'stone' ? makeStone(type, variation % 2) : makePlant(type, variation % 3, options);
      item.placementShape = measurePlacementShape(item.object);
      function place(x, z) {
        return !landingReason(item, x, z) && seat(item, x, z);
      }
      let placed = position ? place(...position) : place(...preferred);
      if (position && !placed) return null;
      // Try the same area first, then the other open patches in the tank.
      for (let row = 0; row < 5 && !placed; row += 1) {
        for (let col = 0; col < 13 && !placed; col += 1) {
          const x = bounds.minX + (bounds.maxX - bounds.minX) * ((col + variation * 5) % 13 + .5) / 13;
          const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * ((row + variation * 2) % 5 + .5) / 5;
          placed = place(x, z);
        }
      }
      // Search close to the glass too. The exact legal outline depends on the local slope.
      const left = bounds.minX, right = bounds.maxX;
      const back = bounds.minZ, front = bounds.maxZ;
      if (!placed && left <= right && back <= front) {
        const columns = Math.max(1, Math.ceil((right - left) / .02));
        const rows = Math.max(1, Math.ceil((front - back) / .02));
        for (let row = 0; row <= rows && !placed; row++) {
          for (let col = 0; col <= columns && !placed; col++) {
            placed = place(left + (right - left) * col / columns, back + (front - back) * row / rows);
          }
        }
      }
      if (!placed) return null;
      item.object.traverseVisible((node) => {
        if (node.isMesh && node.material.visible) caustics.apply(node.material, kind);
      });
      scene.add(item.object);
      items.push(item);
      if (kind === 'stone') {
        stones.push(item);
        obstacles.push(makeFishObstacle(item.object, item.footprint));
      }
      onChange();
      return item;
    }

    function updateSandObstacle() {
      for (const item of stones) {
        item.object.updateMatrixWorld(true);
        item.maskRotation.copy(item.object.quaternion);
      }
      sandPhysics.setBlocked((x, z) => {
        for (const item of stones) {
          const center = item.object.position;
          if (Math.abs(x - center.x) > item.extentX || Math.abs(z - center.z) > item.extentZ) continue;
          maskRay.ray.origin.set(x, height, z);
          hits.length = 0;
          maskRay.intersectObject(item.collider, false, hits);
          if (hits.length) return true;
        }
        return false;
      });
    }

    function updateSway(time) {
      for (const item of items) item.updateSway?.(time);
    }

    function reseat() {
      for (const item of items) seat(item, item.object.position.x, item.object.position.z);
      onChange();
    }

    return {
      items, obstacles, add, seat, reseat, landingReason, stoneSeatHeight, updateSandObstacle,
      waterLevel, updateSway, onChange,
      tiltChanged: (limit) => stones.some((item) => item.maskRotation.angleTo(item.object.quaternion) > limit),
    };
  };
})();
