(function () {
  'use strict';

  window.createAquariumAeration = function ({ scene, x, z, waterLevel, heightAt, caustics, lighting }) {
    const stoneHeight = .013;
    const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#586662', roughness: .98 });
    caustics.apply(stoneMaterial, 'stone');
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(.019, .021, stoneHeight, 24), stoneMaterial);
    stone.name = 'AquariumAirStone';
    stone.receiveShadow = true;

    const material = new THREE.ShaderMaterial({
      uniforms: { sun: lighting.uDaySun, lamp: lighting.uDayLamp },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 bubbleNormal;
        varying vec3 toEye;
        varying vec3 toLamp;
        varying vec3 worldUp;
        void main() {
          vec4 p = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          mat3 axes = mat3(instanceMatrix);
          vec3 axisLengthSquared = vec3(dot(axes[0], axes[0]), dot(axes[1], axes[1]), dot(axes[2], axes[2]));
          bubbleNormal = normalMatrix * (axes * (normal / max(axisLengthSquared, vec3(1e-12))));
          toEye = -p.xyz;
          toLamp = (viewMatrix * vec4(-0.45, 0.88, 0.28, 0.0)).xyz;
          worldUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
          gl_Position = projectionMatrix * p;
        }
      `,
      fragmentShader: `
        uniform float sun;
        uniform float lamp;
        varying vec3 bubbleNormal;
        varying vec3 toEye;
        varying vec3 toLamp;
        varying vec3 worldUp;
        void main() {
          vec3 n = normalize(bubbleNormal);
          vec3 view = normalize(toEye);
          float facing = clamp(dot(n, view), 0.0, 1.0);
          // Approximate total internal reflection near the water-to-air critical angle.
          float rim = 1.0 - smoothstep(0.60, 0.71, facing);
          vec3 reflected = reflect(-view, n);
          float above = smoothstep(-0.38, 0.64, dot(reflected, worldUp));
          float glint = pow(max(0.0, dot(reflected, normalize(toLamp))), 28.0);
          float light = 0.56 + 0.38 * max(sun, lamp);
          vec3 edge = mix(vec3(0.026, 0.049, 0.057), vec3(0.64, 0.74, 0.76), above * light);
          vec3 tint = mix(edge, vec3(0.98, 0.99, 0.97) * light, glint);
          gl_FragColor = vec4(tint, max(rim * mix(0.49, 0.37, above), glint * 0.81));
          #include <colorspace_fragment>
        }
      `,
    });

    let seed = 58291;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    const count = 43;
    const paths = Array.from({ length: count }, (_, i) => ({
      offsetX: (random() - .5) * .026,
      offsetZ: (random() - .5) * .023,
      diameter: .0025 + .0037 * random() ** 1.45,
      duration: 3.15 + 2.65 * random(),
      phase: (i + random()) / count,
      sway: random() * Math.PI * 2,
    }));
    const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 10), material, count);
    bubbles.name = 'AquariumAirBubbles';
    bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bubbles.frustumCulled = false;
    bubbles.renderOrder = 2;
    scene.add(stone, bubbles);

    const transform = new THREE.Object3D();
    const { lerp, smoothstep } = THREE.MathUtils;
    const surfacePressure = 101325;
    const waterWeight = 9790; // Pascals per metre of freshwater.
    const surfaceTension = .072;
    function update(time) {
      const bed = heightAt(x, z);
      stone.position.set(x, bed + stoneHeight / 2 - .001, z);
      const start = bed + stoneHeight;
      for (const [i, path] of paths.entries()) {
        const progress = (path.phase + time / path.duration) % 1;
        const phase = time * 4.6 + path.sway + 7 * progress;
        const drift = Math.sin(phase) * (.002 + .011 * progress);
        const y = lerp(start, waterLevel - .004, progress);
        const fade = smoothstep(progress, 0, .018) * (1 - smoothstep(progress, .982, 1));
        const pressure = surfacePressure + waterWeight * (waterLevel - y);
        const diameter = path.diameter * Math.cbrt(surfacePressure / pressure);
        const eotvos = waterWeight * diameter ** 2 / surfaceTension;
        const wobble = time * (15 + 1.7 * path.duration) + 9 * progress + path.sway;
        const deformation = (eotvos / (2.2 + eotvos)) * smoothstep(progress, 0, .070);
        const verticalRatio = 1 - deformation * (.37 + .12 * Math.sin(wobble));
        const lateralRatio = 1 + .11 * deformation * Math.cos(wobble + .6);
        // Redistribute the axes while keeping the pressure-adjusted volume.
        const equator = .5 * diameter * fade / Math.cbrt(verticalRatio);
        transform.position.set(
          x + path.offsetX * (1 + progress) + drift + .019 * progress * progress,
          y,
          z + path.offsetZ * (1 + 1.45 * progress) + .007 * Math.cos(path.sway + 5 * progress) * progress,
        );
        const tilt = deformation * (.20 + .075 * Math.sin(wobble));
        transform.rotation.set(.8 * tilt * Math.sin(phase), path.sway, tilt * Math.cos(phase));
        transform.scale.set(equator * lateralRatio, equator * verticalRatio, equator / lateralRatio);
        transform.updateMatrix();
        bubbles.setMatrixAt(i, transform.matrix);
      }
      bubbles.instanceMatrix.needsUpdate = true;
    }
    update(0);
    return { update };
  };
})();
