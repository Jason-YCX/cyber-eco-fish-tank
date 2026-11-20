(function () {
  'use strict';

  const startView = {
    fish: [-1.31, .13],
    stone: [.58, .35],
    plant: [.34, .18],
    sand: [.55, .70],
  };

  async function makeBedSample(type) {
    const surface = createAquariumSandMaterial(type);
    await surface.ready;
    const width = surface.period * (type === 'original' ? .72 : .83);
    const depth = width * .77, thickness = depth * .075;
    const heightAt = (x, z) => depth*.075 * (1-(2*x/width)**2) * (1-(2*z/depth)**2);
    const top = new THREE.PlaneGeometry(width, depth, 96, 72);
    top.rotateX(-Math.PI/2);
    const { position, uv } = top.attributes;
    const weights = new Float32Array(position.count);
    const uCenter = type === 'gravel' ? .3125 : .5, vCenter = type === 'gravel' ? .5625 : .5;
    for (let i = 0; i < position.count; ++i) {
      const x = position.getX(i), z = position.getZ(i);
      position.setY(i, heightAt(x,z));
      uv.setXY(i, (x+surface.period*uCenter)/surface.tileSize, (-z+surface.period*vCenter)/surface.tileSize);
      weights[i] = Math.min(1, 96*(1-Math.abs(2*x/width)), 72*(1-Math.abs(2*z/depth)));
    }
    top.setAttribute('bedSurfaceWeight', new THREE.BufferAttribute(weights, 1));
    top.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setScalar(surface.wetAlbedoScale),
      map: surface.map, normalMap: surface.normalMap, roughnessMap: surface.roughnessMap,
      normalScale: new THREE.Vector2().setScalar(surface.normalStrength), roughness: .93,
    });
    const applyRelief = attachAquariumBedRelief(material, surface);
    applyRelief(surface, 1);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(top,material));

    // Expose the cut face of the sample when the viewing angle is shallow.
    const sides = new THREE.BoxGeometry(width, thickness, depth);
    const textureScale = sides.attributes.uv;
    for (let i = 0; i < textureScale.count; i++) {
      const n = sides.attributes.normal;
      const length = Math.abs(n.getX(i)) > .5 ? depth : width;
      const height = Math.abs(n.getY(i)) > .5 ? depth : thickness;
      textureScale.setXY(i, textureScale.getX(i)*length/surface.tileSize,
        textureScale.getY(i)*height/surface.tileSize);
    }
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setScalar(.64*surface.wetAlbedoScale),
      map: surface.map, normalMap: surface.normalMap, normalScale: new THREE.Vector2().setScalar(.82 * surface.normalStrength), roughness: .96,
    });
    const sideMesh = new THREE.Mesh(sides,sideMaterial);
    sideMesh.position.y = -thickness/2-.00002;
    group.add(sideMesh);
    if (type === 'original') {
      const bounds = { minX:-width/2, maxX:width/2, minZ:-depth/2, maxZ:depth/2 };
      const grains = createAquariumLooseGrains(surface, bounds, thickness);
      grains.syncHeights(heightAt);
      grains.updateView(0);
      group.add(grains.mesh);
    }
    return group;
  }

  function fishForPreview(tank, type) {
    const existing = tank.scene.children.find(node => node.userData.species === type);
    let object;
    if (existing) {
      object = existing.clone();
      object.rotation.set(0,0,0);
      object.traverse(node => node.morphTargetInfluences?.fill(0));
    } else {
      const template = aquariumFishSpecies.makeTemplate(type, 0, mesh => mesh);
      object = new THREE.Group();
      object.add(...template.animated, ...template.fixed);
      object.scale.setScalar(aquariumFishSpecies.anatomy[type].length);
    }
    return object;
  }

  async function specimen(tank, category, type, variant) {
    let object;
    if (category === 'fish') {
      object = fishForPreview(tank, type);
    } else if (category === 'sand') {
      object = await makeBedSample(type);
    } else if (category === 'plant') {
      const { plant, plantPick } = createAquariumPlant(type,variant);
      plant.remove(plantPick);
      object = plant;
    } else {
      const original = type === 'original' && tank.decor.items.find(item => item.kind === 'stone' && item.type === type);
      if (original) {
        object = original.object.clone();
        object.children.filter(node => !node.visible).forEach(node => object.remove(node));
      } else {
        const { mesh, collider, ready } = createAquariumStone(type,variant);
        mesh.remove(collider);
        await ready;
        object = mesh;
      }
    }
    object.position.set(0,0,0);
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object,true);
    const centre = bounds.getCenter(new THREE.Vector3());
    object.position.sub(centre);
    const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(.5);
    return { object, half };
  }

  function nextVariant(tank, category, type) {
    if (type === 'original' || category === 'sand' || category === 'fish') return 0;
    const count = tank.decor.items.filter(item => item.kind === category && item.type === type).length;
    return count % (category === 'plant' ? 3 : 2);
  }

  function frameHeight(half, yaw, pitch, aspect) {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const horizontal = half.x*c + half.z*s;
    const vertical = half.y*Math.cos(pitch) + Math.abs(Math.sin(pitch))*(half.x*s + half.z*c);
    return Math.max(horizontal/aspect, vertical);
  }

  window.createStockPreviews = function (tank) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe0d3bf, 1.43));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.1);
    key.position.set(-2.6,3.5,2.4);
    const back = new THREE.DirectionalLight(0xdaf1f7, 1.02);
    back.position.set(1.8,2,-2.2);
    scene.add(key, back);
    const camera = new THREE.OrthographicCamera();
    const cache = new Map(), cards = new Map(), pending = new Set();
    const observer = new ResizeObserver(entries => {
      for (const { target } of entries) {
        const card = cards.get(target.dataset.previewType);
        if (card?.element === target) schedule(card);
      }
    });
    let renderer, frame = 0, bindings, disposed = false;

    function draw(card) {
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ alpha:true, antialias:true, powerPreference:'low-power' });
        renderer.setClearColor(0,0);
        renderer.domElement.addEventListener('webglcontextrestored', () => cards.forEach(schedule));
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(card.element.clientWidth*dpr), h = Math.round(card.element.clientHeight*dpr);
      if (!w || !h) return;
      if (renderer.domElement.width !== w || renderer.domElement.height !== h) renderer.setSize(w,h,false);
      if (card.canvas.width !== w || card.canvas.height !== h) {
        card.canvas.width = w;
        card.canvas.height = h;
      }
      const { object, half } = card.asset;
      const { yaw, pitch } = card;
      const aspect = w/h;
      const [initialYaw,initialPitch] = card.initial;
      const span = 1.12*Math.max(frameHeight(half,yaw,pitch,aspect), frameHeight(half,initialYaw,initialPitch,aspect));
      const radius = half.length();
      camera.left = -span*aspect;
      camera.right = span*aspect;
      camera.top = span;
      camera.bottom = -span;
      camera.near = radius*.01;
      camera.far = radius*9;
      camera.position.set(Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(radius*4);
      camera.lookAt(0,0,0);
      camera.updateProjectionMatrix();
      scene.add(object);
      try {
        renderer.render(scene,camera);
        card.ctx.clearRect(0,0,w,h);
        card.ctx.drawImage(renderer.domElement,0,0);
      } finally {
        scene.remove(object);
      }
      card.element.dataset.previewState = 'ready';
      card.status.hidden = true;
    }

    function fail(card, error) {
      card.element.dataset.previewState = 'error';
      card.status.textContent = '3D 预览暂时无法加载';
      card.status.hidden = false;
      console.error('物品预览加载失败', card.type, error);
    }

    function load(card) {
      const key = card.key;
      let request = cache.get(key);
      if (!request) {
        request = specimen(tank,card.category,card.type,card.variant);
        cache.set(key,request);
        request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
      }
      card.loading = true;
      const stillVisible = () => cards.get(card.type) === card && card.key === key;
      request.then(asset => {
        if (!stillVisible()) return;
        card.asset = asset;
        schedule(card);
      }, error => { if (stillVisible()) fail(card,error); });
    }

    function tick() {
      frame = 0;
      const card = pending.values().next().value;
      if (!card || disposed) return;
      pending.delete(card);
      try {
        if (card.asset) draw(card);
        else if (!card.loading) load(card);
      } catch (error) {
        fail(card,error);
      }
      if (pending.size && !frame) frame = requestAnimationFrame(tick);
    }

    function schedule(card) {
      if (!disposed && cards.get(card.type) === card) {
        pending.add(card);
        if (!frame) frame = requestAnimationFrame(tick);
      }
    }

    function refresh(type) {
      const card = cards.get(type);
      if (!card) return;
      const variant = nextVariant(tank,card.category,type);
      const key = [card.category,type,variant].join('/');
      if (key === card.key && card.element.dataset.previewState !== 'error') return;
      card.key = key;
      card.variant = variant;
      card.asset = null;
      card.loading = false;
      card.element.dataset.previewState = 'loading';
      card.status.hidden = false;
      card.status.textContent = '载入中…';
      schedule(card);
    }

    function enableOrbit(card) {
      const { element } = card;
      const options = {signal:bindings.signal};
      let drag = null;
      function rotate(dx,dy) {
        card.yaw -= dx;
        card.pitch = THREE.MathUtils.clamp(card.pitch+dy,-1.48,1.48);
        schedule(card);
      }
      element.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag || !event.isPrimary) return;
        drag = { id:event.pointerId, x:event.clientX, y:event.clientY };
        element.setPointerCapture(event.pointerId);
        element.dataset.dragging = 'true';
      },options);
      element.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        rotate((event.clientX-drag.x)*.016,(event.clientY-drag.y)*.014);
        drag.x = event.clientX;
        drag.y = event.clientY;
      },options);
      function finish(event) {
        if (!drag || drag.id !== event.pointerId) return;
        drag = null;
        delete element.dataset.dragging;
      }
      for (const name of ['pointerup','pointercancel','lostpointercapture']) element.addEventListener(name,finish,options);
      element.addEventListener('keydown', event => {
        const steps = { ArrowLeft:[-.21,0], ArrowRight:[.21,0], ArrowUp:[0,.16], ArrowDown:[0,-.16] };
        if (event.key === 'Home') {
          [card.yaw,card.pitch] = card.initial;
          schedule(card);
        } else if (Object.hasOwn(steps,event.key)) rotate(...steps[event.key]);
        else return;
        event.preventDefault();
        event.stopPropagation();
      },options);
    }

    function hide() {
      bindings?.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
      pending.clear();
      cards.clear();
    }

    function show(category, entries) {
      hide();
      if (disposed) return;
      bindings = new AbortController();
      for (const { type, element } of entries) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden','true');
        const status = document.createElement('span');
        status.className = 'stock-preview-status';
        status.setAttribute('role','status');
        element.replaceChildren(canvas,status);
        element.dataset.previewType = type;
        const initial = type === 'redRootFloater' ? [.32,.61] : startView[category];
        const card = { type,category,element,canvas,status,ctx:canvas.getContext('2d'),initial,
          yaw:initial[0],pitch:initial[1] };
        cards.set(type,card);
        enableOrbit(card);
        observer.observe(element);
        refresh(type);
      }
    }

    function destroy() {
      hide();
      disposed = true;
      cache.clear();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer = null;
      }
    }

    return { show, refresh, hide, destroy };
  };
})();
