async function startAquarium(canvas, toolToggle, toolMenu) {
  const previewParams = new URLSearchParams(window.location.search);
  const preview = previewParams.get('preview');
  const ecosystem = preview === 'ecosystem' || (preview === null && !previewParams.has('substrate'));
  const tank = createAquariumScene(canvas, { ecosystem });
  await tank.ready;
  tank.resize();
  const { camera, setMarker } = tank;
  const placement = createAquariumPlacement(tank);
  const catalog = {
    plant: [['monteCarlo', '趴地矮珍珠'], ['bladderwort', '挖耳草'], ['hornwort', '金鱼藻'], ['tigerVallisneria', '虎纹苦草'], ['redRootFloater', '红根浮萍'], ['original', '阔叶水草']],
    stone: [
      ['dragon', '黄虎石'], ['tripoOhkoWeathered', 'Tripo 黄虎石 · 风化'], ['tripoOhko', 'Tripo 黄虎石 · 初版'],
      ['slate', '红瓦石'], ['river', '圆溪石'], ['original', '原景岩石'],
    ],
    sand: [['original', '原色细砂'], ['soil', '黑褐草泥'], ['redSand', '暖红砂'], ['gravel', '杂色河砾']],
    fish: [['guppy', '孔雀鱼'], ['pandaCory', '熊猫鼠鱼'], ['otocinclus', '小精灵鱼'], ['cardinal', '宝莲灯']],
  };
  const previews = createStockPreviews(tank);
  const stockGrid = document.querySelector('#stock-grid');
  const stockStatus = document.querySelector('#stock-status');
  const drawerClose = document.querySelector('#drawer-close');
  const modeBar = document.querySelector('#tank-mode');
  const modeHint = document.querySelector('#mode-hint');
  const modeHints = { feed: '点击水面喂食', plant: '拖动水草调整位置', stone: '拖动石头调整位置', sand: '上下拖动底床塑形' };
  const pointer = new THREE.Vector2();
  const categoryButtons = [...toolMenu.querySelectorAll('.drawer-tabs [data-tool]')];
  const lightingToggle = document.querySelector('#lighting-toggle');
  const lightingPanel = document.querySelector('#lighting-panel');
  const lightingTime = document.querySelector('#lighting-time');
  const lightingLabel = document.querySelector('#lighting-label');
  const lightingLocal = document.querySelector('#lighting-local');
  const lightingPreview = document.querySelector('#lighting-preview');
  const sandHeightPerPixel = 0.00065;
  const dragThreshold = 5;
  let activeTool = null;
  let category = 'fish';
  let editOnClose = null;
  let appliedBed = 'original';
  let bedRequest = 0;
  let gesture = null;
  let previousFrameTime = null;
  let displayedMinute = -1;
  let displayedMode = '';

  const lightPreview = preview === 'caustics';
  const bedToPreview = previewParams.get('substrate') ?? (lightPreview ? 'redSand' : null);
  if (catalog.sand.some(([type]) => type === bedToPreview)) {
    await tank.setSubstrate(bedToPreview);
    appliedBed = bedToPreview;
    category = 'sand';
    tank.zoom(.39);
    tank.orbit(0, 83);
    if (lightPreview) tank.setLightingHour(12);
    else setCanvasTool('sand');
  } else {
    tank.frameFront(ecosystem ? 15 : 9);
    if (preview === 'ecosystem') tank.setLightingHour(11);
  }
  tank.render();

  function syncLightingPanel() {
    if (lightingPanel.hidden) return;
    const { hour, mode } = tank.getLighting();
    const minute = Math.min(1439, Math.floor(hour * 60 + 1e-7));
    if (minute !== displayedMinute) {
      const label = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      lightingTime.value = minute;
      lightingTime.setAttribute('aria-valuetext', label);
      lightingLabel.textContent = label;
      displayedMinute = minute;
    }
    if (mode !== displayedMode) {
      lightingLocal.setAttribute('aria-pressed', String(mode === 'local'));
      lightingPreview.setAttribute('aria-pressed', String(mode === 'preview'));
      lightingPreview.textContent = mode === 'preview' ? '暂停快放' : '快速播放';
      displayedMode = mode;
    }
  }

  function setLightingPanelOpen(open) {
    lightingPanel.hidden = !open;
    lightingToggle.setAttribute('aria-expanded', String(open));
    toolMenu.classList.toggle('lighting-open', open);
    syncLightingPanel();
  }

  function setCanvasTool(tool) {
    cancelGesture();
    activeTool = tool;
    canvas.dataset.tool = tool ?? '';
    modeHint.textContent = modeHints[tool] ?? '';
    modeBar.hidden = !toolMenu.hidden || !modeHints[tool];
  }

  function updateBedButtons() {
    if (category !== 'sand' || toolMenu.hidden) return;
    for (const button of stockGrid.querySelectorAll('.stock-add')) {
      const current = button.dataset.type === appliedBed;
      const label = button.dataset.label;
      button.setAttribute('aria-current', String(current));
      button.title = current ? '当前底床：' + label : '更换整缸底床为' + label;
      button.setAttribute('aria-label', button.title);
      button.textContent = current ? '已铺' : '铺设';
    }
  }

  function showCategory(next) {
    category = next;
    editOnClose = null;
    setCanvasTool(next);
    setLightingPanelOpen(false);
    stockStatus.textContent = '';
    for (const button of categoryButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === next));
    }
    const cells = document.createDocumentFragment();
    const entries = [];
    for (const [type, label] of catalog[next]) {
      const cell = document.createElement('article');
      cell.className = 'stock-cell';
      const view = document.createElement('div');
      view.className = 'stock-preview';
      view.tabIndex = 0;
      view.setAttribute('role', 'group');
      view.setAttribute('aria-label', label + '的三维预览，拖动或按方向键旋转');
      const foot = document.createElement('div');
      foot.className = 'stock-cell-foot';
      const name = document.createElement('span');
      name.className = 'stock-name';
      name.textContent = label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stock-action stock-add';
      button.dataset.type = type;
      button.dataset.label = label;
      button.textContent = '+';
      button.title = '将' + label + '放入缸中';
      button.setAttribute('aria-label', button.title);
      foot.append(name, button);
      cell.append(view, foot);
      cells.append(cell);
      entries.push({ type, element: view });
    }
    stockGrid.replaceChildren(cells);
    stockGrid.dataset.category = next;
    document.querySelector('.stock-hint').textContent = next === 'sand'
      ? '拖动模型可旋转，点「铺设」更换整缸底床'
      : '拖动模型可旋转，点 + 放入缸中';
    stockGrid.closest('.drawer-body').scrollTop = 0;
    updateBedButtons();
    previews.show(next, entries);
  }

  function setMenuOpen(open, tool = null) {
    toolMenu.hidden = !open;
    toolMenu.inert = !open;
    toolToggle.inert = open;
    toolToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      showCategory(category);
      drawerClose.focus({ preventScroll: true });
    } else {
      previews.hide();
      setLightingPanelOpen(false);
      setCanvasTool(tool);
      editOnClose = null;
    }
  }

  function seatObjects() {
    tank.decor.reseat();
  }

  function sample(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function screenPoint({ x, y }, target) {
    const rect = canvas.getBoundingClientRect();
    return target.set(2 * (x - rect.left) / rect.width - 1, 1 - 2 * (y - rect.top) / rect.height);
  }

  function trackDrag(event) {
    const current = sample(event);
    if (!gesture.dragged) {
      const start = gesture.pressSample;
      gesture.dragged = Math.hypot(current.x - start.x, current.y - start.y) >= dragThreshold;
    }
    return current;
  }

  function updateDrag(sample) {
    const previous = gesture.lastSample;
    if (previous?.x === sample.x && previous.y === sample.y) return;
    gesture.lastSample = sample;
    if (gesture.kind === 'camera') {
      tank.orbit(sample.x - previous.x, sample.y - previous.y);
      return;
    }
    if (gesture.kind === 'sand') {
      if (previous.y === sample.y) return;
      if (!tank.sculptSand((gesture.pressSample.y - sample.y) * sandHeightPerPixel)) return;
      seatObjects();
      const center = gesture.center;
      center.y = tank.sandHeightAt(center.x, center.z) ?? center.y;
      setMarker(center, true, gesture.normal, tank.sandBrushRadius);
      return;
    }

    const { item } = gesture;
    screenPoint(sample, pointer).add(gesture.grabOffset);
    const landing = placement.findLanding(pointer, item);
    if (landing.reason === null) {
      if (tank.decor.seat(item, landing.position.x, landing.position.z)) tank.decor.onChange();
      else landing.reason = 'outside';
    }
    gesture.landing = landing;
    setMarker(landing.position ?? null, landing.reason === null, landing.normal, item.markerRadius);
  }

  function finishEdit(keepPreview) {
    const { kind, startPosition, startRotation } = gesture;
    if (kind === 'camera') return;
    if (kind === 'sand') {
      tank.endSandStroke(keepPreview);
      if (!keepPreview) seatObjects();
    } else if (!keepPreview) {
      const { object } = gesture.item;
      object.position.copy(startPosition);
      object.quaternion.copy(startRotation);
      object.updateMatrixWorld(true);
      tank.decor.onChange();
    } else if (kind === 'stone') {
      tank.updateSandObstacle();
    }
    setMarker(null);
  }

  function releasePointer(pointerId) {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }

  function endDrag(keepPreview) {
    const { pointerId } = gesture;
    finishEdit(keepPreview);
    gesture = null;
    canvas.classList.remove('is-dragging');
    releasePointer(pointerId);
  }

  function cancelGesture() {
    if (!gesture) return;
    if (gesture.kind !== 'pinch') {
      endDrag(false);
      return;
    }

    const points = gesture.points;
    gesture = null;
    canvas.classList.remove('is-dragging');
    for (const pointerId of points.keys()) releasePointer(pointerId);
  }

  function fingerDistance(first, second) {
    return Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
  }

  function updatePinch() {
    const [first, second] = gesture.points.values();
    const distance = fingerDistance(first, second);
    if (distance === gesture.distance) return;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    tank.zoom(gesture.distance / distance, screenPoint(midpoint, pointer));
    gesture.distance = distance;
  }

  toolToggle.addEventListener('click', () => setMenuOpen(true));
  drawerClose.addEventListener('click', () => {
    setMenuOpen(false, editOnClose);
    toolToggle.focus({ preventScroll: true });
  });
  toolMenu.querySelector('[data-tool="feed"]').addEventListener('click', () => {
    setMenuOpen(false, 'feed');
    canvas.focus({ preventScroll: true });
  });
  document.querySelector('#mode-done').addEventListener('click', () => {
    setCanvasTool(null);
    toolToggle.focus({ preventScroll: true });
  });
  lightingToggle.addEventListener('click', () => setLightingPanelOpen(lightingPanel.hidden));
  stockGrid.addEventListener('click', async (event) => {
    const button = event.target.closest('.stock-add');
    if (!button) return;
    const { type, label } = button.dataset;
    if (category === 'sand') {
      const request = ++bedRequest;
      stockStatus.textContent = '正在铺设' + label;
      try {
        const applied = await tank.setSubstrate(type);
        if (!applied || request !== bedRequest) return;
        appliedBed = type;
        updateBedButtons();
        if (category === 'sand' && !toolMenu.hidden) {
          editOnClose = 'sand';
          stockStatus.textContent = '已铺设' + label;
        }
      } catch (error) {
        if (request === bedRequest && category === 'sand' && !toolMenu.hidden) stockStatus.textContent = '底床载入失败，请重试';
        console.error(error);
      }
      return;
    }
    const added = category === 'fish' ? tank.addFish(type) : tank.addDecor(category, type);
    if (added) {
      editOnClose = category === 'fish' ? null : category;
      stockStatus.textContent = label + '已入缸';
      previews.refresh(type);
    } else {
      stockStatus.textContent = '缸内没有合适的空位';
    }
  });
  lightingTime.addEventListener('input', () => {
    tank.setLightingHour(Number(lightingTime.value) / 60);
    syncLightingPanel();
  });
  lightingLocal.addEventListener('click', () => {
    tank.setLightingMode('local');
    syncLightingPanel();
  });
  lightingPreview.addEventListener('click', () => {
    const { hour, mode } = tank.getLighting();
    if (mode === 'preview') tank.setLightingHour(hour);
    else tank.setLightingMode('preview');
    syncLightingPanel();
  });
  for (const button of categoryButtons) {
    button.addEventListener('click', () => {
      if (category !== button.dataset.tool) showCategory(button.dataset.tool);
      else setLightingPanelOpen(false);
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || (toolMenu.hidden && !activeTool)) return;
    if (toolMenu.hidden) setCanvasTool(null);
    else setMenuOpen(false);
    toolToggle.focus({ preventScroll: true });
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (!toolMenu.hidden) {
      const tool = lightingPanel.hidden && modeHints[category] ? category : editOnClose;
      setMenuOpen(false, tool);
    }
    const current = sample(event);
    const { pointerId, pointerType } = event;
    if (gesture) {
      if (gesture.kind === 'pinch' || gesture.pointerType !== 'touch' ||
          pointerType !== 'touch' || gesture.pointerId === pointerId) return;

      const first = gesture.nextSample ?? gesture.lastSample;
      finishEdit(false);
      canvas.setPointerCapture(pointerId);
      gesture = {
        kind: 'pinch',
        points: new Map([[gesture.pointerId, first], [pointerId, current]]),
        distance: fingerDistance(first, current),
      };
      event.preventDefault();
      return;
    }

    canvas.setPointerCapture(pointerId);
    canvas.classList.add('is-dragging');
    event.preventDefault();

    const hit = ['sand', 'plant', 'stone'].includes(activeTool)
      ? placement.pickTarget(screenPoint(current, pointer), activeTool)
      : null;
    const target = hit?.kind === activeTool ? hit : null;
    gesture = {
      kind: target?.kind ?? 'camera', pointerId, pointerType,
      nextSample: null, lastSample: current, pressSample: current, dragged: false,
    };
    if (!target) return;
    if (target.kind === 'sand') {
      const canMoveSand = tank.beginSandStroke(target.position);
      gesture.center = target.position;
      gesture.normal = target.normal;
      setMarker(target.position, canMoveSand, target.normal, tank.sandBrushRadius);
    } else {
      gesture.item = target.item;
      const { object } = target.item;
      const anchor = object.position.clone();
      if (!target.item.isFloating) anchor.y = tank.sandHeightAt(anchor.x, anchor.z) ?? anchor.y;
      const projected = anchor.project(camera);
      const grabOffset = new THREE.Vector2(projected.x, projected.y).sub(pointer);
      gesture.startPosition = object.position.clone();
      gesture.startRotation = object.quaternion.clone();
      gesture.grabOffset = grabOffset;
      gesture.lastSample = null;
      updateDrag(current);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (gesture?.kind === 'pinch') {
      if (gesture.points.has(event.pointerId)) gesture.points.set(event.pointerId, sample(event));
    } else if (event.pointerId === gesture?.pointerId) {
      gesture.nextSample = trackDrag(event);
    }
  });

  function finishPointer(event, canceled) {
    const { pointerId } = event;
    if (gesture?.kind === 'pinch') {
      if (!gesture.points.has(pointerId)) return;
      if (!canceled) {
        gesture.points.set(pointerId, sample(event));
        updatePinch();
      }
      gesture.points.delete(pointerId);
      const [[remainingId, lastSample]] = gesture.points;
      gesture = { kind: 'camera', pointerId: remainingId, pointerType: 'touch', nextSample: null, lastSample, dragged: true };
      releasePointer(pointerId);
      return;
    }
    if (pointerId !== gesture?.pointerId) return;
    if (!canceled) {
      const current = trackDrag(event);
      if (!gesture.dragged) {
        endDrag(false);
        if (activeTool === 'feed') tank.feedAt(screenPoint(current, pointer));
        return;
      }
      updateDrag(current);
    }
    endDrag(!canceled && (gesture.kind === 'sand' || gesture.landing?.reason === null));
  }

  canvas.addEventListener('pointerup', (event) => finishPointer(event, false));
  canvas.addEventListener('pointercancel', (event) => finishPointer(event, true));
  canvas.addEventListener('lostpointercapture', (event) => finishPointer(event, true));

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (gesture && gesture.kind !== 'camera') return;
    if (gesture) gesture.dragged = true;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const delta = THREE.MathUtils.clamp(event.deltaY * units, -180, 180);
    tank.zoom(Math.exp(delta * 0.002), screenPoint(sample(event), pointer));
  }, { passive: false });

  function resize() {
    if (gesture && gesture.kind !== 'camera' && gesture.kind !== 'pinch') endDrag(false);
    tank.resize();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function frame(time) {
    const frameSeconds = previousFrameTime === null ? 0 : Math.max(0, (time - previousFrameTime) * 0.001);
    previousFrameTime = time;
    if (gesture?.kind === 'pinch') {
      updatePinch();
    } else if (gesture?.nextSample) {
      if (gesture.dragged) updateDrag(gesture.nextSample);
      gesture.nextSample = null;
    }

    if ((!gesture || gesture.kind === 'camera' || gesture.kind === 'pinch') && tank.settleSand(frameSeconds)) {
      seatObjects();
    }
    tank.render(time * 0.001, frameSeconds);
    syncLightingPanel();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

async function showAquarium() {
  const canvas = document.querySelector('#aquarium');
  const toolToggle = document.querySelector('#tool-toggle');
  const loading = document.querySelector('#tank-loading');

  try {
    // Give the loading view a paint before building the scene on the main thread.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await startAquarium(canvas, toolToggle, document.querySelector('#tool-menu'));
    canvas.removeAttribute('inert');
    toolToggle.hidden = false;
    loading.classList.add('is-ready');
    loading.setAttribute('aria-hidden', 'true');
    if (new URLSearchParams(window.location.search).get('preview') === 'drawer') toolToggle.click();
  } catch (error) {
    loading.hidden = true;
    document.querySelector('#render-error').hidden = false;
    console.error('鱼缸初始化失败', error);
  }
}

showAquarium();
