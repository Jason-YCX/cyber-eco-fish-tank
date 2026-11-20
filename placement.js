function createAquariumPlacement({ camera, sand, decor }) {
  const raycaster = new THREE.Raycaster();
  const normalMatrix = new THREE.Matrix3();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -decor.waterLevel);
  const up = new THREE.Vector3(0, 1, 0);
  const meshes = [sand];
  const bedAndRocks = [sand];
  const owners = new Map();
  let indexed = 0;

  function cast(pointer, tool) {
    while (indexed < decor.items.length) {
      const item = decor.items[indexed++];
      item.object.traverseVisible((mesh) => {
        if (!mesh.isMesh || !mesh.material.visible) return;
        owners.set(mesh, item);
        meshes.push(mesh);
        if (item.kind === 'stone') bedAndRocks.push(mesh);
      });
    }
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(tool === 'sand' || tool === 'stone' ? bedAndRocks : meshes, false);
  }

  function hitNormal(hit) {
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    return hit.face.normal.clone().applyNormalMatrix(normalMatrix);
  }

  function pickTarget(pointer, tool) {
    const [hit] = cast(pointer, tool);
    if (!hit) return null;
    const item = owners.get(hit.object);
    if (item) return { kind: item.kind, item, position: hit.point };
    return { kind: 'sand', position: hit.point, normal: hitNormal(hit) };
  }

  function findLanding(pointer, item) {
    if (item.isFloating) {
      raycaster.setFromCamera(pointer, camera);
      const position = raycaster.ray.intersectPlane(waterPlane, new THREE.Vector3());
      if (!position) return { reason: 'outside' };
      return { position, normal: up, reason: decor.landingReason(item, position.x, position.z) };
    }
    raycaster.setFromCamera(pointer, camera);
    const [ground] = raycaster.intersectObject(sand, false);
    if (!ground) return { reason: 'outside' };
    const { point: position } = ground;
    return {
      position, normal: hitNormal(ground),
      reason: decor.landingReason(item, position.x, position.z),
    };
  }

  return { pickTarget, findLanding };
}
