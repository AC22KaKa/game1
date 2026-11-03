/*
 * CONTENT GUIDE
 * All player-facing strings live here. Replace placeholder strings to add your writing.
 * IDs are stable references, not display text. Rectangles use 320 x 180 world pixels.
 * Player positions describe the centre of the character's feet.
 * Add a clue + dialogue, then reference their IDs from an investigate hotspot.
 * Exit targetSpawn must name a collision-free spawn in targetScene.
 * objects describe appearance; colliders independently describe impassable footprints.
 * timeSystem dates use YYYY-MM-DD; lockedSlots slots may use '*' to lock the whole day.
 * Each hotspot actionId points to timeSystem.actions; deadline afterNotice accepts pause or continue.
 * Scene variants are keyed by slot ID. Optional variants.dates['YYYY-MM-DD'][slotId]
 * overrides that slot on one date. Lighting/palette merge; hotspots/blockedExits replace.
 * Omitted fields fall back to the default scene (date fields fall back to slot fields).
 * Hotspot allowedSlots restricts both first investigation and free collected-clue replays.
 * world.regions lists scenes; each scene.regionId must match. initialVisitedScenes is a test seed.
 * miniMap walls use grid cells; exit/hotspot markers reference real hotspot IDs.
 * playerSpawn maps worldX/worldY to mapX/mapY; worldWidth/worldHeight set the full extent.
 * travel.edges are directed. Each edge has an explicit safe targetSpawn; no pathfinding is used.
 * lockedSlots accepts slot IDs; optional dated locks use { date, slots: [...] | '*' }.
 */
