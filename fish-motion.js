function createFishMotion({ bounds, waterLevel, groundHeight, stone, stones, fishSpecs, food = () => [], eat = () => false }) {
  const turnLimit = 2.8;
  const pitchLimit = 0.48;
  const tangent = Math.SQRT1_2;
  const groundProbes = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [tangent, tangent], [tangent, -tangent], [-tangent, tangent], [-tangent, -tangent],
  ];
  const turnAngles = [0, 0.45, -0.45, 0.9, -0.9, 1.45, -1.45, 2.15, -2.15, Math.PI];
  const lookaheadFractions = [0.035, 0.1, 0.24, 0.55, 1];
  const hullCuts = [-0.505, -0.405, -0.295, -0.175, -0.035, 0.10, 0.24, 0.38, 0.505];
  const schoolPeriod = 17;
  const fish = [];
  let swimTime = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function angleBetween(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }

  function random(swimmer) {
    swimmer.seed = (Math.imul(swimmer.seed, 1664525) + 1013904223) >>> 0;
    return swimmer.seed / 0x100000000;
  }

  function describeStone(current) {
    const { angle, radiusX, radiusY, radiusZ } = current;
    const rock = { ...current, minRadius: Math.min(radiusX, radiusY, radiusZ) };
    if (!rock.inverseRotation) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      rock.inverseRotation = [cos, 0, sin, 0, 1, 0, -sin, 0, cos];
    }
    return rock;
  }

  function readStones() {
    const current = stones ? stones() : stone?.();
    const values = Array.isArray(current) ? current : current ? [current] : [];
    return values.map(describeStone);
  }

  function outsideGlass(x, z, pad) {
    return x < bounds.minX + pad || x > bounds.maxX - pad ||
      z < bounds.minZ + pad || z > bounds.maxZ - pad;
  }

  function floorAt(swimmer, x, z) {
    let floor = -Infinity;
    for (const [dx, dz] of groundProbes) {
      const sample = groundHeight(x + dx * swimmer.bodyRadius, z + dz * swimmer.bodyRadius);
      if (sample === null) return Infinity;
      floor = Math.max(floor, sample);
    }
    if (swimmer.species === 'pandaCory') {
      // Extended pelvic rays on the measured panda specimen reach 0.166 lengths below the origin.
      return floor + swimmer.length * (.166 + .51 * Math.abs(Math.sin(swimmer.pitch))) + .0012;
    }
    return floor + swimmer.verticalPad + 0.006;
  }

  function outsideStone(swimmer, rock, x, y, z) {
    const dx = x - rock.x;
    const dy = y - rock.y;
    const dz = z - rock.z;
    const pad = swimmer.stonePad;
    const expansion = 1 + pad / rock.minRadius;
    if (dx * dx + dy * dy + dz * dz >
        (Math.max(rock.radiusX, rock.radiusY, rock.radiusZ) * expansion) ** 2) return true;
    const inverse = rock.inverseRotation;
    const localX = inverse[0] * dx + inverse[3] * dy + inverse[6] * dz;
    const localY = inverse[1] * dx + inverse[4] * dy + inverse[7] * dz;
    const localZ = inverse[2] * dx + inverse[5] * dy + inverse[8] * dz;
    // Expand in normalized ellipsoid space by the largest possible displacement of the body envelope.
    return (localX / rock.radiusX) ** 2 + (localY / rock.radiusY) ** 2 + (localZ / rock.radiusZ) ** 2
      >= expansion * expansion;
  }

  function clearOfStone(swimmer, rocks, x, y, z) {
    return rocks.every((rock) => outsideStone(swimmer, rock, x, y, z));
  }

  function isClear(swimmer, rock, x, y, z) {
    return y <= swimmer.ceiling && !outsideGlass(x, z, swimmer.wallPad) &&
      clearOfStone(swimmer, rock, x, y, z) && y >= floorAt(swimmer, x, z);
  }

  function makeHull(length, height) {
    const tail = Math.hypot(0.16 * length, 0.42 * height);
    const pectorals = 0.057 * length + 0.63 * height;
    // Enclose each longitudinal section of the body and animated fins.
    const widths = [tail, tail, 0.067 * length + 0.46 * height, 0.045 * length + 0.49 * height,
      pectorals, pectorals, 0.41 * height, 0.25 * height];
    return widths.map((width, index) => {
      const start = hullCuts[index] * length;
      const end = hullCuts[index + 1] * length;
      return { offset: (start + end) * 0.5, radius: Math.hypot(width, (end - start) * 0.5) };
    });
  }

  function clearOfFish(swimmer, x, y, z, heading, sweep = false) {
    const travel = sweep ? Math.hypot(x - swimmer.x, y - swimmer.y, z - swimmer.z) : 0;
    for (const other of fish) {
      if (other === swimmer) continue;
      const dx = x - other.x;
      const dy = y - other.y;
      const dz = z - other.z;
      const reach = swimmer.hullReach + other.hullReach + travel;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      for (const section of swimmer.hull) {
        const ax = x + section.offset * heading.x;
        const ay = y + section.offset * heading.y;
        const az = z + section.offset * heading.z;
        const vx = sweep ? swimmer.x + section.offset * swimmer.headingX - ax : 0;
        const vy = sweep ? swimmer.y + section.offset * swimmer.headingY - ay : 0;
        const vz = sweep ? swimmer.z + section.offset * swimmer.headingZ - az : 0;
        const distanceSquared = vx * vx + vy * vy + vz * vz;
        for (const neighbor of other.hull) {
          const sx = other.x + neighbor.offset * other.headingX - ax;
          const sy = other.y + neighbor.offset * other.headingY - ay;
          const sz = other.z + neighbor.offset * other.headingZ - az;
          // Test the whole swept path, including the small arcs made while turning.
          const t = distanceSquared > 0 ? clamp((sx * vx + sy * vy + sz * vz) / distanceSquared, 0, 1) : 0;
          const radius = section.radius + neighbor.radius + 0.0005;
          if ((sx - vx * t) ** 2 + (sy - vy * t) ** 2 + (sz - vz * t) ** 2 < radius * radius) return false;
        }
      }
    }
    return true;
  }

  function readjust(swimmer, rock) {
    const heading = direction(swimmer.yaw, swimmer.pitch);
    if (isClear(swimmer, rock, swimmer.x, swimmer.y, swimmer.z) &&
        clearOfFish(swimmer, swimmer.x, swimmer.y, swimmer.z, heading)) return false;
    const originX = swimmer.x;
    const originY = swimmer.y;
    const originZ = swimmer.z;
    let nearest = null;
    let shortest = Infinity;

    function tryColumn(x, z) {
      if (outsideGlass(x, z, swimmer.wallPad)) return;
      const floor = floorAt(swimmer, x, z) + 0.002;
      if (floor > swimmer.ceiling) return;
      const y = clamp(originY, floor, swimmer.ceiling);
      for (const trialY of [y, y + 0.02, y - 0.02, y + 0.045, y - 0.045, swimmer.ceiling, floor]) {
        if (trialY < floor || trialY > swimmer.ceiling || !clearOfStone(swimmer, rock, x, trialY, z)) continue;
        const distance = Math.hypot(x - originX, trialY - originY, z - originZ);
        if (distance < shortest && clearOfFish(swimmer, x, trialY, z, heading)) {
          shortest = distance;
          nearest = { x, y: trialY, z };
        }
      }
    }

    tryColumn(clamp(originX, bounds.minX + swimmer.wallPad, bounds.maxX - swimmer.wallPad),
      clamp(originZ, bounds.minZ + swimmer.wallPad, bounds.maxZ - swimmer.wallPad));
    for (let ring = 1; ring <= 10 && ring * 0.022 < shortest; ring += 1) {
      for (let i = 0; i < 12; i += 1) {
        const angle = swimmer.yaw + i * Math.PI / 6;
        tryColumn(originX + Math.cos(angle) * ring * 0.022, originZ + Math.sin(angle) * ring * 0.022);
      }
    }
    if (nearest) {
      swimmer.x = nearest.x;
      swimmer.y = nearest.y;
      swimmer.z = nearest.z;
      swimmer.avoidTime = 0;
      return true;
    }
    return false;
  }

  function chooseGoal(swimmer, rock) {
    const margin = swimmer.wallPad + 0.013;
    const spanX = bounds.maxX - bounds.minX - margin * 2;
    const spanZ = bounds.maxZ - bounds.minZ - margin * 2;
    swimmer.goalTime = 3.5 + random(swimmer) * 4;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const x = bounds.minX + margin + random(swimmer) * spanX;
      const pane = swimmer.species === 'otocinclus' && random(swimmer) < .85 ?
        (swimmer.z >= (bounds.minZ + bounds.maxZ) / 2 ? 1 : -1) : 0;
      const z = pane ? (pane > 0 ? bounds.maxZ - margin : bounds.minZ + margin) :
        bounds.minZ + margin + random(swimmer) * spanZ;
      const floor = floorAt(swimmer, x, z);
      const fraction = random(swimmer);
      let y;
      if (swimmer.species === 'pandaCory') y = floor + .001 + .0025 * fraction;
      else if (swimmer.species === 'guppy') y = floor + (swimmer.ceiling - floor) * (.50 + .42 * fraction);
      else y = floor + .012 + (swimmer.ceiling - floor - .012) * (.18 + .68 * fraction);
      if (floor >= swimmer.ceiling || !clearOfStone(swimmer, rock, x, y, z) ||
          Math.hypot(x - swimmer.x, z - swimmer.z) < 0.08) continue;
      swimmer.goal = { x, y, z, pane };
      if (pane) swimmer.goalTime = 30;
      return;
    }
  }

  function direction(yaw, pitch) {
    const horizontal = Math.cos(pitch);
    return { x: Math.cos(yaw) * horizontal, y: Math.sin(pitch), z: Math.sin(yaw) * horizontal };
  }

  function openAhead(swimmer, rock, yaw, pitch, distance) {
    const vector = direction(yaw, pitch);
    let clear = 0;
    for (const fraction of lookaheadFractions) {
      const reach = distance * fraction;
      const x = swimmer.x + vector.x * reach;
      const y = swimmer.y + vector.y * reach;
      const z = swimmer.z + vector.z * reach;
      if (!isClear(swimmer, rock, x, y, z) || !clearOfFish(swimmer, x, y, z, vector)) return clear;
      clear = fraction;
    }
    return clear;
  }

  function guide(swimmer, rock, goalYaw, goalPitch, reach) {
    const escape = swimmer.speed < swimmer.cruise * 0.34;
    if (swimmer.avoidTime > 0 &&
        openAhead(swimmer, rock, swimmer.avoidYaw, swimmer.avoidPitch, reach) >= (escape ? 0.035 : 0.55)) {
      return { yaw: swimmer.avoidYaw, pitch: swimmer.avoidPitch };
    }
    const forwardYaw = swimmer.yaw + clamp(angleBetween(swimmer.yaw, goalYaw), -0.35, 0.35);
    const forwardPitch = clamp(goalPitch, swimmer.pitch - 0.24, swimmer.pitch + 0.24);
    if (openAhead(swimmer, rock, forwardYaw, forwardPitch, reach) === 1) {
      return { yaw: goalYaw, pitch: goalPitch };
    }

    let best = { yaw: forwardYaw, pitch: forwardPitch };
    let bestScore = -Infinity;
    for (const turn of turnAngles) {
      const yaw = swimmer.yaw + turn * swimmer.turnSide;
      for (const pitch of [forwardPitch, 0, 0.42, -0.28]) {
        const clear = openAhead(swimmer, rock, yaw, pitch, reach);
        const steerScore = Math.cos(angleBetween(yaw, goalYaw)) * 0.78
          + Math.cos(turn) * 0.55 - Math.abs(pitch - goalPitch) * 0.45;
        const clearanceScore = escape ? (clear > 0 ? 4 : 0) + clear * 8 :
          clear * 3.4 + Math.min(clear / 0.15, 1) * 1.8;
        const score = clearanceScore + steerScore;
        if (score <= bestScore) continue;
        bestScore = score;
        best = { yaw, pitch };
      }
    }
    swimmer.avoidYaw = best.yaw;
    swimmer.avoidPitch = best.pitch;
    swimmer.avoidTime = 0.22;
    return best;
  }

  function advance(swimmer, rock, vector, distance) {
    const x = swimmer.x + vector.x * distance;
    const y = swimmer.y + vector.y * distance;
    const z = swimmer.z + vector.z * distance;
    const heading = direction(swimmer.yaw, swimmer.pitch);
    if (!isClear(swimmer, rock, x, y, z) || !clearOfFish(swimmer, x, y, z, heading, true)) return false;
    swimmer.x = x;
    swimmer.y = y;
    swimmer.z = z;
    return true;
  }

  function followNeighbors(swimmer, yaw, pitch, school) {
    const course = direction(yaw, pitch);
    let neighborWeight = 0;
    let neighborSpeed = 0;
    for (const other of fish) {
      if (other === swimmer) continue;
      const dx = other.x - swimmer.x;
      const dy = other.y - swimmer.y;
      const dz = other.z - swimmer.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1e-8 || distance >= 0.24) continue;
      const near = (1 - distance / 0.24) ** 2;
      const separation = Math.max(0, 1 - distance / 0.055);
      const alignment = swimmer.species === other.species ? school : 0;
      const attraction = alignment * 0.74 * near - separation * 1.6;
      course.x += dx / distance * attraction + other.headingX * near * alignment * 1.5;
      course.y += dy / distance * attraction + other.headingY * near * alignment * 1.5;
      course.z += dz / distance * attraction + other.headingZ * near * alignment * 1.5;
      if (alignment > 0) {
        neighborSpeed += other.speed * near;
        neighborWeight += near;
      }
    }
    const following = school * Math.min(0.42, neighborWeight);
    const speed = following === 0 ? swimmer.cruise :
      swimmer.cruise * (1 - following) + clamp(neighborSpeed / neighborWeight,
        swimmer.cruise * 0.7, swimmer.cruise * 1.2) * following;
    return {
      yaw: Math.atan2(course.z, course.x),
      pitch: clamp(Math.atan2(course.y, Math.hypot(course.x, course.z)), -0.38, 0.38),
      speed,
    };
  }

  function turn(swimmer, target, dt) {
    const yaw = swimmer.yaw + clamp(angleBetween(swimmer.yaw, target.yaw), -turnLimit * dt, turnLimit * dt);
    const pitch = swimmer.pitch + clamp(target.pitch - swimmer.pitch, -1.55 * dt, 1.55 * dt);
    const heading = direction(yaw, pitch);
    if (!clearOfFish(swimmer, swimmer.x, swimmer.y, swimmer.z, heading, true)) {
      return direction(swimmer.yaw, swimmer.pitch);
    }
    swimmer.yaw = yaw;
    swimmer.pitch = pitch;
    swimmer.headingX = heading.x;
    swimmer.headingY = heading.y;
    swimmer.headingZ = heading.z;
    return heading;
  }

  function mouthDistance(swimmer, pellet) {
    const reach = swimmer.length * 0.49;
    return Math.hypot(
      pellet.x - swimmer.x - swimmer.headingX * reach,
      pellet.y - swimmer.y - swimmer.headingY * reach,
      pellet.z - swimmer.z - swimmer.headingZ * reach,
    );
  }

  function canBite(swimmer, pellet) {
    const facing = (pellet.x - swimmer.x) * swimmer.headingX +
      (pellet.y - swimmer.y) * swimmer.headingY + (pellet.z - swimmer.z) * swimmer.headingZ;
    return facing >= swimmer.length * 0.12 && mouthDistance(swimmer, pellet) <= 0.0045 + swimmer.height * 0.20;
  }

  function feedingTargets(pellets) {
    if (pellets.length === 0) return null;
    const matches = [];
    for (const swimmer of fish) {
      if (swimmer.glassVisit) continue;
      for (const pellet of pellets) {
        if (pellet.id === swimmer.pausedPellet && swimmer.feedCooldown > 0) continue;
        const distance = mouthDistance(swimmer, pellet);
        if (distance > 0.235) continue;
        const claimBias = pellet.id === swimmer.foodId ? 0.035 : 0;
        matches.push({ swimmer, pellet, score: distance - claimBias });
      }
    }
    matches.sort((a, b) => a.score - b.score);
    const assignments = new Map();
    const claimed = new Set();
    for (const { swimmer, pellet } of matches) {
      if (assignments.has(swimmer) || claimed.has(pellet.id)) continue;
      assignments.set(swimmer, pellet);
      claimed.add(pellet.id);
    }
    return assignments;
  }

  function feedGoal(swimmer, pellet) {
    const x = clamp(pellet.x, bounds.minX + swimmer.wallPad + 0.001, bounds.maxX - swimmer.wallPad - 0.001);
    const z = clamp(pellet.z, bounds.minZ + swimmer.wallPad + 0.001, bounds.maxZ - swimmer.wallPad - 0.001);
    return { x, y: clamp(pellet.y, Math.min(floorAt(swimmer, x, z) + 0.002, swimmer.ceiling), swimmer.ceiling), z };
  }

  function stopFeeding(swimmer) {
    swimmer.foodId = null;
    swimmer.foodTime = 0;
    swimmer.avoidTime = 0;
  }

  function updateGlassVisit(swimmer, rocks, dt) {
    const visit = swimmer.glassVisit;
    visit.time += dt;
    const approach = 1.2;
    const total = visit.hold + 2 * approach;
    const t = clamp(Math.min(visit.time, total - visit.time) / approach, 0, 1);
    // Turn belly to glass while there is still room for the whole fish, then settle against it.
    const rotate = Math.min(t * 2, 1);
    const slide = Math.max(0, t * 2 - 1);
    const yaw = visit.yaw + angleBetween(visit.yaw, visit.pane > 0 ? Math.PI / 2 : -Math.PI / 2) * rotate;
    const pitch = visit.pitch + (Math.PI / 2 - visit.pitch) * rotate;
    const heading = direction(yaw, pitch);
    const rim = swimmer.length * .051 + .0003;
    const paneZ = visit.pane > 0 ? bounds.maxZ - rim : bounds.minZ + rim;
    const z = visit.z + (paneZ - visit.z) * slide;
    const ground = groundHeight(swimmer.x, z);
    const safe = ground !== null && swimmer.y > ground + swimmer.bodyRadius &&
      swimmer.y < waterLevel - swimmer.bodyRadius &&
      clearOfStone(swimmer, rocks, swimmer.x, swimmer.y, z) &&
      clearOfFish(swimmer, swimmer.x, swimmer.y, z, heading, true);
    if (!safe || visit.time >= total) {
      swimmer.z = visit.z;
      swimmer.yaw = visit.yaw;
      swimmer.pitch = visit.pitch;
      const heading = direction(swimmer.yaw, swimmer.pitch);
      swimmer.headingX = heading.x;
      swimmer.headingY = heading.y;
      swimmer.headingZ = heading.z;
      swimmer.glassVisit = null;
      swimmer.goalTime = 0;
      swimmer.resting = false;
      return false;
    }
    swimmer.z = z;
    swimmer.yaw = yaw;
    swimmer.pitch = pitch;
    swimmer.headingX = heading.x;
    swimmer.headingY = heading.y;
    swimmer.headingZ = heading.z;
    swimmer.speed = swimmer.cruise * .12;
    swimmer.phase += dt * 4;
    swimmer.resting = true;
    return true;
  }

  function swim(swimmer, rock, dt, school, pellet) {
    if (swimmer.glassVisit && updateGlassVisit(swimmer, rock, dt)) return;
    const movedByTerrain = readjust(swimmer, rock);
    swimmer.elapsed += dt;
    swimmer.avoidTime -= dt;
    swimmer.feedCooldown -= dt;
    swimmer.slowTime = swimmer.speed < swimmer.cruise * 0.32 ? swimmer.slowTime + dt : 0;
    if (pellet) {
      if (swimmer.foodId !== pellet.id) {
        swimmer.foodId = pellet.id;
        swimmer.foodTime = 0;
        swimmer.avoidTime = 0;
      }
      swimmer.foodTime += dt;
      if (canBite(swimmer, pellet) && eat(pellet.id)) {
        pellet = null;
      } else if (swimmer.foodTime >= 5) {
        swimmer.pausedPellet = pellet.id;
        swimmer.feedCooldown = 1.2;
        pellet = null;
      }
    }
    if (!pellet) {
      if (swimmer.foodId !== null) stopFeeding(swimmer);
      swimmer.goalTime -= dt;
      const goal = swimmer.goal;
      const arrived = Math.hypot(goal.x - swimmer.x, goal.y - swimmer.y, goal.z - swimmer.z) < 0.032;
      if (arrived && goal.pane && !movedByTerrain && swimmer.goalTime > 0) {
        swimmer.glassVisit = { pane: goal.pane, z: swimmer.z, yaw: swimmer.yaw, pitch: swimmer.pitch,
          time: 0, hold: 2.8 + 2.5 * random(swimmer) };
        if (updateGlassVisit(swimmer, rock, dt)) return;
      }
      if (movedByTerrain || swimmer.goalTime <= 0 || swimmer.slowTime > 0.85 || arrived) {
        chooseGoal(swimmer, rock);
        swimmer.slowTime = 0;
      }
    }

    const aboutToBite = pellet && Math.hypot(pellet.x - swimmer.x, pellet.y - swimmer.y, pellet.z - swimmer.z) < 0.064;
    const goal = aboutToBite ? pellet : pellet ? feedGoal(swimmer, pellet) : swimmer.goal;
    const dx = goal.x - swimmer.x;
    const dz = goal.z - swimmer.z;
    const ripple = swimmer.elapsed * 2.3 + swimmer.pulse;
    const desiredYaw = Math.atan2(dz, dx) + (pellet ? 0 : 0.085 * Math.sin(ripple));
    const grazing = swimmer.species === 'pandaCory' && !pellet;
    const groundGap = grazing ? swimmer.y - floorAt(swimmer, swimmer.x, swimmer.z) : Infinity;
    const forage = grazing && groundGap < .012;
    const desiredPitch = clamp(Math.atan2(goal.y - swimmer.y, Math.hypot(dx, dz)),
      pellet ? -0.44 : -0.32, pellet ? 0.44 : 0.32) + (pellet || grazing ? 0 : 0.06 * Math.sin(ripple * 0.71));
    const reach = aboutToBite ? 0.032 : 0.038 + swimmer.cruise * 0.52;
    const course = followNeighbors(swimmer, desiredYaw, desiredPitch, pellet || grazing ? 0 : school);
    const target = aboutToBite ? { yaw: desiredYaw, pitch: desiredPitch } :
      guide(swimmer, rock, course.yaw, course.pitch, reach);
    const heading = turn(swimmer, target, dt);

    const clear = openAhead(swimmer, rock, swimmer.yaw, swimmer.pitch, reach);
    swimmer.resting = forage && Math.sin(swimmer.elapsed * 1.27 + swimmer.pulse) > .32;
    const tempo = swimmer.resting ? .09 : 0.93 + 0.18 * Math.sin(swimmer.elapsed * 2.05 + swimmer.pulse);
    const speedBoost = pellet && !aboutToBite ? 1.62 : 1;
    const targetSpeed = course.speed * speedBoost * tempo * (0.22 + 0.78 * clear);
    const rate = targetSpeed > swimmer.speed ? 3.0 : 9.0;
    swimmer.speed += (targetSpeed - swimmer.speed) * (1 - Math.exp(-rate * dt));
    if (!advance(swimmer, rock, heading, swimmer.speed * dt)) {
      // Short fin strokes can move the fish clear while its body is still turning.
      const escapeSpeed = swimmer.cruise * 0.45;
      const step = escapeSpeed * dt;
      const escaped = advance(swimmer, rock, direction(target.yaw, target.pitch), step) ||
        (aboutToBite && advance(swimmer, rock, direction(swimmer.yaw, 0), step)) ||
        advance(swimmer, rock, { x: 0, y: 1, z: 0 }, step) ||
        advance(swimmer, rock, { x: 0, y: -1, z: 0 }, step);
      swimmer.speed = escaped ? escapeSpeed : 0;
    }
    if (pellet && canBite(swimmer, pellet) && eat(pellet.id)) stopFeeding(swimmer);
    const beat = 1.5 + 2.3 * swimmer.speed / swimmer.cruise;
    swimmer.phase = (swimmer.phase + beat * 2 * Math.PI * dt) % (2 * Math.PI);
  }

  function addFish({ species = 'cardinal', length, height = length * 0.34, speed, seed }, position, rock = readStones()) {
    const index = fish.length;
    const bodyRadius = length * 0.53;
    const verticalPad = height * 0.5 + Math.sin(pitchLimit) * bodyRadius + 0.003;
    const hull = makeHull(length, height);
    const swimmer = {
      species, length, height, bodyRadius, verticalPad, glassVisit: null, resting: false,
      hull, hullReach: Math.max(...hull.map(({ offset, radius }) => Math.abs(offset) + radius)) + 0.001,
      wallPad: bodyRadius + 0.004,
      stonePad: Math.hypot(bodyRadius, verticalPad) + 0.003,
      ceiling: waterLevel - verticalPad - 0.008,
      cruise: speed, speed,
      seed: (seed ?? Math.imul(index + 3, 2654435761)) >>> 0,
      turnSide: index % 2 === 0 ? 1 : -1,
      yaw: 0, pitch: 0, elapsed: 0, goalTime: 0, avoidTime: 0, slowTime: 0,
      foodId: null, foodTime: 0, pausedPellet: null, feedCooldown: 0,
      x: 0, y: 0, z: 0, headingX: 1, headingY: 0, headingZ: 0,
      phase: 0, pulse: 0, goal: { x: 0, y: waterLevel * 0.64, z: 0 },
    };
    swimmer.pulse = random(swimmer) * Math.PI * 2;
    swimmer.phase = random(swimmer) * Math.PI * 2;
    swimmer.yaw = random(swimmer) * Math.PI * 2;
    const startHeading = direction(swimmer.yaw, 0);
    swimmer.headingX = startHeading.x;
    swimmer.headingZ = startHeading.z;
    chooseGoal(swimmer, rock);
    swimmer.x = swimmer.goal.x;
    swimmer.y = swimmer.goal.y;
    swimmer.z = swimmer.goal.z;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.z)) {
      swimmer.x = clamp(position.x, bounds.minX + swimmer.wallPad, bounds.maxX - swimmer.wallPad);
      swimmer.z = clamp(position.z, bounds.minZ + swimmer.wallPad, bounds.maxZ - swimmer.wallPad);
      if (Number.isFinite(position.y)) swimmer.y = position.y;
      else if (species === 'pandaCory') swimmer.y = floorAt(swimmer, swimmer.x, swimmer.z) + .002;
    }
    readjust(swimmer, rock);
    if (!isClear(swimmer, rock, swimmer.x, swimmer.y, swimmer.z) ||
        !clearOfFish(swimmer, swimmer.x, swimmer.y, swimmer.z, startHeading)) return null;
    chooseGoal(swimmer, rock);
    fish.push(swimmer);
    return swimmer;
  }
  const initialStones = readStones();
  for (const spec of fishSpecs) addFish(spec, null, initialStones);

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const rock = readStones();
    const elapsed = Math.min(dt, 0.1);
    const steps = Math.max(1, Math.ceil(elapsed * 60 - 1e-8));
    const step = elapsed / steps;
    for (let i = 0; i < steps; i += 1) {
      swimTime += step;
      const timeInCycle = swimTime % schoolPeriod;
      const blend = clamp(Math.min((timeInCycle - 2) / 2, (11 - timeInCycle) / 2), 0, 1);
      const school = blend * blend * (3 - 2 * blend);
      const targets = feedingTargets(food());
      for (const swimmer of fish) swim(swimmer, rock, step, school, targets?.get(swimmer));
    }
  }

  return { fish, update, addFish };
}
