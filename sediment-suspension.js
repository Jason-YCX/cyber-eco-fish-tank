(function () {
  'use strict';

  // Visual tracers for the fraction of disturbed material lifted off the bed.
  // The conservative height solver owns the sediment volume.
  const beds = {
    original: { color: '#c3a57e', fine: .07, density: 460000, grain: .0011 },
    redSand:  { color: '#a77c55', fine: .19, density: 600000, grain: .0010 },
    gravel:   { color: '#988977', fine: .05, density: 130000, grain: .0021 },
    soil:     { color: '#81715b', fine: .88, density: 665000, grain: .0013 },
  };

  window.createAquariumSuspension = function ({ bounds, waterLevel, heightAt, columns, dx, dz, lighting }) {
    const limit = 192;
    const particles = [];
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.Float32BufferAttribute(new Float32Array(limit*3), 3).setUsage(THREE.DynamicDrawUsage);
    // Diameter in metres, opacity, fine fraction flag, orientation.
    const shapes = new THREE.Float32BufferAttribute(new Float32Array(limit*4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    geometry.setAttribute('sedimentShape', shapes);
    geometry.setDrawRange(0, 0);
    const uniforms = { pixels: { value: 1 }, tint: { value: new THREE.Color(beds.original.color) }, light: { value: 1 } };
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float pixels;
        attribute vec4 sedimentShape;
        varying vec3 appearance;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.);
          gl_Position = projectionMatrix * mv;
          float size = sedimentShape.x * pixels * .5 * projectionMatrix[1][1] / max(.01, gl_Position.w);
          gl_PointSize = clamp(size, 1., 72.);
          appearance = vec3(sedimentShape.y * min(1., size*size), sedimentShape.zw);
        }`,
      fragmentShader: `
        uniform vec3 tint;
        uniform float light;
        varying vec3 appearance;
        void main() {
          vec2 pt = 2.*gl_PointCoord-1.;
          vec2 cs = vec2(cos(appearance.z), sin(appearance.z));
          vec2 p = vec2(dot(pt,cs), dot(pt,vec2(-cs.y,cs.x)));
          float profile;
          if (appearance.y > .5) {
            p.y *= 1.22;
            vec2 q = p - vec2(.21, -.13);
            float edge = max(0., 1.-dot(p,p));
            profile = edge*edge * (.52 + .48*exp(-6.*dot(q,q)));
          } else {
            float edge = dot(p, p*vec2(.87,1.36)) + .17*p.x*p.y;
            profile = 1.-smoothstep(.40,.97,edge);
          }
          gl_FragColor = vec4(tint*light, profile*appearance.x);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Points(geometry, material);
    mesh.name = 'DisturbedAquariumSediment';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    let bed = beds.original, sequence = 0, activeStroke = 0, credit = 0, startCredit = 0;
    let cumulative, seed = 11891;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    function setBed(type) {
      if (bed === beds[type]) return;
      bed = beds[type];
      uniforms.tint.value.set(bed.color);
      particles.length = 0;
      credit = startCredit = 0;
      geometry.setDrawRange(0, 0);
      mesh.visible = false;
    }

    function transport(previous, heights) {
      cumulative ??= new Float64Array(heights.length);
      let loss = 0;
      for (let i = 0; i < heights.length; i++) {
        const erosion = previous.getY(i)-heights[i];
        if (erosion > 1e-7) loss += erosion;
        cumulative[i] = loss;
      }
      const expected = credit + loss*dx*dz*bed.density;
      credit = expected % 1;
      const count = Math.min(Math.floor(expected), 64, limit-particles.length);
      let i = 0;
      for (let j = 0; j < count; j++) {
        const pick = (j+random())/count*loss;
        while (i+1 < heights.length && cumulative[i] <= pick) i++;
        const x = THREE.MathUtils.clamp(previous.getX(i)+(random()-.5)*dx, bounds.minX, bounds.maxX);
        const z = THREE.MathUtils.clamp(previous.getZ(i)+(random()-.5)*dz, bounds.minZ, bounds.maxZ);
        const left = i%columns ? i-1 : i, right = (i+1)%columns ? i+1 : i;
        const near = i >= columns ? i-columns : i, far = i+columns < heights.length ? i+columns : i;
        const slopeX = (heights[left]-heights[right])/((right-left)*dx);
        const slopeZ = (heights[near]-heights[far])/((far-near)/columns*dz);
        const fine = random() < bed.fine;
        const y = heights[i]+.0015;
        particles.push({ x, y, z, age: 0, fine, stroke: activeStroke, angle: random()*2*Math.PI,
          vx: THREE.MathUtils.clamp(slopeX, -1, 1)*.052 + (random()-.45)*.020,
          vz: THREE.MathUtils.clamp(slopeZ, -1, 1)*.052 + (random()-.5)*.020,
          lift: fine ? .024+random()*.026 : .008+random()*.017,
          diameter: fine ? .008+random()*.012 : bed.grain*(.64+random()),
          life: fine ? 1.55+random()*1.9 : .32+random()*.39,
        });
      }
    }

    function update(dt, pixels) {
      if (!particles.length) {
        geometry.setDrawRange(0, 0);
        mesh.visible = false;
        return;
      }
      let live = 0;
      for (const p of particles) {
        p.age += dt;
        const t = p.age, fraction = t/p.life;
        if (fraction >= 1) continue;
        const drag = p.fine ? 1.4 : 4.5, travel = -Math.expm1(-drag*t)/drag;
        const x = p.x + p.vx*travel, z = p.z + p.vz*travel;
        const ground = heightAt(x,z);
        if (ground === null) continue;
        const sink = p.fine ? .011 : .053;
        const y = Math.max(ground+.0003, p.y+(p.lift+sink)*travel-sink*t);
        if (y >= waterLevel) continue;
        const diameter = p.diameter*(p.fine ? 1+1.8*fraction : 1);
        const fade = Math.min(1, t/.06)*(1-fraction);
        positions.setXYZ(live,x,y,z);
        shapes.setXYZW(live,diameter,(p.fine ? .20 : .87)*fade,p.fine ? 1 : 0,p.angle);
        particles[live++] = p;
      }
      particles.length = live;
      uniforms.pixels.value = pixels;
      uniforms.light.value = .25+.73*lighting.uDaySky.value+.39*lighting.uDayLamp.value;
      geometry.setDrawRange(0,live);
      positions.needsUpdate = shapes.needsUpdate = true;
      mesh.visible = live > 0;
    }

    function beginStroke() { activeStroke = ++sequence; startCredit = credit; }
    function endStroke(keep) {
      if (!keep && activeStroke) {
        for (let i=particles.length-1; i>=0; i--) if (particles[i].stroke === activeStroke) particles.splice(i,1);
        credit = startCredit;
      }
      activeStroke = 0;
    }
    return { mesh, setBed, transport, update, beginStroke, endStroke };
  };
})();
