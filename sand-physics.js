function createSandPhysics({ positions, indices, minHeight, maxHeight, reposeDegrees = 30 }) {
  const count = positions.length / 3;
  const heights = new Float64Array(count);
  const areas = new Float64Array(count);
  const blocked = new Uint8Array(count);
  const triangles = [];
  // Rates are per second. The mud's cohesive head represents yield stress
  // divided by submerged unit weight, in metres. These are interaction presets.
  function material(startDegrees, stopDegrees, rate, brushYield = 0, cohesiveHead = 0) {
    return {
      startSlope: Math.tan(startDegrees * Math.PI / 180),
      stopSlope: Math.tan(stopDegrees * Math.PI / 180),
      rate, brushYield, cohesiveHead,
    };
  }
  const materials = {
    original: material(reposeDegrees, Math.max(0, reposeDegrees - 3), 19),
    redSand: material(29, 25, 23),
    gravel: material(37, 32, 14),
    soil: material(28, 22, 4.5, .0025, .022),
  };
  let current = materials.original;
  const volumeEpsilon = 1e-14;
  const sleepMargin = .001;
  let surfaceTriangles = [];
  let neighbors = [];
  let incident = [];
  let stroke = null;
  let forward = true;

  for (let i = 0; i < count; i += 1) heights[i] = positions[i * 3 + 1];

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const dx1 = positions[b * 3] - positions[a * 3];
    const dz1 = positions[b * 3 + 2] - positions[a * 3 + 2];
    const dx2 = positions[c * 3] - positions[a * 3];
    const dz2 = positions[c * 3 + 2] - positions[a * 3 + 2];
    const determinant = dx1 * dz2 - dx2 * dz1;
    const areaShare = Math.abs(determinant) / 6;
    if (areaShare === 0) continue;
    areas[a] += areaShare;
    areas[b] += areaShare;
    areas[c] += areaShare;
    triangles.push({
      a, b, c,
      gx1: dz2 / determinant, gx2: -dz1 / determinant,
      gz1: -dx2 / determinant, gz2: dx1 / determinant,
      awake: true, flowing: false,
    });
  }

  function rebuildSurface() {
    surfaceTriangles = triangles.filter(({ a, b, c }) => !blocked[a] && !blocked[b] && !blocked[c]);
    neighbors = Array.from({ length: count }, () => []);
    incident = Array.from({ length: count }, () => []);
    for (const triangle of surfaceTriangles) {
      const { a, b, c } = triangle;
      neighbors[a].push(b, c);
      neighbors[b].push(a, c);
      neighbors[c].push(a, b);
      incident[a].push(triangle);
      incident[b].push(triangle);
      incident[c].push(triangle);
    }
  }

  function wakeVertex(index) {
    for (const triangle of incident[index]) triangle.awake = true;
  }

  function setMaterial(type) {
    if (!Object.hasOwn(materials, type)) return;
    const next = materials[type];
    if (current === next) return;
    current = next;
    // Preserve the placed terrain. A stroke or an uncovered obstacle wakes
    // the affected region, then gravity can propagate from there.
    for (const triangle of triangles) {
      triangle.awake = false;
      triangle.flowing = false;
    }
  }

  function setBlocked(predicate) {
    const changed = [];
    for (let i = 0; i < count; i += 1) {
      const state = predicate(positions[i * 3], positions[i * 3 + 2]) ? 1 : 0;
      if (blocked[i] !== state) changed.push(i);
      blocked[i] = state;
    }
    if (changed.length) {
      for (const index of changed) {
        for (const triangle of incident[index]) triangle.flowing = false;
      }
      rebuildSurface();
      for (const index of changed) wakeVertex(index);
    }
  }

  function beginStroke(x, z, radius) {
    if (stroke || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius <= 0) return false;
    const coreRadius = radius * 0.55;
    const distances = new Float64Array(count);
    const phase = 3 * Math.sin(13.7*x + 8.3*z) + 2 * Math.cos(5.1*z - 6.9*x);
    let seed = -1;
    let nearest = coreRadius;
    for (let i = 0; i < count; i += 1) {
      const dx = positions[i * 3] - x, dz = positions[i * 3 + 2] - z;
      const realDistance = Math.hypot(dx, dz);
      if (realDistance > radius * 1.12) {
        distances[i] = realDistance;
        continue;
      }
      const angle = Math.atan2(dz, dx);
      const distance = realDistance * (1 + .055*Math.cos(2*angle+phase) + .045*Math.sin(3*angle-phase));
      distances[i] = distance;
      if (neighbors[i].length && distance < nearest) {
        seed = i;
        nearest = distance;
      }
    }
    if (seed < 0) return false;

    const core = [];
    const rim = [];
    const visited = new Uint8Array(count);
    const queue = [seed];
    visited[seed] = 1;
    let coreWeight = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const distance = distances[index];
      if (distance < coreRadius) {
        const weight = areas[index] * (1 - (distance / coreRadius) ** 2) ** 2;
        core.push({ index, weight });
        coreWeight += weight;
      } else if (distance > coreRadius) {
        const angle = Math.PI * (distance - coreRadius) / (radius - coreRadius);
        const downslope = (heights[seed] - heights[index]) / distance;
        const weight = areas[index] * Math.sin(angle) ** 2;
        rim.push({ index, weight, depositWeight: weight * (1 + Math.max(-.65, Math.min(.85, downslope * 2))) });
      }
      for (const next of neighbors[index]) {
        if (visited[next] || distances[next] >= radius) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (!rim.length) return false;

    const baseline = heights.slice();
    stroke = { core, rim, coreWeight, baseline, preview: baseline.slice(), lastDelta: 0, brushYield: current.brushYield };
    return true;
  }

  function capacity(terrain, index, deposit) {
    const height = terrain[index];
    return Math.max(0, deposit ? maxHeight - height : height - minHeight) * areas[index];
  }

  function totalCapacity(cells, terrain, deposit) {
    let total = 0;
    for (const { index } of cells) total += capacity(terrain, index, deposit);
    return total;
  }

  function distribute(cells, terrain, amount, deposit) {
    let remaining = amount;
    let active = cells;
    const direction = deposit ? 1 : -1;
    while (remaining > volumeEpsilon && active.length) {
      const weightOf = cell => deposit ? cell.depositWeight ?? cell.weight : cell.weight;
      const weightSum = active.reduce((sum, cell) => sum + weightOf(cell), 0);
      if (weightSum <= 0) break;
      const unsaturated = [];
      let transferred = 0;
      for (const cell of active) {
        const { index } = cell;
        const available = capacity(terrain, index, deposit);
        const take = Math.min(available, remaining * weightOf(cell) / weightSum);
        terrain[index] += direction * take / areas[index];
        transferred += take;
        if (take < available) unsaturated.push(cell);
      }
      if (transferred <= volumeEpsilon) break;
      remaining -= transferred;
      active = unsaturated;
    }
  }

  function applyPreview(preview) {
    let changed = false;
    for (let i = 0; i < count; i += 1) {
      if (heights[i] !== preview[i]) changed = true;
      heights[i] = preview[i];
    }
    return changed;
  }

  function deform(deltaHeight) {
    if (!stroke || !Number.isFinite(deltaHeight) || stroke.lastDelta === deltaHeight) return false;
    const { core, rim, coreWeight, baseline, preview } = stroke;
    stroke.lastDelta = deltaHeight;
    preview.set(baseline);

    const source = deltaHeight > 0 ? rim : core;
    const destination = deltaHeight > 0 ? core : rim;
    const amount = Math.min(
      Math.max(0, Math.abs(deltaHeight) - stroke.brushYield) * coreWeight,
      totalCapacity(source, baseline, false),
      totalCapacity(destination, baseline, true),
    );
    distribute(source, preview, amount, false);
    distribute(destination, preview, amount, true);
    return applyPreview(preview);
  }

  function endStroke(keep) {
    if (!stroke) return false;
    const changed = !keep && applyPreview(stroke.baseline);
    if (keep) {
      for (const cells of [stroke.core, stroke.rim]) {
        for (const { index } of cells) {
          if (heights[index] !== stroke.baseline[index]) wakeVertex(index);
        }
      }
    }
    stroke = null;
    return changed;
  }

  function settle(iterations = 1, secondsPerPass = 1 / 120) {
    if (stroke) return false;
    const relaxation = -Math.expm1(-current.rate * secondsPerPass);
    let changed = false;
    for (let pass = 0; pass < iterations; pass += 1) {
      let moved = false;
      const step = forward ? 1 : -1;
      const start = forward ? 0 : surfaceTriangles.length - 1;
      forward = !forward;
      for (let t = start; t >= 0 && t < surfaceTriangles.length; t += step) {
        const triangle = surfaceTriangles[t];
        if (!triangle.awake) continue;
        const { a, b, c, gx1, gx2, gz1, gz2 } = triangle;
        const deltaB = heights[b] - heights[a];
        const deltaC = heights[c] - heights[a];
        const slope = Math.hypot(gx1 * deltaB + gx2 * deltaC, gz1 * deltaB + gz2 * deltaC);
        const depth = (heights[a] + heights[b] + heights[c]) / 3 - minHeight;
        const cohesion = current.cohesiveHead / Math.max(.009, Math.min(.045, depth));
        const stop = current.stopSlope + .7 * cohesion;
        const threshold = triangle.flowing ? stop + sleepMargin : current.startSlope + cohesion;
        if (slope <= threshold) {
          triangle.awake = triangle.flowing = false;
          continue;
        }

        // Move toward the weighted mean to lower the slope without changing sand volume.
        const mean = (areas[a] * heights[a] + areas[b] * heights[b] + areas[c] * heights[c]) /
          (areas[a] + areas[b] + areas[c]);
        const fraction = relaxation * (1 - stop / slope);
        heights[a] += (mean - heights[a]) * fraction;
        heights[b] += (mean - heights[b]) * fraction;
        heights[c] += (mean - heights[c]) * fraction;
        triangle.flowing = true;
        wakeVertex(a);
        wakeVertex(b);
        wakeVertex(c);
        moved = true;
      }
      if (!moved) break;
      changed = true;
    }
    return changed;
  }

  function volume() {
    let sum = 0;
    for (let i = 0; i < count; i += 1) sum += areas[i] * (heights[i] - minHeight);
    return sum;
  }

  rebuildSurface();
  return { heights, setMaterial, setBlocked, beginStroke, deform, endStroke, settle, volume };
}