window.GAME_CONTENT = (() => {
  const warm = {
    wall: '#c1bc9d', wallLight: '#d3ceb1', wallShade: '#a5a98b', trim: '#737e69',
    floor: '#b2a387', floorAlt: '#b9aa8c', seam: '#9c937c', shadow: '#686c5940',
    wood: '#a58a63', woodLight: '#c5a778', woodDark: '#766a50',
    metal: '#798675', metalLight: '#a3ad91', metalDark: '#596759',
    sky: '#aabfb0', skyLight: '#c8d4bd', leaf: '#788f71', glass: '#a6beb0',
    paper: '#e0d7b7', accent: '#bfad7e', ink: '#4c6154', light: '#ede2b2'
  };
  const cool = {
    wall: '#818f92', wallLight: '#9ca7a3', wallShade: '#6f8085', trim: '#4e666c',
    floor: '#7b8989', floorAlt: '#849191', seam: '#67797c', shadow: '#253e4c55',
    wood: '#77847a', woodLight: '#98a28a', woodDark: '#52676a',
    metal: '#667d82', metalLight: '#8f9fa0', metalDark: '#435d68',
    sky: '#758e9c', skyLight: '#9aabb0', leaf: '#566f74', glass: '#839da3',
    paper: '#c5cbb8', accent: '#a6aa8e', ink: '#405965', light: '#c0cec0'
  };
  const desk = (x, y) => ({ kind: 'desk', x, y, width: 30, height: 27 });
  const scenes = {
    classroom: {
      name: '[占位：教室]', theme: 'classroom', palette: warm,
      bounds: { x: 11, y: 51, width: 298, height: 122 },
      spawns: { start: { x: 166, y: 158, facing: 'up' }, fromHall: { x: 284, y: 79, facing: 'left' } },
      hotspotIds: ['classroom_desk', 'classroom_exit'],
      objects: [
        { kind: 'window', x: 22, y: 10, width: 63, height: 33 },
        { kind: 'blackboard', x: 105, y: 9, width: 91, height: 32 },
        { kind: 'window', x: 225, y: 10, width: 61, height: 33 },
        { kind: 'clock', x: 204, y: 14, width: 12, height: 12 },
        { kind: 'teacherDesk', x: 132, y: 57, width: 48, height: 20 },
        { kind: 'plant', x: 20, y: 56, width: 13, height: 22 },
        ...[90, 129].flatMap(y => [44, 98, 206, 260].map(x => desk(x, y))),
        { kind: 'door', x: 299, y: 62, width: 10, height: 33, side: 'right' },
        { kind: 'floorPaper', x: 189, y: 123, width: 7, height: 5 }
      ],
      colliders: [
        { x: 132, y: 61, width: 48, height: 16 }, { x: 21, y: 65, width: 12, height: 13 },
        ...[90, 129].flatMap(y => [44, 98, 206, 260].map(x => ({ x, y: y + 4, width: 30, height: 23 })))
      ],
      lighting: { darkness: 0.04, radius: 76, innerRadius: 18, ambient: '#182a38' },
      variants: {
        afterSchool: { ambientColor: '#d9ae6320' },
        night: {
          ambientColor: '#344f8260',
          lighting: { darkness: 0.49, radius: 65 },
          hotspots: ['classroom_desk', 'classroom_exit'],
          blockedExits: []
        }
      }
    },
    hallway: {
      name: '[占位：走廊]', theme: 'hallway', palette: { ...warm, floor: '#afad96', floorAlt: '#b8b59e', seam: '#929d8a' },
      bounds: { x: 11, y: 51, width: 298, height: 122 },
      spawns: { fromClass: { x: 37, y: 86, facing: 'right' }, fromOld: { x: 278, y: 132, facing: 'left' } },
      hotspotIds: ['hallway_board', 'hallway_facility', 'hallway_class', 'hallway_old'],
      objects: [
        { kind: 'window', x: 38, y: 9, width: 68, height: 33 },
        { kind: 'board', x: 135, y: 10, width: 56, height: 33 },
        { kind: 'window', x: 221, y: 9, width: 65, height: 33 },
        { kind: 'cabinet', x: 58, y: 57, width: 42, height: 29 },
        { kind: 'bench', x: 142, y: 66, width: 43, height: 16 },
        { kind: 'cabinet', x: 208, y: 122, width: 22, height: 24 },
        { kind: 'plant', x: 278, y: 55, width: 13, height: 22 },
        { kind: 'door', x: 11, y: 69, width: 10, height: 33, side: 'left' },
        { kind: 'door', x: 299, y: 114, width: 10, height: 33, side: 'right', stairs: true },
        { kind: 'bench', x: 56, y: 145, width: 43, height: 16 },
        { kind: 'floorPaper', x: 223, y: 125, width: 7, height: 5 }
      ],
      colliders: [
        { x: 58, y: 64, width: 42, height: 22 }, { x: 142, y: 72, width: 43, height: 10 },
        { x: 208, y: 129, width: 22, height: 17 },
        { x: 279, y: 64, width: 12, height: 13 }, { x: 56, y: 151, width: 43, height: 10 }
      ],
      lighting: { darkness: 0.07, radius: 85, innerRadius: 20, ambient: '#233640' },
      variants: {
        afterSchool: { ambientColor: '#dcc58b10' },
        night: {
          ambientColor: '#29477766',
          lighting: { darkness: 0.52, radius: 68 },
          hotspots: ['hallway_board', 'hallway_class', 'hallway_old'],
          blockedExits: ['hallway_old']
        }
      }
    },
    oldSchool: {
      name: '[占位：旧校舍楼梯间]', theme: 'oldSchool', palette: cool,
      bounds: { x: 11, y: 51, width: 298, height: 122 },
      spawns: { fromHall: { x: 37, y: 132, facing: 'right' } },
      hotspotIds: ['old_cabinet', 'old_exit'],
      objects: [
        { kind: 'window', x: 36, y: 9, width: 49, height: 35 },
        { kind: 'board', x: 108, y: 13, width: 38, height: 27 },
        { kind: 'window', x: 228, y: 9, width: 45, height: 35 },
        { kind: 'cabinet', x: 70, y: 66, width: 34, height: 35, sealed: true },
        { kind: 'stairs', x: 188, y: 57, width: 105, height: 73 },
        { kind: 'door', x: 11, y: 114, width: 10, height: 33, side: 'left', stairs: true },
        { kind: 'crack', x: 126, y: 131, width: 22, height: 12 },
        { kind: 'floorPaper', x: 120, y: 71, width: 7, height: 5 },
        { kind: 'floorPaper', x: 272, y: 156, width: 7, height: 5 }
      ],
      colliders: [{ x: 70, y: 73, width: 34, height: 28 }, { x: 188, y: 57, width: 105, height: 73 }],
      lighting: { darkness: 0.64, radius: 82, innerRadius: 17, ambient: '#101e32' },
      variants: {
        afterSchool: { ambientColor: '#567b8b18' },
        night: { ambientColor: '#13244166', lighting: { darkness: 0.79, radius: 53 }, blockedExits: [] }
      }
    }
  };
  // Simple content-only placeholders: no external images or narrative events.
  const exterior = (name, theme, palette, objects) => ({
    name, theme, palette, bounds: { x: 11, y: 51, width: 298, height: 122 },
    spawns: { arrival: { x: 160, y: 159, facing: 'up' } }, hotspotIds: [], objects,
    colliders: objects.filter(o => ['bench', 'plant', 'teacherDesk'].includes(o.kind))
      .map(o => ({ x: o.x, y: o.y + 8, width: o.width, height: o.height - 8 })),
    lighting: { darkness: 0.08, radius: 85, innerRadius: 20, ambient: '#233640' },
    variants: { night: { ambientColor: '#243e7155', lighting: { darkness: 0.59, radius: 65 } } }
  });
  scenes.park_entry = exterior('[占位：公园广场]', 'park', { ...warm, floor: '#879b7e', floorAlt: '#91a587', seam: '#778f77' }, [
    { kind: 'plant', x: 38, y: 61, width: 13, height: 22 },
    { kind: 'plant', x: 267, y: 61, width: 13, height: 22 },
    { kind: 'bench', x: 63, y: 102, width: 43, height: 16 },
    { kind: 'bench', x: 216, y: 102, width: 43, height: 16 }
  ]);
  scenes.restaurant_entry = exterior('[占位：餐厅大厅]', 'restaurant', warm, [
    { kind: 'window', x: 45, y: 10, width: 75, height: 33 },
    { kind: 'window', x: 200, y: 10, width: 75, height: 33 },
    { kind: 'teacherDesk', x: 43, y: 78, width: 48, height: 20 },
    { kind: 'teacherDesk', x: 226, y: 78, width: 48, height: 20 },
    { kind: 'bench', x: 136, y: 57, width: 43, height: 16 }
  ]);
  scenes.backhill_entry = exterior('[占位：后山入口]', 'backhill', cool, [
    { kind: 'plant', x: 48, y: 70, width: 13, height: 22 },
    { kind: 'plant', x: 258, y: 70, width: 13, height: 22 },
    { kind: 'bench', x: 130, y: 81, width: 43, height: 16 },
    { kind: 'crack', x: 120, y: 129, width: 22, height: 12 }
  ]);
  const regions = {
    school: { label: '[占位：学校]', worldNode: { x: 164, y: 100, icon: 'school' }, scenes: ['classroom', 'hallway', 'oldSchool'] },
    park: { label: '[占位：公园]', worldNode: { x: 460, y: 90, icon: 'tree' }, scenes: ['park_entry'] },
    restaurant: { label: '[占位：餐厅]', worldNode: { x: 440, y: 258, icon: 'table' }, scenes: ['restaurant_entry'] },
    backhill: { label: '[占位：后山]', worldNode: { x: 150, y: 260, icon: 'mountain' }, scenes: ['backhill_entry'], lockedSlots: ['night'] }
  };
  for (const [regionId, region] of Object.entries(regions)) {
    region.scenes.forEach((id, index) => {
      scenes[id].regionId = regionId;
      scenes[id].worldNode = { x: region.scenes.length === 1 ? 320 : 120 + index * 200, y: 175, icon: region.worldNode.icon };
      scenes[id].travelSpawn = Object.keys(scenes[id].spawns)[0];
    });
  }
  scenes.oldSchool.lockedSlots = ['night'];
  const edges = [];
  const pair = (id, from, to, costsTime, forwardSpawn, reverseSpawn, lockedSlots = [], exitIds = []) => {
    edges.push({ id: `${id}_out`, from, to, targetSpawn: forwardSpawn, costsTime, lockedSlots, exitId: exitIds[0] });
    edges.push({ id: `${id}_back`, from: to, to: from, targetSpawn: reverseSpawn, costsTime, lockedSlots, exitId: exitIds[1] });
  };
  pair('class_hall', 'classroom', 'hallway', false, 'fromClass', 'fromHall', [], ['classroom_exit', 'hallway_class']);
  pair('hall_old', 'hallway', 'oldSchool', false, 'fromHall', 'fromOld', [], ['hallway_old', 'old_exit']);
  pair('school_park', 'hallway', 'park_entry', false, 'arrival', 'fromClass');
  pair('school_restaurant', 'hallway', 'restaurant_entry', true, 'arrival', 'fromClass');
  pair('school_backhill', 'hallway', 'backhill_entry', true, 'arrival', 'fromClass', ['night']);
  pair('park_restaurant', 'park_entry', 'restaurant_entry', false, 'arrival', 'arrival');
  pair('park_backhill', 'park_entry', 'backhill_entry', true, 'arrival', 'arrival', ['night']);
  const content = {
    world: {
      regions, initialVisitedScenes: ['park_entry', 'restaurant_entry', 'backhill_entry'],
      width: 640, height: 360, miniMapVisible: true, miniMapCellPixels: 2,
      keys: { open: 'KeyM', miniMap: 'Tab' },
      colors: { background: '#202d32', grid: '#2c3c40', wall: '#71837d', floor: '#30443f',
        exit: '#8dd3ca', pending: '#e4bc76', collected: '#8bb38a', locked: '#8a777c',
        player: '#fff2cf', current: '#efd59a', visited: '#a2c8b0', unknown: '#59686d',
        internal: '#a0b6a0', cross: '#c39b6d', text: '#e0dfcb' }
    },
    travel: { edges },
    settings: {
      width: 320, height: 180, initialScene: 'classroom', initialSpawn: 'start',
      player: { speed: 60, footWidth: 8, footHeight: 5, colors: { outline: '#343d44', hair: '#41474b', hairLight: '#5b5a57', skin: '#dfbea0', shirt: '#eee5c9', jacket: '#687c77', skirt: '#435665', shoe: '#34454b', bag: '#b18c64' } }
    },
    ui: {
      title: '[占位：校园调查手记]', eyebrow: '[占位：像素校园 · 探索原型]',
      canvasLabel: '[占位：校园探索画面，方向键或 WASD 移动，E 或空格调查，N 打开笔记本]',
      locationsLabel: '[占位：区域一览]', session: '[占位：自由探索中]',
      notebook: '[占位：线索笔记本]', close: '[占位：关闭]', next: '[占位：继续]', done: '[占位：完成]',
      investigate: '[占位：E / 空格 / 点击 · 调查 {name}]', exit: '[占位：走入通道 · 前往 {name}]',
      clueCount: '[占位：已记录 {count} / {total}]', notebookCount: '[占位：收集条目 {count} / {total}]',
      notebookEmpty: '[占位：暂无记录，靠近标记处调查后添加]', notebookFootnote: '[占位：N / Esc 关闭 · 记录仅在本次游玩保留]',
      recorded: '[占位：已加入线索笔记本]', alreadyRecorded: '[占位：此条目已记录]',
      page: '[占位：第 {current} / {total} 页]',
      footer: '[占位：校园探索框架 · 无剧情内容]', footerHint: '[占位：靠近菱形标记开始调查]',
      controls: [
        { key: '[占位：WASD / ↑↓←→]', label: '[占位：移动]' },
        { key: '[占位：E / 空格]', label: '[占位：调查]' },
        { key: '[占位：N]', label: '[占位：笔记本]' },
        { key: '[占位：T]', label: '[占位：结束时段]' },
        { key: '[占位：M / Tab]', label: '[占位：世界地图 / 小地图]' }
      ],
      notebookKey: '[占位：N]',
      dateFormat: '[占位：{month} 月 {day} 日]',
      slotIndex: '[占位：{name} · 行动槽 {current} / {total}]',
      noDeadline: '[占位：—]',
      deadlineCountdown: '[占位：距 {name} {days} 天]',
      deadlineToday: '[占位：{name} 已到达]',
      actionConfirmTitle: '[占位：确认消耗时段]',
      actionConfirm: '[占位：此行动将消耗当前时段]',
      confirmAccept: '[占位：确认行动]',
      confirmCancel: '[占位：暂不行动]',
      endSlot: '[占位：结束当前时段]',
      endSlotTitle: '[占位：结束时段]',
      endSlotConfirm: '[占位：结束当前时段并推进时间？]',
      timeNoticeTitle: '[占位：日历提示]',
      noticeContinue: '[占位：继续]',
      timeTransition: '[占位：时间推进中]',
      transitionLabel: '[占位：{date} · {slot}]',
      slotLocked: '[占位：当前时段不可自由行动]',
      deadlineBlocked: '[占位：当前日期已到截止日，时间推进暂停]',
      facilityUsed: '[占位：设施使用完成]',
      facilityName: '[占位：校园设施]',
      hotspotUnavailable: '[占位：当前时间无法调查或使用此处]',
      exitBlocked: '[占位：当前时间此入口封锁]',
      hotspotReview: '[占位：E / 空格 / 点击 · 免费重看 {name}]',
      worldMap: '[占位：世界地图]', mapBack: '[占位：返回区域]', mapClose: '[占位：关闭地图]',
      mapHelp: '[占位：点击节点 / 方向键选择 / Enter 确认 · M 关闭 · T 结束时段]',
      mapLegend: '[占位：亮色为已访问 · 灰色为未访问 · 锁为时段封锁 · 实线区域内 / 虚线跨区]',
      mapUnvisited: '[占位：未访问，无法快速旅行]', mapLocked: '[占位：当前时间此区域、场景或连接封锁]',
      mapNoEdge: '[占位：当前场景无直达连接，请先前往相连场景]', mapCurrent: '[占位：当前位置]',
      mapTravelConfirm: '[占位：前往 {name} 将消耗当前时段]',
      mapMiniLabel: '[占位：场景小地图]', mapCanvasLabel: '[占位：区域与场景连接地图]',
      mapTravelFree: '[占位：免费旅行]', mapTravelCost: '[占位：消耗时段]',
      mapVisited: '[占位：已访问]', mapRegionView: '[占位：区域总览]'
    },
    timeSystem: {
      startDate: '2000-04-01',
      timeSlots: [
        { id: 'afterSchool', name: '[占位：放学后]' },
        { id: 'night', name: '[占位：夜晚]' }
      ],
      lockedSlots: [
        { date: '2000-04-02', slots: ['afterSchool'], message: '[占位：当前时段不可自由行动]' },
        { date: '2000-04-03', slots: '*', message: '[占位：本日不可自由行动]' }
      ],
      deadlines: [
        { id: 'deadline_01', date: '2000-04-05', name: '[占位：截止日期一]', message: '[占位：已到达截止日期，时间暂停]', afterNotice: 'pause' }
      ],
      actions: {
        investigate: { consumesSlot: true, repeatConsumesSlot: false },
        travel: { consumesSlot: false },
        facility: { consumesSlot: true, repeatConsumesSlot: true }
      },
      transitionMs: 700,
      endSlotKey: 'KeyT'
    },
    scenes,
    hotspots: {
      classroom_desk: { scene: 'classroom', type: 'investigate', actionId: 'investigate', allowedSlots: ['afterSchool'], name: '[占位：讲台物件]', rect: { x: 146, y: 61, width: 18, height: 14 }, radius: 24, dialogue: 'dialogue_01', clue: 'clue_01', closeup: 'closeup_01' },
      hallway_board: { scene: 'hallway', type: 'investigate', actionId: 'investigate', name: '[占位：公告栏]', rect: { x: 143, y: 48, width: 38, height: 12 }, radius: 38, dialogue: 'dialogue_02', clue: 'clue_02' },
      old_cabinet: { scene: 'oldSchool', type: 'investigate', actionId: 'investigate', name: '[占位：旧柜物件]', rect: { x: 77, y: 76, width: 20, height: 23 }, radius: 24, dialogue: 'dialogue_03', clue: 'clue_03', closeup: 'closeup_03' },
      hallway_facility: { scene: 'hallway', type: 'facility', actionId: 'facility', name: '[占位：校园设施]', rect: { x: 208, y: 122, width: 22, height: 12 }, radius: 25, dialogue: 'dialogue_facility' },
      classroom_exit: { scene: 'classroom', type: 'exit', actionId: 'travel', name: '[占位：走廊入口]', rect: { x: 297, y: 64, width: 12, height: 29 }, radius: 20, targetScene: 'hallway', targetSpawn: 'fromClass' },
      hallway_class: { scene: 'hallway', type: 'exit', actionId: 'travel', name: '[占位：教室入口]', rect: { x: 11, y: 71, width: 12, height: 29 }, radius: 20, targetScene: 'classroom', targetSpawn: 'fromHall' },
      hallway_old: { scene: 'hallway', type: 'exit', actionId: 'travel', name: '[占位：旧校舍楼梯]', rect: { x: 297, y: 116, width: 12, height: 29 }, radius: 20, targetScene: 'oldSchool', targetSpawn: 'fromHall' },
      old_exit: { scene: 'oldSchool', type: 'exit', actionId: 'travel', name: '[占位：返回走廊]', rect: { x: 11, y: 116, width: 12, height: 29 }, radius: 20, targetScene: 'hallway', targetSpawn: 'fromOld' }
    },
    clues: {
      clue_01: { title: '[占位：线索一]', description: '[占位：在这里填写线索一的描述。]' },
      clue_02: { title: '[占位：线索二]', description: '[占位：在这里填写线索二的描述。]' },
      clue_03: { title: '[占位：线索三]', description: '[占位：在这里填写线索三的描述。]' }
    },
    dialogues: {
      dialogue_01: { title: '[占位：调查窗口一]', pages: ['[占位：在这里填写调查文本第一页。]', '[占位：在这里填写调查文本第二页。]'] },
      dialogue_02: { title: '[占位：调查窗口二]', pages: ['[占位：在这里填写调查文本。]'] },
      dialogue_03: { title: '[占位：调查窗口三]', pages: ['[占位：在这里填写调查文本第一页。]', '[占位：在这里填写调查文本第二页。]'] },
      dialogue_facility: { title: '[占位：设施交互窗口]', pages: ['[占位：在这里填写设施交互文本。]'] }
    },
    closeups: {
      closeup_01: { title: '[占位：物件特写一]', pattern: 'paper', palette: { background: '#606e63', border: '#9aa18a', object: '#d8d1ae', shadow: '#394b48', detail: '#9b9f7d', accent: '#b29773' } },
      closeup_03: { title: '[占位：物件特写三]', pattern: 'cabinet', palette: { background: '#425d69', border: '#81959a', object: '#829394', shadow: '#2b4654', detail: '#bac0a7', accent: '#98a18c' } }
    }
  };
  // Generate editable map cells from the same collision and trigger data as the real scene.
  for (const [sceneId, s] of Object.entries(scenes)) {
    const width = 40, height = 24, scaleX = width / 320, scaleY = height / 180;
    const walls = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / scaleX, py = (y + 0.5) / scaleY;
      if (px < s.bounds.x || py < s.bounds.y || px > s.bounds.x + s.bounds.width || py > s.bounds.y + s.bounds.height ||
        s.colliders.some(c => px >= c.x && px < c.x + c.width && py >= c.y && py < c.y + c.height)) walls.push([x, y]);
    }
    const markers = s.hotspotIds.map(id => {
      const h = content.hotspots[id];
      return { id, x: (h.rect.x + h.rect.width / 2) * scaleX, y: (h.rect.y + h.rect.height / 2) * scaleY, targetScene: h.targetScene };
    });
    const spawn = s.spawns[s.travelSpawn];
    // Cross-region exits are map-only links, drawn along the lower edge of the mini-map.
    const mapExits = edges.filter(edge => edge.from === sceneId && !edge.exitId)
      .map((edge, index) => ({ edgeId: edge.id, x: 7 + index * 6, y: 22, targetScene: edge.to }));
    s.miniMap = { width, height, worldWidth: 320, worldHeight: 180, walls,
      exits: [...markers.filter(m => content.hotspots[m.id].type === 'exit'), ...mapExits],
      hotspots: markers.filter(m => content.hotspots[m.id].type !== 'exit'),
      playerSpawn: { worldX: spawn.x, worldY: spawn.y, mapX: spawn.x * scaleX, mapY: spawn.y * scaleY } };
  }
  return content;
})();
