(function () {
  'use strict';

  const projectionGLSL = /* glsl */ `
    const float causticAirToWater = 1.0 / 1.333;

    vec3 causticRay(vec2 surfacePoint) {
      vec2 slope = surfaceSlope(surfacePoint);
      vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
      return refract(uCausticSunlight, normal, causticAirToWater);
    }

    vec2 causticTravel(vec3 ray) {
      return ray.xz / max(-ray.y, 0.001);
    }

    float causticEdge(vec2 point, vec2 low, vec2 high, float softness) {
      vec2 margin = min(point - low, high - point);
      return smoothstep(0.0, softness, min(margin.x, margin.y));
    }

    float aquariumCaustic(vec3 position, vec3 worldNormal, out vec3 toLight) {
      toLight = vec3(0., 1., 0.);
      float footprint = max(length(dFdx(position)), length(dFdy(position)));
      float depth = uCausticWaterLevel - position.y;
      if (depth <= 0.0 || uCausticStrength <= 0.001 || uCausticSunlight.x >= -0.001) return 0.0;

      vec3 stillRay = refract(uCausticSunlight, vec3(0.0, 1.0, 0.0), causticAirToWater);
      vec2 guess = position.xz - depth * causticTravel(stillRay);
      vec2 entry = position.xz - depth * causticTravel(causticRay(guess));
      float tank = causticEdge(entry, uCausticBounds.xy, uCausticBounds.zw, 0.022);
      if (tank <= 0.0) return 0.0;

      // Trace the incoming ray back through the room's right-hand window.
      float windowTravel = (uCausticWindowX - entry.x) / -uCausticSunlight.x;
      vec2 windowPoint = vec2(uCausticWaterLevel, entry.y) - uCausticSunlight.yz * windowTravel;
      float windowLight = causticEdge(windowPoint, vec2(-0.095, -1.79), vec2(1.31, 0.35), 0.09);
      if (windowLight <= 0.0) return 0.0;

      // Where the horizontal landing map shrinks, neighboring rays focus.
      const float neighbor = 0.0025;
      vec3 ray = causticRay(entry);
      vec2 travel = causticTravel(ray);
      float interval = depth / neighbor;
      vec2 alongX = vec2(1.0, 0.0) + interval * (causticTravel(causticRay(entry + vec2(neighbor, 0.0))) - travel);
      vec2 alongZ = vec2(0.0, 1.0) + interval * (causticTravel(causticRay(entry + vec2(0.0, neighbor))) - travel);
      float landingArea = abs(alongX.x * alongZ.y - alongX.y * alongZ.x);
      // Ray density scales inversely with landing area. Finite source width
      // rounds off a fold; weaker convergence keeps a soft luminous shoulder.
      float blur = .32 + min(footprint * 16.0, .20);
      float unfocused = inversesqrt(1.0 + blur * blur);
      float density = inversesqrt(landingArea * landingArea + blur * blur);
      float focus = max(0.0, density - unfocused) / (1.0 / blur - unfocused);
      toLight = -ray;
      #ifdef AQUARIUM_DECOR_RECEIVER
        // Convert flux per horizontal area to flux normal to the ray. The
        // receiving material applies its own angle of incidence exactly once.
        float facing = 1.0 / max(.6, toLight.y);
      #else
        float facing = dot(worldNormal, -ray);
        #ifdef DOUBLE_SIDED
          facing = max(facing, -0.44 * facing);
        #endif
      #endif
      float submerged = smoothstep(0.005, 0.075, depth);
      float clarity = 1.0 - 0.16 * smoothstep(0.08, 0.32, depth);
      float screenFade = 1.0 - smoothstep(0.009, 0.040, footprint);
      return 0.83 * uCausticStrength * focus * tank * windowLight * submerged * clarity * screenFade * max(facing, 0.0);
    }
  `;

  window.createAquariumCaustics = function ({ bounds, waterLevel, time, sunlight, sunStrength, sunColor, surfaceSlopeGLSL }) {
    const installed = new WeakSet();
    const uniforms = {
      uTime: time,
      uCausticWaterLevel: { value: waterLevel },
      uCausticSunlight: { value: sunlight },
      uCausticWindowX: { value: window.AQUARIUM_LAYOUT.rightWall },
      uCausticStrength: sunStrength,
      uCausticColor: sunColor,
      uCausticBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ) },
    };
    const fragmentPrelude = /* glsl */ `
      varying vec3 vAquariumCausticPosition;
      uniform float uTime;
      uniform float uCausticWaterLevel;
      uniform float uCausticWindowX;
      uniform vec3 uCausticSunlight;
      uniform float uCausticStrength;
      uniform vec3 uCausticColor;
      uniform vec4 uCausticBounds;
      ${surfaceSlopeGLSL}
      ${projectionGLSL}
    `;

    function apply(material, receiver = 'bed', tankRenderer) {
      if (!material?.isMeshStandardMaterial || installed.has(material)) return material;
      installed.add(material);
      const beforeCompile = material.onBeforeCompile;
      const programKey = material.customProgramCacheKey;
      material.onBeforeCompile = function (shader, renderer) {
        beforeCompile.call(this, shader, renderer);
        // The drawer can share a swimming fish's material, under studio lights.
        if (tankRenderer && renderer !== tankRenderer) return;
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec3 vAquariumCausticPosition;\n' + shader.vertexShader.replace(
          '#include <project_vertex>', /* glsl */ `
            #include <project_vertex>
            vAquariumCausticPosition = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
          `,
        );
        const receiverDefine = receiver === 'bed' ? '' : '#define AQUARIUM_DECOR_RECEIVER\n';
        shader.fragmentShader = receiverDefine + fragmentPrelude + shader.fragmentShader.replace(
          '#include <shadowmap_pars_fragment>', /* glsl */ `
            #include <shadowmap_pars_fragment>
            #include <shadowmask_pars_fragment>
          `,
        ).replace(
          '#include <lights_fragment_end>', /* glsl */ `
            #include <lights_fragment_end>
            vec3 causticNormal = transformNormalByInverseViewMatrix(normal, viewMatrix);
            vec3 causticDirection;
            float causticLight = aquariumCaustic(vAquariumCausticPosition, causticNormal, causticDirection);
            if (causticLight > 0.0) {
              #ifdef AQUARIUM_DECOR_RECEIVER
                IncidentLight beam;
                beam.direction = mat3(viewMatrix) * causticDirection;
                beam.visible = true;
                float exposure = getShadowMask();
                ${receiver === 'stone' ? `
                  float incidence = dot(nonPerturbedNormal, beam.direction);
                  exposure *= smoothstep(0., .18, incidence);
                  #ifdef AQUARIUM_SCANNED_RECESS
                    exposure *= 1. - recess * mix(.75, .24, saturate(incidence));
                  #endif
                ` : ''}
                beam.color = PI * uCausticColor * causticLight * exposure;
                RE_Direct(beam, geometryPosition, geometryNormal, geometryViewDir,
                  geometryClearcoatNormal, material, reflectedLight);
                ${receiver === 'fin' ? `
                  // Pigmented rays intercept more of the beam. The thinner web
                  // scatters some light forward; coverage still comes from its alpha.
                  float back = saturate(-dot(nonPerturbedNormal, beam.direction));
                  float web = 1.0 - smoothstep(.18, .94, diffuseColor.a);
                  float through = (.09 + .53 * web) * back * back;
                  vec3 membraneTint = sqrt(max(material.diffuseColor, vec3(0.0)));
                  reflectedLight.directDiffuse += RECIPROCAL_PI * beam.color * membraneTint * through;
                ` : ''}
              #else
                reflectedLight.directDiffuse += material.diffuseColor * uCausticColor
                  * causticLight * getShadowMask();
              #endif
            }
          `,
        );
      };
      material.customProgramCacheKey = function () {
        const originalKey = programKey === THREE.Material.prototype.customProgramCacheKey
          ? beforeCompile.toString() : programKey.call(this);
        return `${originalKey}|aquarium-caustics|${receiver}|${surfaceSlopeGLSL}`;
      };
      material.needsUpdate = true;
      return material;
    }

    return { apply };
  };
})();
