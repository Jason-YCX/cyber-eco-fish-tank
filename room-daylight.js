(function () {
  'use strict';

  const roomMaterials = new Set(['Room baked daylight', 'Cabinet top baked daylight']);
  const prepared = new WeakSet();

  const roomLighting = /* glsl */ `
    varying vec3 vDayRoomNormal;
    uniform vec3 uDaySunDirection;
    uniform vec3 uDaySunColor;
    uniform vec3 uDayRoomTint;
    uniform vec3 uDayLampColor;
    uniform float uDaySun;
    uniform float uDayLamp;
    uniform vec3 uDayCabinetMin;
    uniform vec3 uDayCabinetMax;
    uniform vec3 uDayLampFixture;
    uniform vec2 uDayTankHalfSize;
    uniform float uDayWindowX;

    float cabinetShadow(vec3 position, vec3 toWindow, float windowDistance) {
      // Approximate the cabinet body; the baked map retains the feet and contact detail.
      vec3 inverseRay = sign(toWindow + vec3(0.00001)) / max(abs(toWindow), vec3(0.00001));
      vec3 a = (uDayCabinetMin - position) * inverseRay;
      vec3 b = (uDayCabinetMax - position) * inverseRay;
      vec3 enter = min(a, b);
      vec3 exit = max(a, b);
      float start = max(enter.x, max(enter.y, enter.z));
      float end = min(exit.x, min(exit.y, exit.z));
      return smoothstep(0.0, 0.052, min(end, windowDistance) - max(start, 0.0));
    }

    float windowSun(vec3 position, vec3 normal) {
      vec3 toWindow = -uDaySunDirection;
      if (uDaySun < 0.001 || toWindow.x <= 0.02 || position.x >= uDayWindowX) return 0.0;
      float facing = max(0.0, dot(normal, toWindow));
      if (facing <= 0.0) return 0.0;
      float distanceToWindow = (uDayWindowX - position.x) / toWindow.x;
      vec2 windowPoint = position.yz + distanceToWindow * toWindow.yz;
      vec2 margin = min(windowPoint - vec2(-0.095, -1.79), vec2(1.31, 0.35) - windowPoint);
      float jamb = smoothstep(0.008, 0.077, min(margin.x, margin.y));
      if (jamb <= 0.0) return 0.0;

      float centerPost = smoothstep(0.012, 0.053, abs(windowPoint.y + 0.72));
      float railDistance = min(abs(windowPoint.x - 0.386), abs(windowPoint.x - 0.855));
      float sashRails = smoothstep(0.002, 0.033, railDistance);
      float blocked = cabinetShadow(position + 0.004 * normal, toWindow, distanceToWindow);
      return 1.20 * uDaySun * facing * jamb * centerPost * sashRails * (1.0 - 0.94 * blocked);
    }

    float tankLamp(vec3 position, vec3 normal) {
      if (uDayLamp < 0.001) return 0.0;
      // Sample the closest point along the actual diffuser above the aquarium.
      vec3 emitter = vec3(clamp(position.x, -uDayLampFixture.x, uDayLampFixture.x), uDayLampFixture.yz);
      vec3 difference = emitter - position;
      float distanceSquared = max(dot(difference, difference), 0.001);
      vec3 towardLamp = difference * inversesqrt(distanceSquared);
      float facing = max(0.0, dot(normal, towardLamp));
      float downward = smoothstep(-0.08, 0.61, towardLamp.y);
      vec2 outsideTank = abs(position.xz) - uDayTankHalfSize;
      float tankCover = (1.0 - smoothstep(-0.006, 0.032, max(outsideTank.x, outsideTank.y)))
        * (1.0 - smoothstep(-0.005, 0.014, position.y));
      float pool = 1.45 * downward * (1.0 - 0.80 * tankCover) / (1.0 + 8.0 * distanceSquared);
      float bounce = 0.19 / (1.0 + 3.4 * distanceSquared);
      // The white diffuser has higher luminance; keep the visible spill in the room subdued.
      return 0.74 * uDayLamp * facing * (pool + bounce);
    }

    #ifdef ROOM_GRAIN
      varying vec3 vRoomGrainRest;
      uniform sampler2D uRoomGrain;
      uniform vec2 uRoomGrainScale;
      void roomSurface(inout vec3 color, inout vec3 n) {
        vec3 p = vRoomGrainRest / uRoomGrainScale.x;
        vec3 w = pow(abs(n), vec3(5.0));
        w /= max(dot(w, vec3(1.)), .0001);
        vec3 x = texture2D(uRoomGrain,p.zy+vec2(.23,.37)).rgb - .5;
        vec3 y = texture2D(uRoomGrain,p.xz+vec2(.62,.13)).rgb - .5;
        vec3 z = texture2D(uRoomGrain,p.xy+vec2(.43,.74)).rgb - .5;
        float strength = uRoomGrainScale.y;
        color *= 1. + 1.55 * strength * dot(w,vec3(x.b,y.b,z.b));
        vec3 slope = w.x*vec3(0.,x.g,x.r) + w.y*vec3(y.r,0.,y.g) + w.z*vec3(z.r,z.g,0.);
        n = normalize(n + 2.2 * strength * (slope - n*dot(slope,n)));
      }
    #endif
    vec3 roomInDaylight(vec3 textureColor, vec3 position) {
      vec3 normal = normalize(vDayRoomNormal);
      #ifdef ROOM_GRAIN
        roomSurface(textureColor, normal);
      #endif
      if (!gl_FrontFacing) normal = -normal;
      vec3 ambient = textureColor * uDayRoomTint;
      vec3 incident = windowSun(position, normal) * uDaySunColor + tankLamp(position, normal) * uDayLampColor;
      vec3 direct = textureColor * incident;
      vec3 headroom = max(vec3(0.06), vec3(1.0) - ambient);
      return ambient + direct / (vec3(1.0) + 0.38 * direct / headroom);
    }
  `;

  const skyLighting = /* glsl */ `
    uniform vec3 uDaySkyTint;
    uniform float uDaySky;

    vec3 skyInDaylight(vec3 photograph, vec3 position) {
      float cloud = dot(photograph, vec3(0.2126, 0.7152, 0.0722));
      float height = smoothstep(-0.095, 1.31, position.y);
      vec3 nightHorizon = vec3(0.008, 0.017, 0.039);
      vec3 nightZenith = vec3(0.003, 0.007, 0.021);
      vec3 night = mix(nightHorizon, nightZenith, height) + cloud * vec3(0.018, 0.026, 0.044);
      vec3 dayTint = mix(uDaySkyTint, mix(uDaySkyTint, vec3(1.0), 0.12), height);
      return mix(night, photograph * dayTint, uDaySky);
    }
  `;

  function lightMaterial(material, uniforms, isSky) {
    if (prepared.has(material)) return;
    prepared.add(material);
    const beforeCompile = material.onBeforeCompile;
    const programKey = material.customProgramCacheKey;
    const grain = material.userData.roomGrain;
    if (grain) material.defines = { ...material.defines, ROOM_GRAIN: 1 };
    material.onBeforeCompile = function (shader, renderer) {
      beforeCompile.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      if (grain) {
        shader.uniforms.uRoomGrain = { value: grain.map };
        shader.uniforms.uRoomGrainScale = { value: new THREE.Vector2(grain.period, grain.strength) };
      }
      const worldPosition = 'varying vec3 vDayRoomPosition;\n';
      const worldNormal = isSky ? '' : 'varying vec3 vDayRoomNormal;\n';
      const transformNormal = isSky ? '' : /* glsl */ `
        vDayRoomNormal = (vec4(normalMatrix * normal, 0.0) * viewMatrix).xyz;
        #ifdef ROOM_GRAIN
          vRoomGrainRest = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif
      `;
      shader.vertexShader = (grain ? 'varying vec3 vRoomGrainRest;\n' : '') + worldPosition + worldNormal + shader.vertexShader.replace(
        '#include <project_vertex>', /* glsl */ `
          #include <project_vertex>
          vDayRoomPosition = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;
          ${transformNormal}
        `,
      );
      const lighting = isSky ? skyLighting : roomLighting;
      const shade = isSky ? 'skyInDaylight' : 'roomInDaylight';
      shader.fragmentShader = worldPosition + lighting + shader.fragmentShader.replace(
        '#include <opaque_fragment>', /* glsl */ `
          outgoingLight = ${shade}(outgoingLight, vDayRoomPosition);
          #include <opaque_fragment>
        `,
      );
    };
    material.customProgramCacheKey = function () {
      const base = programKey === THREE.Material.prototype.customProgramCacheKey
        ? beforeCompile.toString() : programKey.call(this);
      return `${base}|room-daylight|${isSky ? 'sky' : 'interior'}`;
    };
    material.needsUpdate = true;
  }

  window.prepareRoomDaylight = function (room, env) {
    const { width, depth, lampLength, lampHeight, lampZ, rightWall } = window.AQUARIUM_LAYOUT;
    const cabinet = room.getObjectByName('AquariumCabinet');
    const cabinetMin = new THREE.Vector3();
    const cabinetMax = new THREE.Vector3();
    if (cabinet) {
      const bounds = new THREE.Box3().setFromObject(cabinet);
      if (!bounds.isEmpty()) {
        cabinetMin.copy(bounds.min);
        cabinetMin.y = Math.min(cabinetMin.y + 0.11, bounds.max.y);
        cabinetMax.copy(bounds.max);
      }
    }

    const interior = {
      uDaySunDirection: env.uDaySunDirection,
      uDaySunColor: env.uDaySunColor,
      uDaySun: env.uDaySun,
      uDayRoomTint: env.uDayRoomTint,
      uDayLamp: env.uDayLamp,
      uDayLampColor: env.uDayLampColor,
      uDayCabinetMin: { value: cabinetMin },
      uDayCabinetMax: { value: cabinetMax },
      uDayLampFixture: { value: new THREE.Vector3(lampLength / 2 - 0.010, lampHeight, lampZ) },
      uDayTankHalfSize: { value: new THREE.Vector2(width / 2, depth / 2) },
      uDayWindowX: { value: rightWall },
    };
    const sky = { uDaySky: env.uDaySky, uDaySkyTint: env.uDaySkyTint };
    room.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material?.isMeshBasicMaterial) continue;
        if (roomMaterials.has(material.name)) lightMaterial(material, interior, false);
        else if (material.name === 'Window sky photograph') lightMaterial(material, sky, true);
      }
    });
  };
})();
