(function () {
  'use strict';

  const vertexShader = /* glsl */ `
    varying vec3 vWorldPosition;
    varying vec4 vScreenPosition;

    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPosition = world.xyz;
      vScreenPosition = projectionMatrix * viewMatrix * world;
      gl_Position = vScreenPosition;
    }
  `;

  const surfaceSlopeGLSL = /* glsl */ `
    // Gradient of a short wave train with a slowly travelling envelope.
    vec2 waveTrain(vec2 p, vec2 carrier, vec2 group, float phase, float beat, float amplitude) {
      float crest = dot(carrier, p) + phase;
      float packet = dot(group, p) + beat;
      float envelope = .60 + .40 * cos(packet);
      return amplitude * (envelope * cos(crest) * carrier
        - .40 * sin(packet) * sin(crest) * group);
    }

    vec2 surfaceSlope(vec2 at) {
      // Bend the crest paths over distances larger than a ripple. The same
      // transformed gradient drives both the visible surface and refracted light.
      const vec2 bendX = vec2(6.2, 11.3), bendZ = vec2(-13.7, 4.9);
      vec2 phase = vec2(dot(at, bendX), dot(at, bendZ)) + vec2(-.63, .41)*uTime;
      vec2 bend = vec2(.035, .029);
      vec2 p = at + bend*sin(phase);
      vec2 slope = waveTrain(p, vec2(48., 17.), vec2(8., -5.), -3.72*uTime, -.58*uTime, .00084)
                 + waveTrain(p, vec2(-32., 77.), vec2(6., 16.), 1.8-4.93*uTime, .81*uTime, .00048)
                 + waveTrain(p, vec2(103., -53.), vec2(19., 7.), 2.7-6.37*uTime, 1.4-.92*uTime, .00026)
                 + waveTrain(p, vec2(149., 67.), vec2(-9., 21.), .5-7.81*uTime, 2.2+1.07*uTime, .000115);
      vec2 derivative = slope * bend * cos(phase);
      return slope + derivative.x*bendX + derivative.y*bendZ;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform sampler2D uOpaque;
    uniform sampler2D uOpaqueDepth;
    uniform sampler2D uReflection;
    uniform float uHasOpaqueDepth;
    uniform float uRefractionStrength;
    uniform float uReflectionAmount;
    uniform float uTime;
    uniform vec3 uDaySunDirection;
    uniform vec3 uDaySunColor;
    uniform float uDaySun;
    uniform float uDayLamp;
    uniform mat4 uReflectionViewProjection;
    varying vec3 vWorldPosition;
    varying vec4 vScreenPosition;

    ${surfaceSlopeGLSL}

    vec2 reflectionUV(vec3 at) {
      vec4 clip = uReflectionViewProjection * vec4(at, 1.0);
      return clip.xy / max(clip.w, 0.001) * 0.5 + 0.5;
    }

    void main() {
      vec2 slope = surfaceSlope(vWorldPosition.xz);
      vec3 flatNormal = vec3(0.0, 1.0, 0.0);
      vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
      if (!gl_FrontFacing) {
        normal = -normal;
        flatNormal = -flatNormal;
      }
      vec3 view = normalize(cameraPosition - vWorldPosition);
      float cosAngle = clamp(dot(normal, view), 0.0, 1.0);
      vec2 baseUV = vScreenPosition.xy / vScreenPosition.w * 0.5 + 0.5;
      vec2 bend = (viewMatrix * vec4(normal - flatNormal, 0.0)).xy;
      vec2 sampleUV = clamp(baseUV + bend * (0.016 + 0.012 * (1.0 - cosAngle))
        * uRefractionStrength, vec2(0.0), vec2(1.0));
      if (uHasOpaqueDepth > 0.5) {
        float waterDepth = vScreenPosition.z / vScreenPosition.w * 0.5 + 0.5;
        float sceneDepth = texture2D(uOpaqueDepth, sampleUV).r;
        sampleUV = mix(baseUV, sampleUV, smoothstep(-0.00025, 0.00025, sceneDepth - waterDepth));
      }
      vec3 transmitted = texture2D(uOpaque, sampleUV).rgb;
      vec3 color = transmitted;
      if (uReflectionAmount > 0.0) {
        vec2 center = reflectionUV(vWorldPosition);
        vec2 disturbed = reflectionUV(vWorldPosition + 0.40 * reflect(-view, normal));
        vec2 reflectedUV = center + clamp(disturbed - center, vec2(-0.017), vec2(0.017));
        float border = min(min(reflectedUV.x, reflectedUV.y), 1.0 - max(reflectedUV.x, reflectedUV.y));
        float fresnel = 0.0204 + 0.9796 * pow(1.0 - cosAngle, 5.0);
        vec3 reflected = texture2D(uReflection, clamp(reflectedUV, vec2(0.001), vec2(0.999))).rgb;
        float reflectionLuma = dot(reflected, vec3(0.2126, 0.7152, 0.0722));
        // Limit the bright lamp streak so fish remain readable below it.
        reflected /= 1.0 + 0.45 * uDayLamp * reflectionLuma;
        color = mix(transmitted, reflected, fresnel * smoothstep(0.0, 0.014, border) * uReflectionAmount);
      }
      if (gl_FrontFacing && uDaySun > 0.0 && dot(normal, -uDaySunDirection) > 0.0) {
        vec3 halfway = normalize(view - uDaySunDirection);
        float glint = pow(max(0.0, dot(normal, halfway)), 480.0);
        color += uDaySunColor * glint * (0.44 * uDaySun);
      }
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }
  `;

  window.createAquariumWater = function ({
    scene, width, depth, waterLevel, sceneColor, sceneDepth, lighting, refractionStrength = { value: 1 },
  }) {
    const reflection = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
    });
    reflection.texture.name = 'Aquarium water reflection';
    const reflectedCamera = new THREE.PerspectiveCamera();
    const uniforms = {
      uOpaque: { value: sceneColor },
      uOpaqueDepth: { value: sceneDepth || null },
      uHasOpaqueDepth: { value: sceneDepth ? 1 : 0 },
      uReflection: { value: reflection.texture },
      uReflectionAmount: { value: 0 },
      uReflectionViewProjection: { value: new THREE.Matrix4() },
      uRefractionStrength: refractionStrength,
      uDaySunDirection: lighting.uDaySunDirection,
      uDaySunColor: lighting.uDaySunColor,
      uDaySun: lighting.uDaySun,
      uDayLamp: lighting.uDayLamp,
      uTime: { value: 0 },
    };
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, forceSinglePass: true, toneMapped: false,
    }));
    surface.name = 'AquariumWaterSurface';
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = waterLevel;
    surface.renderOrder = 5;
    scene.add(surface);

    const cameraPosition = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const clipPlane = new THREE.Plane();
    const clip = new THREE.Vector4();
    const farCorner = new THREE.Vector4();
    const drawSize = new THREE.Vector2();
    let hasReflection = false;

    function visibilityAt(height) {
      return THREE.MathUtils.smoothstep(height - waterLevel, 0.003, 0.040);
    }

    function update(timeSeconds, camera) {
      uniforms.uTime.value = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      camera.getWorldPosition(cameraPosition);
      uniforms.uReflectionAmount.value = hasReflection ? visibilityAt(cameraPosition.y) : 0;
    }

    function setReflectionView(camera) {
      camera.getWorldPosition(cameraPosition);
      if (visibilityAt(cameraPosition.y) <= 0) return false;

      reflectedCamera.position.copy(cameraPosition);
      reflectedCamera.position.y = 2 * waterLevel - cameraPosition.y;
      camera.getWorldDirection(forward);
      forward.y = -forward.y;
      reflectedCamera.up.set(0, 1, 0).transformDirection(camera.matrixWorld);
      reflectedCamera.up.y = -reflectedCamera.up.y;
      reflectedCamera.lookAt(forward.add(reflectedCamera.position));
      reflectedCamera.updateMatrixWorld(true);
      reflectedCamera.near = camera.near;
      reflectedCamera.far = camera.far;
      reflectedCamera.layers.mask = camera.layers.mask;
      reflectedCamera.projectionMatrix.copy(camera.projectionMatrix);
      // The mirror camera's local right axis reverses across the water plane.
      reflectedCamera.projectionMatrix.elements[8] *= -1;
      reflectedCamera.projectionMatrixInverse.copy(reflectedCamera.projectionMatrix).invert();

      // Replace the mirror projection's near plane with the water plane.
      // The rest of the projection, including screen X/Y, stays intact.
      clipPlane.setComponents(0, 1, 0, -waterLevel - 0.0008).applyMatrix4(reflectedCamera.matrixWorldInverse);
      clip.set(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);
      farCorner.set(clip.x < 0 ? -1 : 1, clip.y < 0 ? -1 : 1, 1, 1)
        .applyMatrix4(reflectedCamera.projectionMatrixInverse);
      const alignment = clip.dot(farCorner);
      if (!Number.isFinite(alignment) || alignment <= 0.00001) return false;
      clip.multiplyScalar(2 / alignment);
      const projection = reflectedCamera.projectionMatrix.elements;
      projection[2] = clip.x - projection[3];
      projection[6] = clip.y - projection[7];
      projection[10] = clip.z - projection[11];
      projection[14] = clip.w - projection[15];
      reflectedCamera.projectionMatrixInverse.copy(reflectedCamera.projectionMatrix).invert();
      uniforms.uReflectionViewProjection.value.multiplyMatrices(
        reflectedCamera.projectionMatrix, reflectedCamera.matrixWorldInverse,
      );
      return true;
    }

    function renderReflection(renderer, world, camera) {
      if (!setReflectionView(camera)) {
        hasReflection = false;
        uniforms.uReflectionAmount.value = 0;
        return false;
      }

      renderer.getDrawingBufferSize(drawSize);
      const scale = Math.min(0.5, 768 / Math.max(drawSize.x, drawSize.y, 1));
      const reflectionWidth = Math.max(1, Math.round(drawSize.x * scale));
      const reflectionHeight = Math.max(1, Math.round(drawSize.y * scale));
      if (reflection.width !== reflectionWidth || reflection.height !== reflectionHeight) {
        reflection.setSize(reflectionWidth, reflectionHeight);
      }
      const priorTarget = renderer.getRenderTarget();
      const wasVisible = surface.visible;
      surface.visible = false;
      try {
        renderer.setRenderTarget(reflection);
        renderer.clear();
        renderer.render(world, reflectedCamera);
      } finally {
        surface.visible = wasVisible;
        renderer.setRenderTarget(priorTarget);
      }
      hasReflection = true;
      uniforms.uReflectionAmount.value = visibilityAt(cameraPosition.y);
      return true;
    }

    return { surface, update, renderReflection, time: uniforms.uTime, surfaceSlopeGLSL };
  };
})();
