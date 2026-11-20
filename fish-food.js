function createAquariumFood({ scene, bounds, waterLevel, groundHeight, stone, stones }) {
  const glassMargin = 0.043;
  const lifetime = 19;
  const restLifetime = 3;
  const supportTolerance = 0.0003;
  const maxPellets = 45;
  const pattern = [
    { x: 0, z: 0, radius: 0.0029, sink: 0.024, depth: 0.005 },
    { x: 0.012, z: -0.004, radius: 0.0025, sink: 0.020, depth: 0.009 },
    { x: -0.010, z: -0.008, radius: 0.0027, sink: 0.027, depth: 0.007 },
    { x: -0.005, z: 0.012, radius: 0.0024, sink: 0.022, depth: 0.012 },
    { x: 0.008, z: 0.010, radius: 0.0026, sink: 0.025, depth: 0.004 },
  ];
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const materials = ['#a45130', '#bc7337', '#914c2b'].map((color) => new THREE.MeshStandardMaterial({
    color, roughness: 0.84,
  }));
  const group = new THREE.Group();
  const active = [];
  const visuals = new Map();
  let nextId = 1;
  let dropAngle = 0;
  scene.add(group);

  function limitX(x) {
    return THREE.MathUtils.clamp(x, bounds.minX + glassMargin, bounds.maxX - glassMargin);
  }

  function limitZ(z) {
    return THREE.MathUtils.clamp(z, bounds.minZ + glassMargin, bounds.maxZ - glassMargin);
  }

  function rockHeight(x, z, radius, rock) {
    const dx = x - rock.x;
    const dz = z - rock.z;
    const inverse = rock.inverseRotation;
    const rx = rock.radiusX + radius;
    const ry = rock.radiusY;
    const rz = rock.radiusZ + radius;
    const localX = (inverse[0] * dx + inverse[6] * dz) / rx;
    const localY = (inverse[1] * dx + inverse[7] * dz) / ry;
    const localZ = (inverse[2] * dx + inverse[8] * dz) / rz;
    // Intersect a vertical line with the tilted ellipsoid and use the upper hit.
    const upX = inverse[3] / rx;
    const upY = inverse[4] / ry;
    const upZ = inverse[5] / rz;
    const a = upX * upX + upY * upY + upZ * upZ;
    const b = localX * upX + localY * upY + localZ * upZ;
    const c = localX * localX + localY * localY + localZ * localZ - 1;
    const discriminant = b * b - a * c;
    if (discriminant <= 0) return -Infinity;
    return rock.y + (Math.sqrt(discriminant) - b) / a;
  }

  function supportHeight(x, z, radius, rocks) {
    let top = groundHeight(x, z);
    if (top === null) return null;
    for (const rock of rocks) top = Math.max(top, rockHeight(x, z, radius, rock));
    return top + radius;
  }

  function readStones() {
    const current = stones ? stones() : [stone()];
    return current.filter(Boolean).map((item) => {
      const rock = { ...item };
      if (rock.inverseRotation) return rock;
      const cos = Math.cos(rock.angle);
      const sin = Math.sin(rock.angle);
      rock.inverseRotation = [cos, 0, sin, 0, 1, 0, -sin, 0, cos];
      return rock;
    });
  }

  function remove(index) {
    const [point] = active.splice(index, 1);
    group.remove(visuals.get(point.id).mesh);
    visuals.delete(point.id);
  }

  function drop(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const centerX = limitX(x);
    const centerZ = limitZ(z);
    const rocks = readStones();
    const cos = Math.cos(dropAngle);
    const sin = Math.sin(dropAngle);
    let added = 0;
    for (const [index, pellet] of pattern.entries()) {
      const positionX = limitX(centerX + pellet.x * cos - pellet.z * sin);
      const positionZ = limitZ(centerZ + pellet.x * sin + pellet.z * cos);
      const support = supportHeight(positionX, positionZ, pellet.radius, rocks);
      if (support === null || support >= waterLevel - pellet.radius) continue;

      if (active.length === maxPellets) remove(0);
      const point = { id: nextId, x: positionX, y: Math.max(support, waterLevel - pellet.depth), z: positionZ };
      nextId += 1;
      const mesh = new THREE.Mesh(geometry, materials[index % materials.length]);
      mesh.scale.set(pellet.radius, pellet.radius * 0.82, pellet.radius);
      mesh.position.set(point.x, point.y, point.z);
      group.add(mesh);
      active.push(point);
      visuals.set(point.id, {
        mesh, radius: pellet.radius, sink: pellet.sink, drift: dropAngle + index * 1.71, age: 0, restAge: 0,
      });
      added += 1;
    }
    dropAngle = (dropAngle + 2.4) % (2 * Math.PI);
    return added;
  }

  function update(dt) {
    if (!active.length || !Number.isFinite(dt) || dt <= 0) return;
    const movementTime = Math.min(dt, 0.12);
    const rocks = readStones();
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const point = active[i];
      const pellet = visuals.get(point.id);
      pellet.age += dt;

      let support = supportHeight(point.x, point.z, pellet.radius, rocks);
      if (support !== null && point.y > support + supportTolerance) {
        const drift = 0.003 * movementTime;
        point.x = limitX(point.x + Math.cos(pellet.drift + pellet.age * 0.72) * drift);
        point.z = limitZ(point.z + Math.sin(pellet.drift + pellet.age * 0.86) * drift);
        support = supportHeight(point.x, point.z, pellet.radius, rocks);
      }

      if (support === null || support >= waterLevel - pellet.radius) {
        remove(i);
        continue;
      }
      // A pellet needs time on the bottom even when its fall lasts longer than its usual lifetime.
      pellet.restAge = point.y <= support + supportTolerance ? pellet.restAge + movementTime : 0;
      if (pellet.age >= lifetime && pellet.restAge >= restLifetime) {
        remove(i);
        continue;
      }
      point.y = Math.max(support, point.y - pellet.sink * movementTime);
      pellet.mesh.position.set(point.x, point.y, point.z);
    }
  }

  function eat(id) {
    const index = active.findIndex((point) => point.id === id);
    if (index === -1) return false;
    remove(index);
    return true;
  }

  return { drop, update, points: () => active, eat };
}
