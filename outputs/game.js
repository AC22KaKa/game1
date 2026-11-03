(() => {
  'use strict';

  const data = window.GAME_CONTENT;
  const { settings, ui } = data;
  const timeConfig = data.timeSystem;
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const lightCanvas = document.createElement('canvas');
  lightCanvas.width = settings.width;
  lightCanvas.height = settings.height;
  const light = lightCanvas.getContext('2d');
  canvas.width = settings.width;
  canvas.height = settings.height;
  ctx.imageSmoothingEnabled = false;

  // Only geometry and rendering rules belong here. All display text comes from content.js.
  const format = (key, values = {}) => ui[key].replace(/\{(\w+)\}/g, (_, name) =>
    String(values[name] ?? '').replace(/^\[占位：(.*)\]$/s, '$1'));
  const keys = new Set();
  const collected = new Set();
  const visitedScenes = new Set([settings.initialScene, ...data.world.initialVisitedScenes]);
  const mapState = { layer: 'regions', regionId: null, selected: 0, nodes: [], returnToMap: false, miniVisible: data.world.miniMapVisible };
  const usedHotspots = new Set();
  const handledDeadlines = new Set();
  const seenDeadlineNotices = new Set();
  const seenLockedSlots = new Set();
  const startParts = timeConfig.startDate.split('-').map(Number);
  const state = {
    sceneId: settings.initialScene,
    player: { ...data.scenes[settings.initialScene].spawns[settings.initialSpawn] },
    mode: 'explore', dialogue: null, page: 0, activeHotspot: null,
    exitLocked: true, walking: false, walkTime: 0, toastUntil: 0, lastTime: null,
    date: { year: startParts[0], month: startParts[1], day: startParts[2] },
    slotIndex: 0, deadlineBlocked: false, notice: null, pendingAction: null,
    dialogueConsumesSlot: false, transition: null
  };
  let previousFocus = null;
  let miniDisplayScale = 1;
  let activeScene = data.scenes[state.sceneId];
  const scene = () => activeScene;
  // Keep inactive trigger geometry available for explicit rejection feedback, but hide its markers.
  const hotspots = (includeInactive = false) => {
    const ids = includeInactive
      ? [...new Set([...data.scenes[state.sceneId].hotspotIds, ...scene().hotspotIds])]
      : scene().hotspotIds;
    return ids.map(id => ({ id, ...data.hotspots[id] }));
  };
  const rect = (g, x, y, w, h, color) => { g.fillStyle = color; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const feet = (x = state.player.x, y = state.player.y) => ({ x: x - settings.player.footWidth / 2, y: y - settings.player.footHeight, width: settings.player.footWidth, height: settings.player.footHeight });
  const distance = (point, box) => Math.hypot(Math.max(box.x - point.x, 0, point.x - box.x - box.width), Math.max(box.y - point.y, 0, point.y - box.y - box.height));
  const isNearby = hotspot => distance(state.player, hotspot.rect) <= hotspot.radius;
  const dateKey = date => `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  const parseDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid calendar date: ${value}`);
    const [year, month, day] = value.split('-').map(Number);
    const checked = new Date(0);
    checked.setUTCHours(0, 0, 0, 0);
    checked.setUTCFullYear(year, month - 1, day);
    if (checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month || checked.getUTCDate() !== day) throw new Error(`Invalid calendar date: ${value}`);
    return { year, month, day };
  };
  const dateOrdinal = date => {
    const stamp = new Date(0);
    stamp.setUTCHours(0, 0, 0, 0);
    stamp.setUTCFullYear(date.year, date.month - 1, date.day);
    return Math.floor(stamp.getTime() / 86400000);
  };
  const daysBetween = (from, to) => dateOrdinal(to) - dateOrdinal(from);
  const dateLabel = date => format('dateFormat', { month: date.month, day: date.day });

  function resolveTimeVariant(sceneId, date, slot) {
    const base = data.scenes[sceneId];
    const slotVariant = base.variants?.[slot.id] || {};
    const dateVariant = base.variants?.dates?.[dateKey(date)]?.[slot.id] || {};
    const variant = { ...slotVariant, ...dateVariant };
    return {
      ...base,
      palette: { ...base.palette, ...slotVariant.palette, ...dateVariant.palette },
      lighting: { ...base.lighting, ...slotVariant.lighting, ...dateVariant.lighting },
      hotspotIds: variant.hotspots ?? base.hotspotIds,
      blockedExits: variant.blockedExits ?? base.blockedExits ?? [],
      ambientColor: variant.ambientColor ?? base.ambientColor,
      lockedSlots: variant.lockedSlots ?? base.lockedSlots ?? []
    };
  }

  function applyTimeVariant(sceneId, date, slot) {
    activeScene = resolveTimeVariant(sceneId, date, slot);
    const background = document.createElement('canvas');
    background.width = settings.width;
    background.height = settings.height;
    drawArchitecture(background.getContext('2d'), activeScene);
    backgrounds.set(sceneId, background);
    return activeScene;
  }

  function onTimeChanged(date, slot) {
    applyTimeVariant(state.sceneId, date, slot);
    state.activeHotspot = null;
    // Do not immediately auto-trigger a door under the player after a time change.
    state.exitLocked = true;
    updateCalendarUI();
    updateSceneUI();
    updatePrompt();
    drawMiniMap();
    if (state.mode === 'worldMap') drawWorldMap();
  }

  function hotspotAvailability(hotspot) {
    const allowed = scene().hotspotIds.includes(hotspot.id) &&
      (!hotspot.allowedSlots || hotspot.allowedSlots.includes(currentSlot().id));
    const collectedClue = hotspot.type === 'investigate' && collected.has(hotspot.clue);
    const action = timeConfig.actions[hotspot.actionId];
    return {
      allowed: allowed && !(hotspot.type === 'exit' &&
        (scene().blockedExits.includes(hotspot.id) || !sceneEnterable(hotspot.targetScene) ||
          data.scenes[hotspot.targetScene].regionId !== scene().regionId)),
      collectedClue,
      freeReview: collectedClue && (!action.consumesSlot || action.repeatConsumesSlot === false)
    };
  }

  function rejectUnavailableHotspot(hotspot) {
    if (hotspotAvailability(hotspot).allowed) return false;
    $('toast').textContent = hotspot.type === 'exit' ? ui.exitBlocked : ui.hotspotUnavailable;
    $('toast').hidden = false;
    state.toastUntil = performance.now() + 2100;
    return true;
  }

  // Maps query this same read-only time view; previewing a destination never changes activeScene.
  function slotsLocked(locks = []) {
    return locks.some(lock => typeof lock === 'string' ? lock === currentSlot().id :
      lock.date === dateKey(state.date) && (lock.slots === '*' || lock.slots.includes(currentSlot().id)));
  }

  function sceneEnterable(sceneId) {
    const target = resolveTimeVariant(sceneId, state.date, currentSlot());
    return !slotsLocked(target.lockedSlots) && !slotsLocked(data.world.regions[target.regionId].lockedSlots);
  }

  function edgeOpen(edge) {
    if (slotsLocked(edge.lockedSlots) || !sceneEnterable(edge.to)) return false;
    if (edge.exitId) {
      const source = resolveTimeVariant(edge.from, state.date, currentSlot());
      const exit = data.hotspots[edge.exitId];
      if (!source.hotspotIds.includes(edge.exitId) || source.blockedExits.includes(edge.exitId) ||
          (exit.allowedSlots && !exit.allowedSlots.includes(currentSlot().id))) return false;
    }
    return true;
  }

  function travelStatus(targetId) {
    if (targetId === state.sceneId) return { reason: 'mapCurrent' };
    if (!sceneEnterable(targetId)) return { reason: 'mapLocked' };
    const edges = data.travel.edges.filter(edge => edge.from === state.sceneId && edge.to === targetId);
    if (edges.length && !edges.some(edgeOpen)) return { reason: 'mapLocked' };
    if (!visitedScenes.has(targetId)) return { reason: 'mapUnvisited' };
    const edge = edges.find(edgeOpen);
    return edge ? { edge } : { reason: 'mapNoEdge' };
  }

  function validateMapConfig() {
    const slots = new Set(timeConfig.timeSlots.map(slot => slot.id));
    const validateLocks = locks => {
      if (!Array.isArray(locks)) throw new Error('Map lockedSlots must be an array');
      for (const lock of locks) {
        if (typeof lock === 'string') {
          if (!slots.has(lock)) throw new Error(`Unknown map time slot: ${lock}`);
        } else {
          parseDate(lock.date);
          if (lock.slots !== '*' && (!Array.isArray(lock.slots) || lock.slots.some(id => !slots.has(id)))) throw new Error(`Invalid dated map lock: ${lock.date}`);
        }
      }
    };
    if (!Number.isInteger(data.world.miniMapCellPixels) || data.world.miniMapCellPixels < 1) throw new Error('Mini-map pixel size must be a positive integer');
    const memberships = new Set();
    for (const [regionId, region] of Object.entries(data.world.regions)) {
      if (!region.label || !region.worldNode) throw new Error(`Invalid region: ${regionId}`);
      validateLocks(region.lockedSlots || []);
      for (const id of region.scenes) {
        if (memberships.has(id) || data.scenes[id]?.regionId !== regionId) throw new Error(`Invalid scene region: ${id}`);
        memberships.add(id);
      }
    }
    for (const [id, s] of Object.entries(data.scenes)) {
      const m = s.miniMap;
      if (!memberships.has(id) || !s.worldNode || !m || m.width <= 0 || m.height <= 0 ||
          m.worldWidth <= 0 || m.worldHeight <= 0 || !m.playerSpawn) throw new Error(`Invalid scene map: ${id}`);
      validateLocks(s.lockedSlots || []);
      for (const marker of [...m.exits, ...m.hotspots]) {
        if (marker.edgeId) {
          const edge = data.travel.edges.find(entry => entry.id === marker.edgeId);
          if (edge?.from !== id || edge?.to !== marker.targetScene) throw new Error(`Invalid mini-map travel exit: ${marker.edgeId}`);
        } else if (data.hotspots[marker.id]?.scene !== id) throw new Error(`Invalid mini-map marker: ${marker.id}`);
      }
    }
    const ids = new Set();
    for (const edge of data.travel.edges) {
      if (ids.has(edge.id) || !data.scenes[edge.from] || !data.scenes[edge.to]?.spawns[edge.targetSpawn] || typeof edge.costsTime !== 'boolean') throw new Error(`Invalid travel edge: ${edge.id}`);
      ids.add(edge.id);
      validateLocks(edge.lockedSlots || []);
      if (edge.exitId && (data.hotspots[edge.exitId]?.scene !== edge.from || data.hotspots[edge.exitId]?.targetScene !== edge.to)) throw new Error(`Invalid travel exit: ${edge.id}`);
      const spawn = data.scenes[edge.to].spawns[edge.targetSpawn], target = data.scenes[edge.to];
      const f = feet(spawn.x, spawn.y), b = target.bounds;
      if (f.x < b.x || f.y < b.y || f.x + f.width > b.x + b.width || f.y + f.height > b.y + b.height || target.colliders.some(c => overlaps(f, c))) throw new Error(`Blocked travel spawn: ${edge.id}`);
    }
    for (const id of visitedScenes) if (!data.scenes[id]) throw new Error(`Unknown visited scene: ${id}`);
  }

  function setupMapUI() {
    const bindings = { 'world-open': 'worldMap', 'world-title': 'worldMap', 'world-back': 'mapBack',
      'world-close': 'mapClose', 'map-help': 'mapHelp', 'map-legend': 'mapLegend', 'map-end-slot': 'endSlot' };
    for (const [id, key] of Object.entries(bindings)) $(id).textContent = ui[key];
    $('mini-map').setAttribute('aria-label', ui.mapMiniLabel);
    $('world-canvas').setAttribute('aria-label', ui.mapCanvasLabel);
    $('world-canvas').width = data.world.width;
    $('world-canvas').height = data.world.height;
    $('world-open').addEventListener('click', toggleWorldMap);
    $('world-close').addEventListener('click', closeWorldMap);
    $('world-back').addEventListener('click', worldMapBack);
    $('map-end-slot').addEventListener('click', requestEndSlot);
    $('world-canvas').addEventListener('click', event => {
      if (state.mode !== 'worldMap') return;
      const bounds = $('world-canvas').getBoundingClientRect();
      const x = (event.clientX - bounds.left) * data.world.width / bounds.width;
      const y = (event.clientY - bounds.top) * data.world.height / bounds.height;
      const index = mapState.nodes.findIndex(node => Math.abs(node.x - x) <= 66 && y >= node.y - 25 && y <= node.y + 40);
      if (index >= 0) { mapState.selected = index; activateMapNode(mapState.nodes[index]); }
    });
  }

  function miniMapPoint(player = state.player) {
    const m = scene().miniMap, anchor = m.playerSpawn;
    return { x: anchor.mapX + (player.x - anchor.worldX) * m.width / m.worldWidth,
      y: anchor.mapY + (player.y - anchor.worldY) * m.height / m.worldHeight };
  }

  function drawMiniMap() {
    const mini = $('mini-map');
    mini.hidden = !mapState.miniVisible || state.mode !== 'explore';
    $('stage').classList.toggle('has-mini-map', !mini.hidden);
    if (mini.hidden) return;
    const m = scene().miniMap, c = data.world.colors, cell = data.world.miniMapCellPixels;
    if (mini.width !== m.width * cell || mini.height !== m.height * cell) {
      mini.width = m.width * cell; mini.height = m.height * cell;
    }
    mini.style.width = `${mini.width * miniDisplayScale}px`;
    mini.style.height = `${mini.height * miniDisplayScale}px`;
    const g = mini.getContext('2d'); g.imageSmoothingEnabled = false;
    rect(g, 0, 0, mini.width, mini.height, c.floor);
    for (const [x, y] of m.walls) rect(g, x * cell, y * cell, cell, cell, c.wall);
    for (const marker of [...m.exits, ...m.hotspots]) {
      if (marker.edgeId) {
        const edge = data.travel.edges.find(entry => entry.id === marker.edgeId);
        const color = edgeOpen(edge) ? c.exit : c.locked;
        rect(g, marker.x * cell - 2, marker.y * cell - 1, 5, 3, color);
        rect(g, marker.x * cell, marker.y * cell - 2, 1, 5, color);
        continue;
      }
      const h = { id: marker.id, ...data.hotspots[marker.id] }, status = hotspotAvailability(h);
      const used = h.clue ? collected.has(h.clue) : usedHotspots.has(h.id);
      const color = !status.allowed ? c.locked : h.type === 'exit' ? c.exit : used ? c.collected : c.pending;
      rect(g, marker.x * cell - 1, marker.y * cell - 1, 3, 3, color);
      if (!status.allowed) rect(g, marker.x * cell, marker.y * cell - 3, 1, 2, c.locked);
    }
    const point = miniMapPoint(), x = Math.round(point.x * cell), y = Math.round(point.y * cell);
    rect(g, x - 1, y - 1, 3, 3, c.player);
    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[state.player.facing];
    rect(g, x + dir[0] * 3, y + dir[1] * 3, 1, 1, c.player);
    rect(g, x + dir[0] * 2 - Math.abs(dir[1]), y + dir[1] * 2 - Math.abs(dir[0]),
      dir[1] ? 3 : 1, dir[0] ? 3 : 1, c.player);
  }

  function toggleWorldMap() {
    if (state.mode === 'worldMap') { closeWorldMap(); return; }
    if (state.mode !== 'explore') return;
    mapState.layer = 'regions'; mapState.regionId = null; mapState.selected = 0;
    showWorldMap();
  }

  function showWorldMap() {
    state.mode = 'worldMap'; keys.clear(); state.walking = false;
    $('world-layer').hidden = false;
    $('interaction-prompt').hidden = true;
    $('map-status').textContent = '';
    drawMiniMap(); drawWorldMap();
    $('world-canvas').focus({ preventScroll: true });
  }

  function closeWorldMap() {
    if (state.mode !== 'worldMap') return;
    mapState.returnToMap = false;
    $('world-layer').hidden = true;
    state.mode = 'explore'; keys.clear(); focusCanvas(); drawMiniMap();
  }

  function worldMapBack() {
    if (state.mode !== 'worldMap') return;
    if (mapState.layer === 'regions') { closeWorldMap(); return; }
    mapState.layer = 'regions'; mapState.regionId = null; mapState.selected = 0;
    $('map-status').textContent = ''; drawWorldMap();
  }

  function suspendWorldMap() {
    if (state.mode !== 'worldMap') return;
    mapState.returnToMap = true;
    $('world-layer').hidden = true;
    state.mode = 'explore';
  }

  function resumeWorldMap() {
    if (mapState.returnToMap && state.mode === 'explore') {
      mapState.returnToMap = false;
      showWorldMap();
    }
  }

  function activateMapNode(node) {
    if (!node || state.mode !== 'worldMap') return;
    if (node.kind === 'region') {
      const region = data.world.regions[node.id];
      if (slotsLocked(region.lockedSlots) || region.scenes.every(id => !sceneEnterable(id))) {
        $('map-status').textContent = ui.mapLocked; return;
      }
      mapState.layer = 'scenes'; mapState.regionId = node.id; mapState.selected = 0;
      $('map-status').textContent = ''; drawWorldMap();
      return;
    }
    const status = travelStatus(node.id);
    if (status.reason) { $('map-status').textContent = ui[status.reason]; return; }
    const edge = status.edge;
    if (edge.costsTime) {
      suspendWorldMap();
      if (actionIsBlocked()) return;
      state.pendingAction = { kind: 'travel', edgeId: edge.id };
      $('action-confirm-message').textContent = format('mapTravelConfirm', { name: data.scenes[edge.to].name });
      openModal('actionConfirm'); $('action-accept').focus({ preventScroll: true });
    } else performMapTravel(edge);
  }

  function performMapTravel(edge) {
    const status = travelStatus(edge.to);
    if (status.reason || edge.from !== state.sceneId || !edgeOpen(edge)) return false;
    $('world-layer').hidden = true;
    mapState.returnToMap = false;
    state.mode = 'explore';
    transition({ targetScene: edge.to, targetSpawn: edge.targetSpawn });
    if (edge.costsTime) beginTimeAdvance();
    else focusCanvas();
    return true;
  }

  function drawMapIcon(g, node, color) {
    const x = node.x - 9, y = node.y - 12;
    if (node.icon === 'tree') {
      rect(g, x + 6, y + 12, 5, 12, color); rect(g, x, y + 3, 18, 13, color); rect(g, x + 4, y, 10, 4, color);
    } else if (node.icon === 'mountain') {
      for (let i = 0; i < 10; i++) rect(g, x + 9 - i, y + i * 2, i * 2 + 2, 2, color);
    } else if (node.icon === 'table') {
      rect(g, x, y + 5, 20, 4, color); rect(g, x + 2, y + 9, 3, 12, color); rect(g, x + 15, y + 9, 3, 12, color);
    } else {
      rect(g, x, y + 6, 20, 16, color); rect(g, x + 6, y, 8, 6, color);
      rect(g, x + 4, y + 10, 3, 4, data.world.colors.background); rect(g, x + 13, y + 10, 3, 4, data.world.colors.background);
    }
  }

  function drawWorldMap() {
    if (state.mode !== 'worldMap') return;
    const world = data.world, c = world.colors, g = $('world-canvas').getContext('2d');
    g.imageSmoothingEnabled = false;
    rect(g, 0, 0, world.width, world.height, c.background);
    for (let x = 0; x < world.width; x += 20) rect(g, x, 0, 1, world.height, c.grid);
    for (let y = 0; y < world.height; y += 20) rect(g, 0, y, world.width, 1, c.grid);
    const regionNodes = Object.entries(world.regions).filter(([id]) => mapState.layer === 'regions' || id !== mapState.regionId)
      .map(([id, region]) => ({ kind: 'region', id, label: region.label, ...region.worldNode }));
    const sceneNodes = mapState.layer === 'scenes' ? world.regions[mapState.regionId].scenes
      .map(id => ({ kind: 'scene', id, label: data.scenes[id].name, ...data.scenes[id].worldNode })) : [];
    mapState.nodes = [...sceneNodes, ...regionNodes];
    const nodeFor = id => sceneNodes.find(n => n.id === id) || regionNodes.find(n => n.id === data.scenes[id].regionId);
    for (const edge of data.travel.edges) {
      const from = nodeFor(edge.from), to = nodeFor(edge.to);
      if (!from || !to || from === to) continue;
      const cross = data.scenes[edge.from].regionId !== data.scenes[edge.to].regionId;
      g.strokeStyle = edgeOpen(edge) ? (cross ? c.cross : c.internal) : c.locked;
      g.lineWidth = 2; g.setLineDash(cross ? [6, 5] : []);
      g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke();
    }
    g.setLineDash([]);
    mapState.selected = Math.min(mapState.selected, mapState.nodes.length - 1);
    for (const [index, node] of mapState.nodes.entries()) {
      const region = node.kind === 'region' ? world.regions[node.id] : null;
      const current = node.kind === 'scene' ? node.id === state.sceneId : node.id === scene().regionId;
      const locked = region ? slotsLocked(region.lockedSlots) || region.scenes.every(id => !sceneEnterable(id)) : travelStatus(node.id).reason === 'mapLocked';
      const visited = region ? region.scenes.some(id => visitedScenes.has(id)) : visitedScenes.has(node.id);
      const color = locked ? c.locked : current ? c.current : visited ? c.visited : c.unknown;
      rect(g, node.x - 27, node.y - 25, 54, 50, index === mapState.selected ? c.internal : c.grid);
      rect(g, node.x - 25, node.y - 23, 50, 46, c.background);
      drawMapIcon(g, node, color);
      if (locked) {
        rect(g, node.x + 16, node.y - 20, 9, 8, c.locked);
        rect(g, node.x + 18, node.y - 24, 5, 4, c.locked);
      }
      g.fillStyle = color; g.font = '12px monospace'; g.textAlign = 'center';
      g.fillText(node.label, node.x, node.y + 40, 160);
      if (node.kind === 'scene' && !current && visited && !locked) {
        const edge = travelStatus(node.id).edge;
        if (edge) { g.font = '10px monospace'; g.fillText(edge.costsTime ? ui.mapTravelCost : ui.mapTravelFree, node.x, node.y + 55, 170); }
      }
    }
    $('world-back').hidden = mapState.layer === 'regions';
    $('map-breadcrumb').textContent = format('transitionLabel', { date: dateLabel(state.date), slot: currentSlot().name }) + ' · ' +
      (mapState.layer === 'regions' ? ui.mapRegionView : world.regions[mapState.regionId].label);
  }

  function validateTimeConfig() {
    parseDate(timeConfig.startDate);
    if (!timeConfig.timeSlots.length || timeConfig.timeSlots.some(slot => !slot.id || !slot.name)) throw new Error('Time system needs named slots');
    if (!Number.isFinite(timeConfig.transitionMs) || timeConfig.transitionMs <= 0) throw new Error('Time transition duration must be positive');
    const slotIds = new Set(timeConfig.timeSlots.map(slot => slot.id));
    if (slotIds.size !== timeConfig.timeSlots.length) throw new Error('Time slot IDs must be unique');
    for (const lock of timeConfig.lockedSlots) {
      parseDate(lock.date);
      if (lock.slots !== '*' && !Array.isArray(lock.slots)) throw new Error(`Invalid locked slot list: ${lock.date}`);
      if (lock.slots !== '*' && lock.slots.some(id => !slotIds.has(id))) throw new Error(`Invalid locked slot date: ${lock.date}`);
    }
    const deadlineIds = new Set();
    for (const deadline of timeConfig.deadlines) {
      parseDate(deadline.date);
      if (!deadline.id || deadlineIds.has(deadline.id)) throw new Error('Deadline IDs must be unique');
      if (!deadline.name) throw new Error(`Deadline needs a display name: ${deadline.id}`);
      if (deadline.afterNotice && !['pause', 'continue'].includes(deadline.afterNotice)) throw new Error(`Invalid deadline policy: ${deadline.id}`);
      deadlineIds.add(deadline.id);
    }
    for (const [id, action] of Object.entries(timeConfig.actions)) {
      if (typeof action.consumesSlot !== 'boolean') throw new Error(`Invalid time action: ${id}`);
    }
  }

  function validateContent() {
    for (const [id, s] of Object.entries(data.scenes)) {
      if (!s.spawns || !s.bounds || !s.colliders) throw new Error(`Invalid scene: ${id}`);
      for (const hotspotId of s.hotspotIds) {
        const h = data.hotspots[hotspotId];
        if (!h || h.scene !== id) throw new Error(`Invalid hotspot reference: ${hotspotId}`);
        if (!timeConfig.actions[h.actionId]) throw new Error(`Invalid time action reference: ${hotspotId}`);
        if (h.type === 'exit' && !data.scenes[h.targetScene]?.spawns[h.targetSpawn]) throw new Error(`Invalid exit: ${hotspotId}`);
        if (h.type === 'investigate' && (!data.clues[h.clue] || !data.dialogues[h.dialogue]?.pages.length || (h.closeup && !data.closeups[h.closeup]))) throw new Error(`Invalid investigation: ${hotspotId}`);
        if (h.type === 'facility' && !data.dialogues[h.dialogue]?.pages.length) throw new Error(`Invalid facility: ${hotspotId}`);
        if (h.allowedSlots?.some(slot => !timeConfig.timeSlots.some(entry => entry.id === slot))) throw new Error(`Invalid allowed slot: ${hotspotId}`);
      }
      const validateVariant = variant => {
        for (const hotspotId of variant.hotspots || []) {
          if (data.hotspots[hotspotId]?.scene !== id) throw new Error(`Invalid variant hotspot: ${id}/${hotspotId}`);
        }
        for (const hotspotId of variant.blockedExits || []) {
          const h = data.hotspots[hotspotId];
          if (h?.scene !== id || h.type !== 'exit') throw new Error(`Invalid blocked exit: ${id}/${hotspotId}`);
        }
      };
      for (const slot of timeConfig.timeSlots) validateVariant(s.variants?.[slot.id] || {});
      for (const [date, slots] of Object.entries(s.variants?.dates || {})) {
        parseDate(date);
        for (const variant of Object.values(slots)) validateVariant(variant);
      }
    }
    validateTimeConfig();
    validateMapConfig();
  }

  function setupUI() {
    document.title = ui.title;
    const bindings = {
      title: 'title', eyebrow: 'eyebrow', 'notebook-label': 'notebook', 'notebook-key': 'notebookKey',
      'session-label': 'session', 'notebook-title': 'notebook', 'dialogue-close': 'close',
      'notebook-close': 'close', 'notebook-footnote': 'notebookFootnote', 'footer-label': 'footer', 'footer-hint': 'footerHint'
    };
    Object.entries(bindings).forEach(([id, key]) => { $(id).textContent = ui[key]; });
    canvas.setAttribute('aria-label', ui.canvasLabel);
    $('locations').setAttribute('aria-label', ui.locationsLabel);
    $('dialogue').setAttribute('aria-labelledby', 'dialogue-title');
    $('dialogue').setAttribute('aria-describedby', 'dialogue-text');
    $('notebook').setAttribute('aria-labelledby', 'notebook-title');
    $('action-confirm').setAttribute('aria-labelledby', 'action-confirm-title');
    $('action-confirm').setAttribute('aria-describedby', 'action-confirm-message');
    $('time-notice').setAttribute('aria-labelledby', 'time-notice-title');
    $('time-notice').setAttribute('aria-describedby', 'time-notice-message');
    $('notebook-open').setAttribute('aria-controls', 'notebook');
    $('notebook-open').setAttribute('aria-expanded', 'false');
    for (const [id, s] of Object.entries(data.scenes)) {
      const label = document.createElement('span');
      label.className = 'location';
      label.dataset.scene = id;
      label.textContent = s.name;
      $('locations').append(label);
    }
    for (const item of ui.controls) {
      const control = document.createElement('span');
      control.className = 'control';
      const key = document.createElement('kbd');
      key.textContent = item.key;
      const label = document.createElement('span');
      label.textContent = item.label;
      control.append(key, label);
      $('controls').append(control);
    }
    $('notebook-open').addEventListener('click', toggleNotebook);
    $('notebook-close').addEventListener('click', closeModal);
    $('dialogue-close').addEventListener('click', closeModal);
    $('dialogue-next').addEventListener('click', nextPage);
    $('end-slot').textContent = ui.endSlot;
    $('end-slot').addEventListener('click', requestEndSlot);
    $('action-confirm-title').textContent = ui.actionConfirmTitle;
    $('action-confirm-message').textContent = ui.actionConfirm;
    $('action-cancel').textContent = ui.confirmCancel;
    $('action-accept').textContent = ui.confirmAccept;
    $('action-cancel').addEventListener('click', cancelPendingAction);
    $('action-accept').addEventListener('click', acceptPendingAction);
    $('time-notice-title').textContent = ui.timeNoticeTitle;
    $('time-notice-continue').textContent = ui.noticeContinue;
    $('time-notice-continue').addEventListener('click', acknowledgeTimeNotice);
    $('transition-label').textContent = ui.timeTransition;
    setupMapUI();
    updateSceneUI();
    updateCount();
    updateCalendarUI();
  }

  function updateSceneUI() {
    $('scene-label').textContent = scene().name;
    document.querySelectorAll('.location').forEach(el => {
      el.hidden = data.scenes[el.dataset.scene].regionId !== scene().regionId;
      const current = el.dataset.scene === state.sceneId;
      el.classList.toggle('current', current);
      if (current) el.setAttribute('aria-current', 'location');
      else el.removeAttribute('aria-current');
    });
  }

  function updateCount() {
    const counts = { count: collected.size, total: Object.keys(data.clues).length };
    $('clue-counter').textContent = format('clueCount', counts);
    $('notebook-count').textContent = format('notebookCount', counts);
  }

  function currentSlot() {
    return timeConfig.timeSlots[state.slotIndex];
  }

  function updateCalendarUI() {
    $('date-label').textContent = dateLabel(state.date);
    $('slot-label').textContent = format('slotIndex', {
      current: state.slotIndex + 1,
      total: timeConfig.timeSlots.length,
      name: currentSlot().name.replace(/^\[占位：(.*)\]$/s, '$1')
    });

    const closest = timeConfig.deadlines
      .filter(deadline => !handledDeadlines.has(deadline.id))
      .sort((a, b) => dateOrdinal(parseDate(a.date)) - dateOrdinal(parseDate(b.date)))[0];
    if (!closest) {
      $('deadline-label').textContent = ui.noDeadline;
      return;
    }
    const days = Math.max(0, daysBetween(state.date, parseDate(closest.date)));
    $('deadline-label').textContent = days === 0
      ? format('deadlineToday', { name: closest.name.replace(/^\[占位：(.*)\]$/s, '$1') })
      : format('deadlineCountdown', { name: closest.name.replace(/^\[占位：(.*)\]$/s, '$1'), days });
  }

  function lockedSlotEntries() {
    const key = dateKey(state.date);
    const slotId = currentSlot().id;
    return timeConfig.lockedSlots.filter(lock => lock.date === key && (lock.slots === '*' || lock.slots.includes(slotId)));
  }

  function deadlineEntriesForToday() {
    return timeConfig.deadlines.filter(deadline =>
      !handledDeadlines.has(deadline.id) && !seenDeadlineNotices.has(deadline.id) &&
      dateOrdinal(parseDate(deadline.date)) <= dateOrdinal(state.date));
  }

  function openTimeNotice(kind, message, metadata = {}) {
    state.notice = { kind, ...metadata };
    $('time-notice-message').textContent = message;
    $('time-notice-continue').textContent = kind === 'locked' ? ui.noticeContinue : ui.close;
    openModal('timeNotice');
    $('time-notice-continue').focus({ preventScroll: true });
  }

  function checkCalendarGates() {
    const due = deadlineEntriesForToday();
    if (due.length) {
      due.forEach(deadline => seenDeadlineNotices.add(deadline.id));
      const paused = due.some(deadline => deadline.afterNotice !== 'continue');
      state.deadlineBlocked = paused;
      const messages = due.map(deadline => deadline.message || ui.deadlineBlocked);
      openTimeNotice('deadline', messages.join('\n'), { deadlineIds: due.map(deadline => deadline.id), paused });
      updateCalendarUI();
      return true;
    }
    if (state.deadlineBlocked) return true;

    const locks = lockedSlotEntries();
    const lockKey = `${dateKey(state.date)}:${currentSlot().id}`;
    if (locks.length && !seenLockedSlots.has(lockKey)) {
      seenLockedSlots.add(lockKey);
      const messages = locks.map(lock => lock.message || ui.slotLocked);
      openTimeNotice('locked', messages.join('\n'), { lockKey, allDay: locks.some(lock => lock.slots === '*') });
      return true;
    }
    updateCalendarUI();
    return false;
  }

  function advanceClock() {
    const lastSlot = timeConfig.timeSlots.length - 1;
    if (state.slotIndex === lastSlot) {
      state.slotIndex = 0;
      const next = parseDate(dateKey(state.date));
      const nextDay = new Date(0);
      nextDay.setUTCHours(0, 0, 0, 0);
      nextDay.setUTCFullYear(next.year, next.month - 1, next.day + 1);
      state.date = { year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() };
    } else state.slotIndex++;
  }

  function startTimeTransition() {
    state.mode = 'transition';
    state.transition = { startedAt: performance.now(), duration: timeConfig.transitionMs };
    state.walking = false;
    keys.clear();
    $('time-transition').hidden = false;
    $('transition-label').textContent = format('transitionLabel', {
      date: dateLabel(state.date).replace(/^\[占位：(.*)\]$/s, '$1'),
      slot: currentSlot().name.replace(/^\[占位：(.*)\]$/s, '$1')
    });
    updateCalendarUI();
  }

  function beginTimeAdvance() {
    if (state.mode !== 'explore' || state.deadlineBlocked) return;
    const locks = lockedSlotEntries();
    const lockKey = `${dateKey(state.date)}:${currentSlot().id}`;
    if (locks.length && !seenLockedSlots.has(lockKey)) {
      seenLockedSlots.add(lockKey);
      openTimeNotice('locked', locks.map(lock => lock.message || ui.slotLocked).join('\n'), { lockKey, allDay: locks.some(lock => lock.slots === '*') });
      return;
    }

    advanceClock();
    startTimeTransition();
  }

  function acknowledgeTimeNotice() {
    const notice = state.notice;
    if (!notice) return;
    state.notice = null;
    $('time-notice').hidden = true;
    $('modal-layer').hidden = true;
    if (notice.kind === 'locked') {
      state.mode = 'explore';
      if (notice.allDay) {
        state.slotIndex = 0;
        const date = parseDate(dateKey(state.date));
        const nextDay = new Date(0);
        nextDay.setUTCHours(0, 0, 0, 0);
        nextDay.setUTCFullYear(date.year, date.month - 1, date.day + 1);
        state.date = { year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate() };
        startTimeTransition();
        return;
      }
      beginTimeAdvance();
      return;
    }
    if (notice.kind === 'deadline') {
      notice.deadlineIds.forEach(id => {
        const deadline = timeConfig.deadlines.find(item => item.id === id);
        if (deadline?.afterNotice === 'continue') handledDeadlines.add(id);
      });
      state.deadlineBlocked = notice.paused;
      state.mode = 'explore';
      updateCalendarUI();
      if (!state.deadlineBlocked) { checkCalendarGates(); resumeWorldMap(); }
      else focusCanvas();
      return;
    }
    if (notice.kind === 'deadlineBlocked') {
      state.mode = 'explore';
      focusCanvas();
    }
  }

  function focusCanvas() {
    canvas.focus({ preventScroll: true });
    updatePrompt();
    resumeWorldMap();
  }

  // Rebuild the active background on scene/time changes; dynamic elements remain live.
  const backgrounds = new Map();
  function drawArchitecture(g, s) {
    const p = s.palette;
    rect(g, 0, 0, settings.width, settings.height, p.trim);
    rect(g, 6, 5, 308, 45, p.wall);
    rect(g, 8, 6, 304, 3, p.wallLight);
    rect(g, 9, 43, 302, 6, p.wallShade);
    rect(g, 9, 47, 302, 3, p.trim);
    rect(g, 9, 50, 302, 125, p.floor);
    const tiled = s.theme !== 'classroom';
    for (let y = 50; y < 175; y += tiled ? 16 : 9) {
      for (let x = 10; x < 310; x += tiled ? 24 : 48) {
        const cell = ((x / (tiled ? 24 : 48)) | 0) + ((y / (tiled ? 16 : 9)) | 0);
        if (cell % 2) rect(g, x, y, Math.min(tiled ? 23 : 47, 310 - x), tiled ? 15 : 8, p.floorAlt);
        rect(g, x, y, Math.min(tiled ? 24 : 48, 310 - x), 1, p.seam);
        rect(g, x, y, 1, tiled ? 16 : 9, p.seam);
        if (!tiled) rect(g, x + 9, y + 4, 13, 1, p.seam + '55');
      }
    }
    rect(g, 6, 49, 5, 126, p.wallShade);
    rect(g, 309, 49, 5, 126, p.wallShade);
    rect(g, 9, 174, 302, 3, p.trim);
    rect(g, 13, 51, 294, 2, p.shadow);
    // Discrete floor pixels keep the image crisp without random flicker.
    for (let n = 0; n < 55; n++) {
      const x = 15 + (n * 47 % 285), y = 56 + (n * 31 % 114);
      rect(g, x, y, n % 3 === 0 ? 2 : 1, 1, p.seam + '66');
    }
    for (const o of s.objects.filter(o => ['window', 'blackboard', 'clock', 'board', 'door', 'floorPaper', 'crack'].includes(o.kind))) drawObject(g, o, p);
    // Warm rectangular sunlight is a low-opacity part of the static background.
    if (s.theme !== 'oldSchool') {
      g.save();
      g.globalAlpha = 0.09;
      g.fillStyle = p.light;
      for (const x of [30, 230]) {
        g.beginPath(); g.moveTo(x, 52); g.lineTo(x + 43, 52); g.lineTo(x + 68, 123); g.lineTo(x + 22, 123); g.closePath(); g.fill();
      }
      g.restore();
    }
  }

  function drawObject(g, o, p) {
    const { x, y, width: w, height: h } = o;
    switch (o.kind) {
      case 'window': {
        rect(g, x - 2, y - 2, w + 4, h + 5, p.trim);
        rect(g, x, y, w, h, p.sky);
        rect(g, x + 2, y + 2, w - 4, 9, p.skyLight);
        // Silhouettes beyond the glass are built from stepped pixel clusters.
        for (let i = 0; i < w - 4; i += 9) {
          const top = y + 15 + ((i * 7) % 8);
          rect(g, x + 2 + i, top, Math.min(9, w - i - 4), y + h - top, p.leaf);
          rect(g, x + 4 + i, top - 3, Math.min(5, w - i - 4), 4, p.leaf);
        }
        rect(g, x + 2, y + h - 6, w - 4, 4, p.glass);
        rect(g, x + Math.floor(w / 2) - 1, y, 3, h, p.wallLight);
        rect(g, x, y + 12, w, 2, p.wallLight);
        rect(g, x, y, w, 2, p.wallLight);
        rect(g, x - 3, y + h, w + 6, 3, p.wallLight);
        rect(g, x + 4, y + 3, 2, 7, p.paper + '77');
        break;
      }
      case 'blackboard':
        rect(g, x, y, w, h, p.woodDark);
        rect(g, x + 2, y + 2, w - 4, h - 4, '#50695c');
        rect(g, x + 4, y + 4, w - 8, 1, '#718475');
        // Empty chalkboard: marks here are decorative, never story text.
        rect(g, x + 5, y + h - 2, w - 10, 2, p.woodLight);
        rect(g, x + w - 18, y + h - 4, 7, 2, p.paper);
        break;
      case 'clock':
        rect(g, x + 2, y, w - 4, h, p.trim); rect(g, x, y + 2, w, h - 4, p.trim);
        rect(g, x + 2, y + 2, w - 4, h - 4, p.paper);
        rect(g, x + 5, y + 3, 1, 4, p.ink); rect(g, x + 5, y + 6, 4, 1, p.ink);
        break;
      case 'board':
        rect(g, x, y, w, h, p.woodDark); rect(g, x + 2, y + 2, w - 4, h - 4, p.wood);
        for (let i = 0; i < 3; i++) {
          const px = x + 5 + i * Math.floor((w - 9) / 3);
          rect(g, px + 1, y + 7 + i % 2, 9, h - 12, p.shadow);
          rect(g, px, y + 5 + i % 2, 9, h - 12, p.paper);
          rect(g, px + 3, y + 5 + i % 2, 2, 2, p.metal);
          rect(g, px + 2, y + 12, 5, 1, p.wallShade);
        }
        break;
      case 'door': {
        rect(g, x - 1, y - 2, w + 2, h + 4, p.trim);
        rect(g, x + 1, y, w - 2, h, p.woodDark);
        rect(g, x + 2, y + 2, w - 4, h - 4, '#3c514f');
        rect(g, x, y + h - 4, w, 4, p.metalLight);
        rect(g, x + 2, y + 4, 2, h - 9, p.metal);
        const ax = o.side === 'right' ? x - 8 : x + w + 4;
        const ay = y + h / 2;
        rect(g, ax, ay, 5, 1, p.paper);
        rect(g, ax + (o.side === 'right' ? 3 : 0), ay - 1, 1, 3, p.paper);
        rect(g, ax + (o.side === 'right' ? 2 : 1), ay - 2, 1, 5, p.paper);
        if (o.stairs) for (let i = 0; i < 3; i++) rect(g, x + 2, y + h - 11 + i * 3, w - 4, 1, p.metalLight);
        break;
      }
      case 'desk':
        rect(g, x + 2, y + 7, w + 2, h - 5, p.shadow);
        rect(g, x + 3, y + 8, 2, 11, p.metalDark); rect(g, x + w - 5, y + 8, 2, 11, p.metalDark);
        rect(g, x, y, w, 13, p.woodDark); rect(g, x + 1, y, w - 2, 10, p.woodLight);
        rect(g, x + 2, y + 1, w - 4, 1, p.paper + '88'); rect(g, x + 1, y + 10, w - 2, 2, p.wood);
        rect(g, x + 6, y + 3, 9, 5, p.paper); rect(g, x + 7, y + 4, 7, 1, p.wallShade);
        rect(g, x + 19, y + 3, 1, 5, p.ink);
        rect(g, x + 10, y + 20, 11, 6, p.woodDark); rect(g, x + 10, y + 19, 11, 4, p.wood);
        rect(g, x + 11, y + 25, 2, 2, p.metalDark); rect(g, x + 18, y + 25, 2, 2, p.metalDark);
        break;
      case 'teacherDesk':
        rect(g, x + 2, y + 10, w + 3, h - 8, p.shadow);
        rect(g, x + 2, y + 8, w - 4, h - 8, p.woodDark); rect(g, x + 4, y + 10, w - 8, 7, p.wood);
        rect(g, x, y, w, 10, p.woodDark); rect(g, x + 1, y, w - 2, 7, p.woodLight);
        rect(g, x + 7, y + 2, 12, 6, p.paper); rect(g, x + 8, y + 3, 9, 1, p.wallShade);
        rect(g, x + 29, y + 1, 10, 6, p.ink); rect(g, x + 30, y + 1, 8, 1, p.metalLight);
        rect(g, x + 23, y + 12, 3, 1, p.woodDark);
        break;
      case 'cabinet':
        rect(g, x + 2, y + 8, w + 2, h - 6, p.shadow);
        rect(g, x, y, w, h, p.metalDark); rect(g, x + 1, y + 1, w - 2, 5, p.metalLight);
        rect(g, x + 1, y + 6, w - 2, h - 8, p.metal);
        for (let i = 1; i < 3; i++) rect(g, x + Math.floor(i * w / 3), y + 7, 1, h - 10, p.metalDark);
        for (let i = 0; i < 3; i++) {
          const cx = x + 3 + Math.floor(i * w / 3);
          rect(g, cx, y + 10, 5, 1, p.metalDark); rect(g, cx, y + 12, 5, 1, p.metalDark);
          rect(g, cx + 4, y + 18, 1, 3, p.paper);
        }
        if (o.sealed) { rect(g, x + 2, y + 22, w - 4, 3, p.accent); rect(g, x + 10, y + 20, 3, 6, p.woodDark); }
        break;
      case 'bench':
        rect(g, x + 1, y + 8, w + 3, h - 6, p.shadow);
        rect(g, x + 3, y + 9, 3, 7, p.metalDark); rect(g, x + w - 6, y + 9, 3, 7, p.metalDark);
        rect(g, x, y, w, 7, p.woodDark); rect(g, x + 1, y + 1, w - 2, 3, p.woodLight);
        rect(g, x - 1, y + 7, w + 2, 4, p.wood); rect(g, x - 1, y + 7, w + 2, 1, p.woodLight);
        break;
      case 'plant':
        rect(g, x + 1, y + h - 4, w + 2, 4, p.shadow);
        rect(g, x + 3, y + h - 8, w - 6, 8, p.wood); rect(g, x + 2, y + h - 9, w - 4, 3, p.woodLight);
        rect(g, x + 6, y + 4, 1, 10, p.leaf);
        rect(g, x + 1, y + 4, 5, 4, p.leaf); rect(g, x + 7, y, 5, 6, p.leaf);
        rect(g, x, y + 10, 6, 3, p.leaf); rect(g, x + 7, y + 7, 6, 4, p.trim);
        rect(g, x + 2, y + 4, 3, 1, p.metalLight);
        break;
      case 'stairs':
        rect(g, x, y, w, h, p.metalDark);
        for (let i = 0; i < 9; i++) {
          rect(g, x + 7, y + 4 + i * 7, w - 14, 5, i % 2 ? p.wallShade : p.floor);
          rect(g, x + 7, y + 9 + i * 7, w - 14, 2, p.trim);
          rect(g, x + 7, y + 4 + i * 7, w - 14, 1, p.metalLight);
        }
        rect(g, x, y + 2, 4, h - 2, p.wallLight); rect(g, x + w - 4, y + 2, 4, h - 2, p.wallLight);
        rect(g, x - 2, y + 9, 2, h - 9, p.trim); rect(g, x + w, y + 9, 2, h - 9, p.trim);
        for (let i = 0; i < 4; i++) { rect(g, x - 2, y + 9 + i * 16, 6, 2, p.metalLight); rect(g, x + w - 4, y + 9 + i * 16, 6, 2, p.metalLight); }
        break;
      case 'floorPaper':
        rect(g, x + 1, y + 1, w, h, p.shadow); rect(g, x, y, w, h, p.paper); rect(g, x + 1, y + 2, w - 3, 1, p.wallShade);
        break;
      case 'crack':
        for (let i = 0; i < 6; i++) rect(g, x + i * 3, y + (i % 3) * 2, 4, 1, p.trim);
        rect(g, x + 8, y + 4, 1, 6, p.seam);
        break;
    }
  }

  function drawPlayer(g) {
    const p = settings.player.colors;
    const x = Math.round(state.player.x) - 6, y = Math.round(state.player.y) - 21;
    const step = state.walking ? Math.floor(state.walkTime / 0.14) % 4 : 0;
    const sway = state.walking && (step === 1 || step === 3) ? -1 : 0;
    rect(g, x, y + 20, 13, 3, '#344c4844');
    rect(g, x + 2, y + 18, 4, 3 + (step === 1 ? -1 : 0), p.shoe);
    rect(g, x + 7, y + 18, 4, 3 + (step === 3 ? -1 : 0), p.shoe);
    g.save(); g.translate(0, sway);
    rect(g, x + 2, y + 13, 9, 6, p.outline);
    rect(g, x + 3, y + 14, 7, 4, p.skirt);
    rect(g, x + 2, y + 9, 9, 6, p.jacket);
    rect(g, x + 1, y + 10, 2, 5, p.shirt); rect(g, x + 10, y + 10, 2, 5, p.shirt);
    rect(g, x + 1, y + 15, 2, 2, p.skin); rect(g, x + 10, y + 15, 2, 2, p.skin);
    rect(g, x + 2, y + 1, 9, 9, p.outline); rect(g, x + 1, y + 3, 11, 5, p.outline);
    rect(g, x + 3, y + 3, 7, 7, p.skin);
    rect(g, x + 2, y + 1, 9, 4, p.hair); rect(g, x + 3, y, 7, 1, p.hair);
    rect(g, x + 3, y + 1, 5, 1, p.hairLight);
    if (state.player.facing === 'up') {
      rect(g, x + 2, y + 3, 9, 6, p.hair); rect(g, x + 3, y + 9, 7, 1, p.shirt);
      rect(g, x + 3, y + 11, 7, 5, p.bag); rect(g, x + 5, y + 11, 3, 1, p.woodDark || p.outline);
    } else if (state.player.facing === 'left' || state.player.facing === 'right') {
      const left = state.player.facing === 'left';
      rect(g, x + (left ? 6 : 2), y + 3, 5, 6, p.hair);
      rect(g, x + (left ? 3 : 9), y + 6, 1, 2, p.outline);
      rect(g, x + (left ? 9 : 1), y + 11, 3, 5, p.bag);
      rect(g, x + (left ? 3 : 7), y + 10, 3, 2, p.shirt);
    } else {
      rect(g, x + 2, y + 4, 2, 3, p.hair); rect(g, x + 9, y + 4, 2, 3, p.hair);
      rect(g, x + 4, y + 6, 1, 2, p.outline); rect(g, x + 8, y + 6, 1, 2, p.outline);
      rect(g, x + 4, y + 10, 5, 2, p.shirt); rect(g, x + 6, y + 11, 1, 3, p.outline);
      rect(g, x + 10, y + 12, 2, 4, p.bag);
    }
    g.restore();
  }

  function drawMarkers(time) {
    for (const h of hotspots().filter(h => h.type !== 'exit' && hotspotAvailability(h).allowed)) {
      const x = Math.round(h.rect.x + h.rect.width / 2), y = h.rect.y - 7 + Math.round(Math.sin(time / 340) * 1);
      const near = isNearby(h);
      const color = (h.clue ? collected.has(h.clue) : usedHotspots.has(h.id)) ? '#a9bc9a' : '#ead6a0';
      rect(ctx, x - 4, y - 1, 9, 3, '#253b3c'); rect(ctx, x - 1, y - 4, 3, 9, '#253b3c');
      rect(ctx, x - 2, y - 1, 5, 3, color); rect(ctx, x - 1, y - 2, 3, 5, color);
      rect(ctx, x, y, 1, 1, near ? '#fff3c9' : '#657a65');
      if (near) {
        rect(ctx, x - 6, y - 1, 1, 3, color); rect(ctx, x + 6, y - 1, 1, 3, color);
      }
    }
  }

  function drawLighting() {
    const l = scene().lighting;
    if (scene().ambientColor) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      rect(ctx, 0, 0, settings.width, settings.height, scene().ambientColor);
      ctx.restore();
    }
    light.clearRect(0, 0, settings.width, settings.height);
    light.globalCompositeOperation = 'source-over';
    light.globalAlpha = l.darkness;
    rect(light, 0, 0, settings.width, settings.height, l.ambient);
    light.globalAlpha = 1;
    light.globalCompositeOperation = 'destination-out';
    const gradient = light.createRadialGradient(state.player.x, state.player.y - 9, l.innerRadius, state.player.x, state.player.y - 9, l.radius);
    gradient.addColorStop(0, '#000000');
    gradient.addColorStop(0.42, '#000000bc');
    gradient.addColorStop(1, '#00000000');
    light.fillStyle = gradient;
    light.fillRect(0, 0, settings.width, settings.height);
    light.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
  }

  function render(time) {
    ctx.drawImage(backgrounds.get(state.sceneId), 0, 0);
    const items = scene().objects.filter(o => !['window', 'blackboard', 'clock', 'board', 'door', 'floorPaper', 'crack'].includes(o.kind)).map(o => ({ depth: o.y + o.height, object: o }));
    items.push({ depth: state.player.y, player: true });
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) {
      if (item.player) drawPlayer(ctx);
      else drawObject(ctx, item.object, scene().palette);
    }
    drawLighting();
    drawMarkers(time);
  }

  function canStand(x, y) {
    const f = feet(x, y), b = scene().bounds;
    return f.x >= b.x && f.y >= b.y && f.x + f.width <= b.x + b.width && f.y + f.height <= b.y + b.height && !scene().colliders.some(c => overlaps(f, c));
  }

  function move(dx, dy) {
    // Substeps prevent thin obstacles being skipped during slow frames.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
    for (let i = 0; i < steps; i++) {
      if (canStand(state.player.x + dx / steps, state.player.y)) state.player.x += dx / steps;
      if (canStand(state.player.x, state.player.y + dy / steps)) state.player.y += dy / steps;
    }
  }

  function transition(hotspot) {
    state.sceneId = hotspot.targetScene;
    applyTimeVariant(state.sceneId, state.date, currentSlot());
    state.player = { ...scene().spawns[hotspot.targetSpawn] };
    visitedScenes.add(state.sceneId);
    state.exitLocked = true;
    state.activeHotspot = null;
    state.walking = false;
    $('toast').hidden = true;
    updateSceneUI();
    drawMiniMap();
  }

  function actionIsBlocked() {
    if (state.deadlineBlocked) {
      const due = timeConfig.deadlines.filter(deadline => !handledDeadlines.has(deadline.id) && dateOrdinal(parseDate(deadline.date)) <= dateOrdinal(state.date));
      openTimeNotice('deadlineBlocked', due.map(deadline => deadline.message || ui.deadlineBlocked).join('\n') || ui.deadlineBlocked, { deadlineIds: due.map(deadline => deadline.id), paused: true });
      return true;
    }
    const locks = lockedSlotEntries();
    const lockKey = `${dateKey(state.date)}:${currentSlot().id}`;
    if (locks.length) {
      seenLockedSlots.add(lockKey);
      openTimeNotice('locked', locks.map(lock => lock.message || ui.slotLocked).join('\n'), { lockKey, allDay: locks.some(lock => lock.slots === '*') });
      return true;
    }
    return false;
  }

  function requestEndSlot() {
    if (state.mode === 'worldMap') suspendWorldMap();
    if (state.mode !== 'explore' || actionIsBlocked()) return;
    state.pendingAction = { kind: 'endSlot' };
    $('action-confirm-message').textContent = ui.endSlotConfirm;
    openModal('actionConfirm');
    $('action-accept').focus({ preventScroll: true });
  }

  function requestHotspotAction(hotspot) {
    if (state.mode !== 'explore') return;
    if (hotspot.scene !== state.sceneId || !isNearby(hotspot) || rejectUnavailableHotspot(hotspot)) return;
    const action = timeConfig.actions[hotspot.actionId];
    const used = hotspot.type === 'investigate' ? hotspotAvailability(hotspot).collectedClue : usedHotspots.has(hotspot.id);
    const consumesSlot = action.consumesSlot && (!used || action.repeatConsumesSlot !== false);
    if (consumesSlot && actionIsBlocked()) return;
    if (!consumesSlot) {
      executeHotspotAction(hotspot, false);
      return;
    }
    state.pendingAction = { kind: 'hotspot', hotspotId: hotspot.id, consumesSlot: true };
    $('action-confirm-message').textContent = ui.actionConfirm;
    openModal('actionConfirm');
    $('action-accept').focus({ preventScroll: true });
  }

  function cancelPendingAction() {
    if (state.mode !== 'actionConfirm') return;
    state.pendingAction = null;
    state.mode = 'explore';
    $('action-confirm').hidden = true;
    $('modal-layer').hidden = true;
    focusCanvas();
  }

  function acceptPendingAction() {
    if (state.mode !== 'actionConfirm' || !state.pendingAction) return;
    const pending = state.pendingAction;
    state.pendingAction = null;
    state.mode = 'explore';
    $('action-confirm').hidden = true;
    $('modal-layer').hidden = true;
    if (pending.kind === 'endSlot') {
      beginTimeAdvance();
      return;
    }
    if (pending.kind === 'travel') {
      const edge = data.travel.edges.find(item => item.id === pending.edgeId);
      if (!edge || travelStatus(edge.to).reason || edge.from !== state.sceneId || !edgeOpen(edge)) {
        resumeWorldMap(); $('map-status').textContent = ui.mapLocked; return;
      }
      if (!actionIsBlocked()) performMapTravel(edge);
      return;
    }
    const hotspot = data.hotspots[pending.hotspotId];
    if (!hotspot || hotspot.scene !== state.sceneId || (hotspot.type !== 'exit' && !isNearby(hotspot))) {
      focusCanvas();
      return;
    }
    if (rejectUnavailableHotspot({ id: pending.hotspotId, ...hotspot })) { focusCanvas(); return; }
    executeHotspotAction({ id: pending.hotspotId, ...hotspot }, pending.consumesSlot);
  }

  function executeHotspotAction(hotspot, consumesSlot) {
    const alreadyUsed = hotspot.type === 'investigate' && collected.has(hotspot.clue);
    usedHotspots.add(hotspot.id);
    if (hotspot.type === 'exit') {
      transition(hotspot);
      if (consumesSlot) beginTimeAdvance();
      else focusCanvas();
      return;
    }
    if (hotspot.type === 'investigate') {
      collected.add(hotspot.clue);
      updateCount();
    }
    openDialogue(hotspot, consumesSlot, hotspot.type === 'facility', alreadyUsed);
  }

  function updatePrompt() {
    const nearby = hotspots(true).filter(isNearby).sort((a, b) => {
      // Investigation takes precedence over an exit at the same distance.
      const delta = distance(state.player, a.rect) - distance(state.player, b.rect);
      return delta || (a.type === 'investigate' ? -1 : 1);
    });
    state.activeHotspot = nearby[0] || null;
    const h = state.activeHotspot;
    $('interaction-prompt').hidden = !h || state.mode !== 'explore';
    if (h) {
      const availability = hotspotAvailability(h);
      $('interaction-label').textContent = !availability.allowed
        ? (h.type === 'exit' ? ui.exitBlocked : ui.hotspotUnavailable)
        : format(h.type === 'exit' ? 'exit' : availability.freeReview ? 'hotspotReview' : 'investigate', { name: h.name });
    }
    canvas.style.cursor = h && h.type !== 'exit' && state.mode === 'explore' ? 'pointer' : 'default';
  }

  function update(dt, time) {
    if (state.mode !== 'explore') { state.walking = false; return; }
    let dx = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
    let dy = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
    state.walking = dx !== 0 || dy !== 0;
    if (state.walking) {
      state.player.facing = dx ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      const length = Math.hypot(dx, dy);
      dx = dx / length * settings.player.speed * dt;
      dy = dy / length * settings.player.speed * dt;
      move(dx, dy);
      state.walkTime += dt;
    } else state.walkTime = 0;
    const touchingExit = hotspots(true).find(h => h.type === 'exit' && overlaps(feet(), h.rect));
    if (!touchingExit) state.exitLocked = false;
    else if (!state.exitLocked) {
      state.exitLocked = true;
      requestHotspotAction(touchingExit);
    }
    updatePrompt();
    if (time > state.toastUntil) $('toast').hidden = true;
  }

  function openModal(mode) {
    if (state.mode === 'explore') previousFocus = document.activeElement;
    state.mode = mode;
    keys.clear();
    state.walking = false;
    $('modal-layer').hidden = false;
    $('dialogue').hidden = mode !== 'dialogue';
    $('notebook').hidden = mode !== 'notebook';
    $('action-confirm').hidden = mode !== 'actionConfirm';
    $('time-notice').hidden = mode !== 'timeNotice';
    $('interaction-prompt').hidden = true;
    $('notebook-open').setAttribute('aria-expanded', String(mode === 'notebook'));
    $('notebook-open').disabled = mode === 'dialogue';
    drawMiniMap();
  }

  function closeModal() {
    if (state.mode === 'explore') return;
    if (state.mode === 'actionConfirm') { cancelPendingAction(); return; }
    if (state.mode === 'timeNotice') {
      if (state.notice?.kind === 'locked') { acknowledgeTimeNotice(); return; }
      acknowledgeTimeNotice();
      return;
    }
    const consumeAfterClose = state.mode === 'dialogue' && state.dialogueConsumesSlot;
    state.dialogueConsumesSlot = false;
    state.mode = 'explore';
    keys.clear();
    $('modal-layer').hidden = true;
    $('dialogue').hidden = true;
    $('notebook').hidden = true;
    $('notebook-open').disabled = false;
    $('notebook-open').setAttribute('aria-expanded', 'false');
    updatePrompt();
    const target = previousFocus instanceof HTMLElement && previousFocus !== document.body ? previousFocus : canvas;
    target.focus({ preventScroll: true });
    if (consumeAfterClose) beginTimeAdvance();
  }

  function openDialogue(hotspot, consumesSlot, isFacility, alreadyUsed) {
    state.dialogue = data.dialogues[hotspot.dialogue];
    state.page = 0;
    state.dialogueConsumesSlot = consumesSlot;
    $('dialogue-title').textContent = state.dialogue.title;
    $('record-label').textContent = isFacility ? ui.facilityUsed : alreadyUsed ? ui.alreadyRecorded : ui.recorded;
    $('closeup').hidden = !hotspot.closeup;
    if (hotspot.closeup) {
      const closeup = data.closeups[hotspot.closeup];
      $('closeup-title').textContent = closeup.title;
      $('closeup-canvas').setAttribute('aria-label', closeup.title);
      drawCloseup(closeup);
    }
    openModal('dialogue');
    updateDialoguePage();
    $('dialogue-next').focus({ preventScroll: true });
  }

  function updateDialoguePage() {
    $('dialogue-text').textContent = state.dialogue.pages[state.page];
    $('dialogue-page').textContent = format('page', { current: state.page + 1, total: state.dialogue.pages.length });
    $('dialogue-next').textContent = state.page === state.dialogue.pages.length - 1 ? ui.done : ui.next;
  }

  function nextPage() {
    if (state.mode !== 'dialogue') return;
    if (state.page + 1 < state.dialogue.pages.length) { state.page++; updateDialoguePage(); }
    else closeModal();
  }

  function toggleNotebook() {
    if (!['explore', 'notebook'].includes(state.mode)) return;
    if (state.mode === 'notebook') { closeModal(); return; }
    const list = $('notebook-pages');
    list.replaceChildren();
    if (!collected.size) {
      const empty = document.createElement('p');
      empty.className = 'empty-notebook'; empty.textContent = ui.notebookEmpty; list.append(empty);
    }
    for (const id of collected) {
      const clue = data.clues[id];
      const entry = document.createElement('article'); entry.className = 'clue-entry';
      const icon = document.createElement('span'); icon.className = 'entry-mark'; icon.setAttribute('aria-hidden', 'true');
      const body = document.createElement('div');
      const title = document.createElement('h3'); title.textContent = clue.title;
      const description = document.createElement('p'); description.textContent = clue.description;
      body.append(title, description); entry.append(icon, body); list.append(entry);
    }
    openModal('notebook');
    list.scrollTop = 0;
    $('notebook-close').focus({ preventScroll: true });
  }

  function drawCloseup(card) {
    const g = $('closeup-canvas').getContext('2d'), p = card.palette;
    g.imageSmoothingEnabled = false;
    rect(g, 0, 0, 112, 72, p.background);
    rect(g, 3, 3, 106, 1, p.border); rect(g, 3, 68, 106, 1, p.border);
    rect(g, 3, 3, 1, 66, p.border); rect(g, 108, 3, 1, 66, p.border);
    for (let i = 0; i < 50; i++) rect(g, 7 + i * 29 % 98, 7 + i * 17 % 57, 1, 1, p.border + '55');
    if (card.pattern === 'cabinet') {
      rect(g, 31, 11, 54, 52, p.shadow); rect(g, 28, 8, 54, 52, p.object);
      rect(g, 31, 11, 21, 46, p.background); rect(g, 55, 11, 24, 46, p.background);
      for (let y = 16; y < 27; y += 3) { rect(g, 35, y, 12, 1, p.border); rect(g, 60, y, 12, 1, p.border); }
      rect(g, 47, 33, 2, 7, p.detail); rect(g, 58, 33, 2, 7, p.detail);
      rect(g, 30, 45, 50, 5, p.accent); rect(g, 51, 43, 5, 9, p.shadow);
    } else {
      rect(g, 33, 14, 49, 47, p.shadow); rect(g, 30, 11, 49, 47, p.object);
      rect(g, 32, 13, 45, 1, p.detail); rect(g, 35, 20, 26, 2, p.detail);
      for (let y = 29; y < 48; y += 5) rect(g, 35, y, 30 + y % 7, 1, p.detail);
      rect(g, 66, 47, 8, 7, p.accent); rect(g, 48, 9, 11, 5, p.accent);
    }
    for (const [x, y] of [[12, 12], [96, 12], [12, 57], [96, 57]]) {
      rect(g, x, y, 5, 1, p.detail); rect(g, x, y, 1, 5, p.detail);
    }
  }

  const movementKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (state.mode === 'transition') { event.preventDefault(); return; }
    if (event.code === data.world.keys.open) {
      event.preventDefault(); if (!event.repeat) toggleWorldMap(); return;
    }
    if (state.mode === 'worldMap') {
      if (event.code === 'Escape') { event.preventDefault(); worldMapBack(); return; }
      if (event.code === timeConfig.endSlotKey) { event.preventDefault(); if (!event.repeat) requestEndSlot(); return; }
      if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
        const delta = ['ArrowUp', 'ArrowLeft'].includes(event.code) ? -1 : 1;
        mapState.selected = (mapState.selected + delta + mapState.nodes.length) % mapState.nodes.length;
        drawWorldMap(); return;
      }
      if (event.code === 'Enter' && document.activeElement === $('world-canvas')) {
        event.preventDefault(); if (!event.repeat) activateMapNode(mapState.nodes[mapState.selected]); return;
      }
      if (movementKeys.has(event.code) || event.code === 'KeyE') { event.preventDefault(); return; }
      if (event.code === 'Tab') {
        const buttons = [$('world-back'), $('world-close'), $('world-canvas'), $('map-end-slot')].filter(el => !el.hidden);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.code === data.world.keys.miniMap && state.mode === 'explore') {
      event.preventDefault(); if (!event.repeat) { mapState.miniVisible = !mapState.miniVisible; drawMiniMap(); } return;
    }
    if (movementKeys.has(event.code)) {
      event.preventDefault();
      if (state.mode === 'explore') keys.add(event.code);
      return;
    }
    if (event.code === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (event.code === 'KeyN') {
      event.preventDefault();
      if (!event.repeat && (state.mode === 'explore' || state.mode === 'notebook')) toggleNotebook();
      return;
    }
    if (event.code === timeConfig.endSlotKey) { event.preventDefault(); if (!event.repeat) requestEndSlot(); return; }
    if (event.code === 'Space' || event.code === 'KeyE') {
      // Preserve native Space activation for focused buttons; it fires once on keyup.
      if (event.code === 'Space' && document.activeElement instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (event.repeat) return;
      if (state.mode === 'dialogue') nextPage();
      else if (state.mode === 'explore') {
        const candidate = hotspots(true).filter(h => h.type !== 'exit' && isNearby(h)).sort((a, b) => distance(state.player, a.rect) - distance(state.player, b.rect))[0];
        if (candidate) requestHotspotAction(candidate);
      }
    }
    if (event.code === 'Tab' && state.mode !== 'explore') {
      const modal = ({ dialogue: $('dialogue'), notebook: $('notebook'), actionConfirm: $('action-confirm'), timeNotice: $('time-notice') })[state.mode];
      if (!modal) return;
      const buttons = [...modal.querySelectorAll('button:not([disabled])')];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); state.walking = false; state.exitLocked = true; });
  document.addEventListener('visibilitychange', () => { keys.clear(); state.lastTime = null; state.exitLocked = true; });
  canvas.addEventListener('click', event => {
    if (state.mode !== 'explore') return;
    canvas.focus({ preventScroll: true });
    const bounds = canvas.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) * settings.width / bounds.width, y: (event.clientY - bounds.top) * settings.height / bounds.height };
    const candidate = hotspots(true).find(h => h.type !== 'exit' && isNearby(h) && distance(point, h.rect) <= 9);
    if (candidate) requestHotspotAction(candidate);
  });

  function resize() {
    // Fit integer scales only; below 1x the document scrolls instead of blurring pixels.
    const widthScale = Math.floor((window.innerWidth - 46) / settings.width);
    const heightScale = Math.floor((window.innerHeight - 246) / settings.height);
    const scale = Math.max(1, Math.min(widthScale, heightScale));
    miniDisplayScale = Math.min(scale, 2);
    $('stage').style.width = `${settings.width * scale}px`;
    $('stage').style.height = `${settings.height * scale}px`;
    drawMiniMap();
  }

  function frame(time) {
    const dt = state.lastTime === null ? 0 : Math.min((time - state.lastTime) / 1000, 0.05);
    state.lastTime = time;
    update(dt, time);
    render(time);
    drawMiniMap();
    drawWorldMap();
    if (state.transition) {
      const progress = Math.min(1, (time - state.transition.startedAt) / state.transition.duration);
      const opacity = progress < 0.46 ? progress / 0.46 : (1 - progress) / 0.54;
      $('time-transition').style.opacity = String(Math.max(0, opacity) * 0.9);
      if (progress >= 1) {
        state.transition = null;
        state.mode = 'explore';
        $('time-transition').hidden = true;
        $('time-transition').style.opacity = '0';
        onTimeChanged(state.date, currentSlot());
        checkCalendarGates();
        resumeWorldMap();
      }
    }
    if (time > state.toastUntil) $('toast').hidden = true;
    requestAnimationFrame(frame);
  }

  validateContent();
  setupUI();
  onTimeChanged(state.date, currentSlot());
  window.addEventListener('resize', resize);
  resize();
  updatePrompt();
  checkCalendarGates();
  requestAnimationFrame(frame);
})();
