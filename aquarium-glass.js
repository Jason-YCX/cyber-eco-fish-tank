function createAquariumGlass({
  scene, width, height, depth, thickness, waterLevel, sceneColor, sceneDepth, lighting,
  refractionStrength = { value: 1 },
}) {
  const group = new THREE.Group();
  group.name = 'AquariumGlass';
  const panes = [];
  const nearGlass = [];
  const { lampLength, lampHeight, lampZ } = window.AQUARIUM_LAYOUT;
  scene.add(group);

  const vertexShader = `
    varying vec3 panePosition;
    varying vec3 paneNormal;
    varying vec4 paneClip;
    varying float paneViewDepth;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec4 viewPosition = viewMatrix * world;
      panePosition = world.xyz;
      paneNormal = normalize(mat3(modelMatrix) * normal);
      paneClip = projectionMatrix * viewPosition;
      paneViewDepth = -viewPosition.z;
      gl_Position = paneClip;
    }
  `;

  const shading = `
    varying vec3 panePosition;
    varying vec3 paneNormal;
    varying vec4 paneClip;
    varying float paneViewDepth;
    uniform vec3 uDayRoomTint;
    uniform float uDayLamp;
    uniform vec3 uDayLampColor;
    uniform vec3 uLampFixture;

    float fresnel(float cosine) {
      return 0.04 + 0.96 * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
    }

    vec3 reflectedLight(vec3 ray) {
      float upperLight = smoothstep(-0.20, 0.65, ray.y);
      float windowDistance = (ray.x + 0.48) * 3.0;
      float window = exp(-windowDistance * windowDistance)
        * smoothstep(-0.14, 0.28, ray.y) * smoothstep(-0.36, 0.68, ray.z);
      vec3 room = mix(vec3(0.138, 0.143, 0.141), vec3(0.462, 0.474, 0.471), upperLight)
        + vec3(0.249, 0.256, 0.263) * window;
      vec3 lamp = vec3(clamp(panePosition.x, -uLampFixture.x, uLampFixture.x), uLampFixture.yz);
      float glint = pow(max(0.0, dot(ray, normalize(lamp - panePosition))), 24.0);
      return room * uDayRoomTint + uDayLampColor * (0.49 * uDayLamp * glint);
    }
  `;

  const materialOptions = { vertexShader, transparent: true, depthWrite: false, toneMapped: false };
  const lightUniforms = {
    uDayRoomTint: lighting.uDayRoomTint, uDayLamp: lighting.uDayLamp, uDayLampColor: lighting.uDayLampColor,
    uLampFixture: { value: new THREE.Vector3(lampLength / 2 - 0.010, lampHeight, lampZ) },
  };
  const projection = new THREE.Matrix4();
  const depthRange = new THREE.Vector2();
  const exterior = new THREE.ShaderMaterial({
    ...materialOptions,
    uniforms: {
      ...lightUniforms,
      sceneColor: { value: sceneColor },
      sceneDepth: { value: sceneDepth },
      projection: { value: projection },
      depthRange: { value: depthRange },
      thickness: { value: thickness },
      waterLevel: { value: waterLevel },
      innerHalfSize: { value: new THREE.Vector2(width * 0.5 - thickness, depth * 0.5 - thickness) },
      refractionStrength,
    },
    fragmentShader: `
      ${shading}
      uniform sampler2D sceneColor;
      uniform sampler2D sceneDepth;
      uniform mat4 projection;
      uniform vec2 depthRange;
      uniform float thickness;
      uniform float waterLevel;
      uniform vec2 innerHalfSize;
      uniform float refractionStrength;

      float viewDistance(float depth) {
        float nearPlane = depthRange.x;
        float farPlane = depthRange.y;
        return nearPlane * farPlane / mix(farPlane, nearPlane, depth);
      }

      float submergedDistance(vec3 ray, float objectDepth) {
        vec3 low = vec3(-innerHalfSize.x, 0.0, -innerHalfSize.y);
        vec3 high = vec3(innerHalfSize.x, waterLevel, innerHalfSize.y);
        vec3 positive = step(vec3(0.0), ray);
        vec3 speed = mix(vec3(-1.0), vec3(1.0), positive) * max(abs(ray), vec3(0.0001));
        vec3 exitDistance = (mix(low, high, positive) - clamp(panePosition, low, high)) / speed;
        float toObject = (objectDepth - paneViewDepth) / max(0.1, -(viewMatrix * vec4(ray, 0.0)).z);
        return max(0.0, min(toObject, min(exitDistance.x, min(exitDistance.y, exitDistance.z))));
      }

      void main() {
        vec3 normal = normalize(paneNormal);
        vec3 incoming = normalize(panePosition - cameraPosition);
        float incidence = clamp(-dot(incoming, normal), 0.0, 1.0);
        vec3 inside = refract(incoming, normal, 1.0 / 1.50);
        float insideCosine = max(0.5, -dot(inside, normal));
        float path = thickness / insideCosine;
        vec2 originalUv = paneClip.xy / paneClip.w * 0.5 + 0.5;

        // Parallel faces restore the angle in air but leave a lateral shift through the slab.
        vec3 shift = (inside / insideCosine - incoming / max(incidence, 0.12)) * thickness;
        float meniscus = exp(-abs(panePosition.y - waterLevel) / 0.0011);
        shift.y += meniscus * 0.0009;
        vec4 shiftedClip = projection * viewMatrix * vec4(panePosition + shift * refractionStrength, 1.0);
        vec2 offset = clamp(shiftedClip.xy / shiftedClip.w * 0.5 + 0.5 - originalUv, vec2(-0.017), vec2(0.017));
        float originalDepth = viewDistance(texture2D(sceneDepth, originalUv).r);
        offset *= min(1.0, paneViewDepth / max(originalDepth, paneViewDepth));
        vec2 sampledUv = clamp(originalUv + offset, vec2(0.0006), vec2(0.9994));
        float shiftedDepth = viewDistance(texture2D(sceneDepth, sampledUv).r);
        if (shiftedDepth < paneViewDepth - 0.002) {
          sampledUv = originalUv;
          shiftedDepth = originalDepth;
        }

        vec4 background = texture2D(sceneColor, sampledUv);
        // At a butt joint some rays leave this face through the edge of a perpendicular pane.
        vec3 glassExit = panePosition + inside * path;
        float faceAlongZ = step(abs(normal.x), abs(normal.z));
        float jointPosition = mix(glassExit.z, glassExit.x, faceAlongZ);
        float jointInset = mix(innerHalfSize.y, innerHalfSize.x, faceAlongZ);
        float jointOffset = abs(jointPosition) - jointInset;
        float jointDirection = mix(incoming.z, incoming.x, faceAlongZ) * sign(jointPosition);
        float jointWidth = max(0.0, jointDirection > 0.0 ? thickness - jointOffset : jointOffset);
        float jointPath = min(0.22, jointWidth / max(0.040, abs(jointDirection)))
          * smoothstep(-0.00025, 0.00070, jointOffset);
        float jointReflection = exp(-abs(jointOffset) / 0.00072)
          * (0.075 + 0.11 * (1.0 - incidence));
        float wet = 1.0 - smoothstep(waterLevel - 0.001, waterLevel + 0.0005, panePosition.y);
        float waterPath = max(0.0, submergedDistance(incoming, shiftedDepth) - jointPath) * wet;
        vec3 absorption = exp(-vec3(1.80, 1.48, 1.60) * (path + jointPath) - 0.045 * waterPath);
        float reflection = min(0.68, fresnel(incidence) + meniscus * 0.10 + jointReflection);
        vec3 light = reflectedLight(reflect(incoming, normal));
        vec3 premultiplied = background.rgb * absorption * (1.0 - reflection) + light * reflection;
        float alpha = background.a * (1.0 - reflection) + reflection;
        gl_FragColor = vec4(premultiplied / max(alpha, 0.0001), alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const interior = new THREE.ShaderMaterial({
    ...materialOptions,
    uniforms: { ...lightUniforms, waterLevel: { value: waterLevel } },
    fragmentShader: `
      ${shading}
      uniform float waterLevel;

      void main() {
        vec3 normal = normalize(paneNormal);
        vec3 incoming = normalize(panePosition - cameraPosition);
        float reflection = fresnel(max(0.0, -dot(incoming, normal)));
        float wet = 1.0 - smoothstep(waterLevel - 0.001, waterLevel + 0.001, panePosition.y);
        vec3 shade = mix(vec3(0.395, 0.414, 0.407) * uDayRoomTint,
          reflectedLight(reflect(incoming, normal)), 0.5);
        float waterDistance = panePosition.y - waterLevel;
        float lineWidth = max(0.0013, 0.65 * fwidth(waterDistance));
        float meniscus = exp(-abs(waterDistance) / lineWidth);
        vec3 waterline = mix(shade, uDayLampColor, 0.32 * uDayLamp);
        float opacity = 0.025 + 0.012 * wet + 0.08 * reflection;
        gl_FragColor = vec4(mix(shade, waterline, meniscus),
          opacity + meniscus * (0.09 + 0.09 * uDayLamp));
        #include <colorspace_fragment>
      }
    `,
  });
  const polishedEdge = new THREE.ShaderMaterial({
    ...materialOptions,
    uniforms: { ...lightUniforms },
    fragmentShader: `
      ${shading}

      void main() {
        vec3 normal = normalize(paneNormal);
        vec3 incoming = normalize(panePosition - cameraPosition);
        float reflection = fresnel(max(0.0, -dot(incoming, normal)));
        vec3 edge = mix(vec3(0.218, 0.250, 0.240) * uDayRoomTint,
          reflectedLight(reflect(incoming, normal)), 0.24 + 0.64 * reflection);
        gl_FragColor = vec4(edge, 0.51 + 0.29 * reflection);
        #include <colorspace_fragment>
      }
    `,
  });
  const silicone = new THREE.ShaderMaterial({
    ...materialOptions, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { ...lightUniforms },
    fragmentShader: `
      ${shading}

      void main() {
        vec3 normal = normalize(paneNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 incoming = normalize(panePosition - cameraPosition);
        float reflection = fresnel(max(0.0, -dot(incoming, normal)));
        vec3 shade = mix(vec3(0.249, 0.266, 0.261) * uDayRoomTint,
          reflectedLight(reflect(incoming, normal)), 0.16 + 0.5 * reflection);
        gl_FragColor = vec4(shade, 0.26 + 0.27 * reflection);
        #include <colorspace_fragment>
      }
    `,
  });
  const hiddenFace = new THREE.MeshBasicMaterial({ visible: false });
  const seals = [];

  function buildPane(length) {
    const halfWidth = length * 0.5;
    const halfHeight = height * 0.5;
    const halfThickness = thickness * 0.5;
    const bevel = Math.min(0.00045, thickness * 0.12);
    const ring = (x, y, z) => [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
    const rings = [
      ring(halfWidth - bevel, halfHeight - bevel, -halfThickness),
      ring(halfWidth, halfHeight, -halfThickness + bevel),
      ring(halfWidth, halfHeight, halfThickness - bevel),
      ring(halfWidth - bevel, halfHeight - bevel, halfThickness),
    ];
    const quad = (points, a, b, c, d) => points.push(...a, ...b, ...c, ...a, ...c, ...d);
    const facePoints = [];
    const edgePoints = [];
    const [back, , , front] = rings;
    quad(facePoints, front[0], front[1], front[2], front[3]);
    quad(facePoints, back[3], back[2], back[1], back[0]);
    for (let i = 0; i < rings.length - 1; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        const next = (j + 1) % 4;
        quad(edgePoints, rings[i][j], rings[i][next], rings[i + 1][next], rings[i + 1][j]);
      }
    }
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(facePoints, 3));
    faceGeometry.computeVertexNormals();
    faceGeometry.addGroup(0, 6, 0);
    faceGeometry.addGroup(6, 6, 1);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePoints, 3));
    edgeGeometry.computeVertexNormals();
    return { faceGeometry, edgeGeometry };
  }

  function addPane(name, length, x, z, yaw, outward) {
    const { faceGeometry, edgeGeometry } = buildPane(length);
    const mesh = new THREE.Mesh(faceGeometry, [exterior, hiddenFace]);
    mesh.name = name;
    mesh.position.set(x, height * 0.5, z);
    mesh.rotation.y = yaw;
    const edge = new THREE.Mesh(edgeGeometry, polishedEdge);
    edge.name = name + 'PolishedEdges';
    mesh.add(edge);
    group.add(mesh);
    const planePoint = mesh.position.clone().addScaledVector(outward, thickness * 0.5);
    panes.push({ mesh, edge, outward, planeDistance: outward.dot(planePoint) });
  }

  function addCornerSeal(signX, signZ) {
    const x = signX * (width * 0.5 - thickness + 0.00008);
    const z = signZ * (depth * 0.5 - thickness + 0.00008);
    const radius = Math.min(0.00175, thickness * 0.34);
    const segments = 5;
    const points = [];
    const indices = [];
    // The concave fillet touches both inboard walls of the butt joint.
    for (let i = 0; i <= segments; i += 1) {
      const angle = i / segments * Math.PI * 0.5;
      const offsetX = radius * (1.0 - Math.cos(angle));
      const offsetZ = radius * (1.0 - Math.sin(angle));
      const ax = x - signX * offsetX;
      const az = z - signZ * offsetZ;
      points.push(ax, thickness, az, ax, height - 0.0007, az);
      if (i > 0) {
        const a = i * 2 - 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const seal = new THREE.Mesh(geometry, silicone);
    seal.name = 'CornerSilicone';
    group.add(seal);
    seals.push({ seal, signX, signZ });
  }

  const sideLength = depth - 2 * thickness;
  addPane('FrontPane', width, 0, (depth - thickness) * 0.5, 0, new THREE.Vector3(0, 0, 1));
  addPane('RearPane', width, 0, -(depth - thickness) * 0.5, Math.PI, new THREE.Vector3(0, 0, -1));
  addPane('RightPane', sideLength, (width - thickness) * 0.5, 0, Math.PI * 0.5, new THREE.Vector3(1, 0, 0));
  addPane('LeftPane', sideLength, -(width - thickness) * 0.5, 0, -Math.PI * 0.5, new THREE.Vector3(-1, 0, 0));
  for (const signX of [-1, 1]) {
    for (const signZ of [-1, 1]) addCornerSeal(signX, signZ);
  }

  const base = new THREE.Mesh(new THREE.BoxGeometry(width - 2 * thickness, thickness, sideLength), polishedEdge);
  base.name = 'BottomPane';
  base.position.y = thickness * 0.5;
  base.renderOrder = 1;
  group.add(base);

  const eye = new THREE.Vector3();
  function updateView(camera) {
    camera.getWorldPosition(eye);
    projection.copy(camera.projectionMatrix);
    depthRange.set(camera.near, camera.far);
    nearGlass.length = 0;
    for (const { mesh, edge, outward, planeDistance } of panes) {
      const facesCamera = eye.dot(outward) > planeDistance;
      mesh.renderOrder = facesCamera ? 4 : 1;
      edge.renderOrder = facesCamera ? 6 : 2;
      mesh.material[0] = facesCamera ? exterior : hiddenFace;
      mesh.material[1] = facesCamera ? hiddenFace : interior;
      if (facesCamera) nearGlass.push(mesh);
    }
    for (const { seal, signX, signZ } of seals) {
      const near = eye.x * signX > width * 0.5 || eye.z * signZ > depth * 0.5;
      seal.renderOrder = near ? 6 : 2;
      if (near) nearGlass.push(seal);
    }
  }

  function setNearVisible(visible) {
    for (const object of nearGlass) object.visible = visible;
  }

  return { group, updateView, setNearVisible };
}
