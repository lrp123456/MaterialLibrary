/**
 * 空间漫游三段流水线与双确认 Handler (Spatial Walkthrough & 3D Architectural Pipeline)
 *
 * 核心链路：
 * 1. 实拍照片识别与拓扑推断 (inferRoomTopology)：
 *    - 支持多张空间实拍图（Base64 或素材库 FID / URL）
 *    - 优先调用 LiteLLM 高性能视觉大模型 (gemini-2.5-flash / doubao-vision)
 *    - 细致推导：房间功能分区、门洞朝向与两两连通、生成 2D 矩形/多边形与墙体网格
 *    - 附带启发式几何求解器兜底（保证非重叠、连通壁贴合、门洞镂空）
 * 2. 3D 空间架构生成 (generatePascal3DGeometry)：
 *    - 遵循 Pascal Editor 建筑学规范，将 2D 户型自动挤出为 3D 实体
 *    - 包含：各房间地坪(Slabs)、外立面与内隔墙(Walls)、门洞镂空(Doorway Openings)
 *    - 输出适用于 Web/App Three.js (ThreeDirector) 渲染的场景契约与默认机位
 * 3. 动线生成与镜头序列 (inferCameraSequence)
 * 4. 视频渲染调度 (scheduleSeedanceRender)
 */
const { completeChat } = require('../vlm');
const { resolveActiveVlmConfig, resolveLiteLlmChatConfig } = require('../providers');

/**
 * 启发式 2D 户型网格求解器：将房间与连通关系解算为标准 800x480 画布上的矩形与墙体坐标
 */
function solvePlanGeometry(rooms = [], connections = []) {
  if (!rooms.length) {
    rooms = [
      { id: 'room_1', name: '客厅', type: '客厅' },
      { id: 'room_2', name: '主卧', type: '主卧' },
      { id: 'room_3', name: '厨房', type: '厨房' },
    ];
  }

  const roomCount = rooms.length;
  const layoutRooms = [];
  const walls = [];
  const doors = [];

  // 画布基准尺寸 800 x 480
  const margin = 50;
  const canvasW = 800;
  const canvasH = 480;

  // 根据房间数量自适应网格排布 (避免重叠，同时保证主次空间开间合理)
  if (roomCount === 1) {
    layoutRooms.push({
      ...rooms[0],
      x: 180,
      y: 90,
      w: 440,
      h: 300,
    });
  } else if (roomCount === 2) {
    const w1 = 360;
    const w2 = 280;
    const h = 280;
    const y = 100;
    const x1 = 80;
    const x2 = x1 + w1; // 共享墙
    layoutRooms.push({ ...rooms[0], x: x1, y, w: w1, h });
    layoutRooms.push({ ...rooms[1], x: x2, y, w: w2, h });
  } else if (roomCount === 3) {
    // 客厅在左，主卧在右上，厨房/次卧在右下
    layoutRooms.push({ ...rooms[0], x: 80, y: 70, w: 340, h: 320 });
    layoutRooms.push({ ...rooms[1], x: 420, y: 70, w: 280, h: 160 });
    layoutRooms.push({ ...rooms[2], x: 420, y: 230, w: 280, h: 160 });
  } else if (roomCount === 4) {
    // 2x2 网格
    const rw = 310;
    const rh = 160;
    layoutRooms.push({ ...rooms[0], x: 80, y: 60, w: rw, h: rh });
    layoutRooms.push({ ...rooms[1], x: 80 + rw, y: 60, w: rw, h: rh });
    layoutRooms.push({ ...rooms[2], x: 80, y: 60 + rh, w: rw, h: rh });
    layoutRooms.push({ ...rooms[3], x: 80 + rw, y: 60 + rh, w: rw, h: rh });
  } else {
    // 多房间流式自适应排布
    const cols = Math.ceil(Math.sqrt(roomCount));
    const rows = Math.ceil(roomCount / cols);
    const rw = Math.floor((canvasW - margin * 2) / cols);
    const rh = Math.floor((canvasH - margin * 2) / rows);
    rooms.forEach((r, idx) => {
      const c = idx % cols;
      const row = Math.floor(idx / cols);
      layoutRooms.push({
        ...r,
        x: margin + c * rw,
        y: margin + row * rh,
        w: rw,
        h: rh,
      });
    });
  }

  // 提取四周墙体线框
  const wallMap = new Map();
  function addWallLine(x1, y1, x2, y2, type = 'interior') {
    // 规范化坐标起点与终点，去重共享墙
    let key = `${Math.min(x1, x2)}_${Math.min(y1, y2)}_${Math.max(x1, x2)}_${Math.max(y1, y2)}`;
    if (wallMap.has(key)) {
      // 两个房间共享的墙体标记为 interior
      const existing = wallMap.get(key);
      existing.type = 'interior';
      return existing;
    }
    const wallObj = {
      id: `wall_${wallMap.size + 1}`,
      x1,
      y1,
      x2,
      y2,
      type,
    };
    wallMap.set(key, wallObj);
    return wallObj;
  }

  layoutRooms.forEach((r) => {
    addWallLine(r.x, r.y, r.x + r.w, r.y, 'outer'); // 北墙
    addWallLine(r.x + r.w, r.y, r.x + r.w, r.y + r.h, 'outer'); // 东墙
    addWallLine(r.x, r.y + r.h, r.x + r.w, r.y + r.h, 'outer'); // 南墙
    addWallLine(r.x, r.y, r.x, r.y + r.h, 'outer'); // 西墙
  });

  wallMap.forEach((w) => walls.push(w));

  // 门洞推导：若有连通关系，在共享墙或相近墙体上开门洞
  let doorIdx = 1;
  const conns = Array.isArray(connections) && connections.length ? connections : [];
  if (!conns.length && layoutRooms.length >= 2) {
    for (let i = 0; i < layoutRooms.length - 1; i++) {
      conns.push({
        id: `conn_${i + 1}`,
        from: layoutRooms[i].id,
        to: layoutRooms[i + 1].id,
        door_type: 'open',
      });
    }
  }

  conns.forEach((c) => {
    const r1 = layoutRooms.find((r) => r.id === c.from);
    const r2 = layoutRooms.find((r) => r.id === c.to);
    if (!r1 || !r2) return;

    // 寻找两房间最近或相邻的边缘
    let doorX = Math.round((r1.x + r1.w / 2 + r2.x + r2.w / 2) / 2);
    let doorY = Math.round((r1.y + r1.h / 2 + r2.y + r2.h / 2) / 2);

    // 检查是否在垂直共享墙上
    if (Math.abs(r1.x + r1.w - r2.x) < 20 || Math.abs(r2.x + r2.w - r1.x) < 20) {
      doorX = Math.abs(r1.x + r1.w - r2.x) < 20 ? r2.x : r1.x;
      const minY = Math.max(r1.y, r2.y);
      const maxY = Math.min(r1.y + r1.h, r2.y + r2.h);
      doorY = Math.round((minY + maxY) / 2);
    } else if (Math.abs(r1.y + r1.h - r2.y) < 20 || Math.abs(r2.y + r2.h - r1.y) < 20) {
      doorY = Math.abs(r1.y + r1.h - r2.y) < 20 ? r2.y : r1.y;
      const minX = Math.max(r1.x, r2.x);
      const maxX = Math.min(r1.x + r1.w, r2.x + r2.w);
      doorX = Math.round((minX + maxX) / 2);
    }

    doors.push({
      id: `door_${doorIdx++}`,
      from_room: c.from,
      to_room: c.to,
      x: doorX,
      y: doorY,
      width: 70, // 像素尺寸，对应现实约 0.9m
      height: 2.0,
    });
  });

  return {
    rooms: layoutRooms,
    walls,
    doors,
    connections: conns,
    scale: {
      mode: 'doorHeight',
      doorHeight: 2.0,
      pixelToMeter: 45, // 约 45 像素 = 1 米
    },
  };
}

/**
 * 段 1：照片归成房间连接与 2D 户型排布 (输入实拍图推导出 2D 矢量平面)
 */
async function inferRoomTopology(services, {
  photoFids = [],
  photoUrls = [],
  photosBase64 = [],
  photos: inputPhotos = [],
  model = null,
}) {
  const db = services.db;
  const config = services.config;

  // 1. 规范化组装照片列表
  const photos = [];
  if (Array.isArray(inputPhotos) && inputPhotos.length > 0) {
    inputPhotos.forEach((p, idx) => {
      photos.push({
        id: p.id || `p_${idx + 1}`,
        name: p.name || `视角照片 ${idx + 1}`,
        dataUrl: p.dataUrl || p.url || '',
        fid: p.fid || null,
      });
    });
  } else {
    const maxCount = Math.max(photoFids.length, photoUrls.length, photosBase64.length);
    for (let i = 0; i < maxCount; i++) {
      const fid = photoFids[i] || null;
      let url = photoUrls[i] || photosBase64[i] || '';
      if (!url && fid) {
        url = `/api/viewer/assets/${encodeURIComponent(fid)}/file`;
      }
      photos.push({
        id: `p_${i + 1}`,
        name: `视角照片 ${i + 1}`,
        dataUrl: url,
        fid,
      });
    }
  }

  if (photos.length < 1) {
    throw new Error('漫游推断需要至少 1 张空间实拍照片');
  }

  // 2. 构造多视角空间与门洞推理 Prompt
  const promptText = `你是一位建筑空间与室内设计专家。请审阅用户上传的这 ${photos.length} 张空间实拍照片（标号 p_1 至 p_${photos.length}）。
【核心任务】：
1. 分析每张照片对应的功能房间（如客厅、餐厅、主卧、次卧、厨房、阳台、玄关等）。
2. 仔细辨认各视角背景中露出的门洞、过道拱门、视线通透处，推断各房间之间的门洞连通关系 (connections)。
3. 在标准 800 x 480 矩形画布中，估算各房间非重叠的 2D 矩形布局，相通的房间尽量相邻。
4. 返回严格 JSON 格式：
{
  "rooms": [
    { "id": "room_1", "name": "客厅", "type": "客厅", "x": 80, "y": 60, "w": 340, "h": 240, "photo_ids": ["p_1"] }
  ],
  "connections": [
    { "id": "conn_1", "from": "room_1", "to": "room_2", "door_type": "open", "wall_side": "east" }
  ]
}
只输出合法纯 JSON，严禁输出任何 markdown 格式或额外说明。`;

  try {
    // 优先采用活跃视觉模型（推荐 gemini-2.5-flash 或 doubao-vision）
    let vlmCfg = null;
    try {
      vlmCfg = resolveActiveVlmConfig(db, config, model || 'gemini-2.5-flash');
    } catch (_) {
      vlmCfg = resolveLiteLlmChatConfig(db, config, model || 'gemini-flash-latest');
    }

    const imageParts = photos
      .filter((p) => p.dataUrl)
      .slice(0, 8)
      .map((p) => ({
        type: 'image_url',
        image_url: { url: p.dataUrl },
      }));

    if (imageParts.length === 0) {
      throw new Error('未提供有效的照片图像数据');
    }

    const resp = await completeChat({
      baseUrl: vlmCfg.baseUrl,
      apiKey: vlmCfg.apiKey,
      model: vlmCfg.model,
      messages: [
        { role: 'system', content: (() => {
            if (services && services.db) {
              try {
                const { compileNodePrompt } = require('../prompt-compiler');
                const comp = compileNodePrompt(services.db, {
                  mountPointId: 'wf_studio_walkthrough',
                  nodeType: 'vlm_topology',
                  promptId: 'walkthrough_topology',
                });
                if (comp && comp.prompt) return comp.prompt;
              } catch (_) {}
            }
            return '你是专业室内空间拓扑与户型推断专家，必须严格输出纯 JSON。';
          })() },
        {
          role: 'user',
          content: [{ type: 'text', text: promptText }, ...imageParts],
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const rawText = (resp?.choices?.[0]?.message?.content || '').trim();
    const jsonStr = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // 将大模型推导出的房间与连接交由几何求解器做规范化对齐
    const solved = solvePlanGeometry(parsed.rooms || [], parsed.connections || []);

    return {
      photos,
      plan: solved,
      raw_analysis: parsed,
    };
  } catch (err) {
    console.warn('[walkthrough] VLM inferRoomTopology fallback:', err.message);

    // 智能启发式规则兜底：为每张照片自动分配房间并生成连通拓扑
    const fallbackRooms = photos.map((p, idx) => ({
      id: `room_${idx + 1}`,
      name: idx === 0 ? '客厅' : idx === 1 ? '主卧' : idx === 2 ? '餐厅' : idx === 3 ? '厨房' : `房间 ${idx + 1}`,
      type: idx === 0 ? '客厅' : idx === 1 ? '主卧' : idx === 2 ? '餐厅' : idx === 3 ? '厨房' : '客房',
      photo_ids: [p.id],
    }));

    const solved = solvePlanGeometry(fallbackRooms);
    return {
      photos,
      plan: solved,
      fallback: true,
      error_message: err.message,
    };
  }
}

/**
 * 段 2：Pascal 3D 建筑几何挤出生成器 (将 2D 户型矢量转化为 3D 空间网格与机位)
 *
 * 坐标系转换说明：
 * 2D 平面坐标 (x, y) 映射到 3D 笛卡尔坐标：
 * - 3D X = (x - centerX) / pixelToMeter
 * - 3D Y = 高度 (0 为地面，墙顶为 wallHeight)
 * - 3D Z = (y - centerY) / pixelToMeter
 */
function generatePascal3DGeometry(plan = {}, options = {}) {
  const rooms = Array.isArray(plan.rooms) ? plan.rooms : [];
  const walls = Array.isArray(plan.walls) ? plan.walls : [];
  const doors = Array.isArray(plan.doors) ? plan.doors : [];
  const scale = plan.scale || {};

  const pixelToMeter = Number(scale.pixelToMeter) || 45;
  const wallHeight = Number(options.wallHeight || 2.8);
  const wallThickness = Number(options.wallThickness || 0.15);
  const doorHeight = Number(options.doorHeight || 2.0);

  // 计算包围盒与中心点偏移
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  rooms.forEach((r) => {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.w);
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y + r.h);
  });
  if (!isFinite(minX)) {
    minX = 0;
    maxX = 800;
    minY = 0;
    maxY = 480;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  function to3D(x, y) {
    return {
      x: Number(((x - centerX) / pixelToMeter).toFixed(3)),
      z: Number(((y - centerY) / pixelToMeter).toFixed(3)),
    };
  }

  // 1. 生成房间地坪 (Floors / Slabs)
  const roomMeshes = rooms.map((r, idx) => {
    const center = to3D(r.x + r.w / 2, r.y + r.h / 2);
    const w3d = Number((r.w / pixelToMeter).toFixed(3));
    const d3d = Number((r.h / pixelToMeter).toFixed(3));

    // 根据房间类型分配柔和地坪色
    const palette = {
      客厅: '#F1F5F9',
      主卧: '#F8FAFC',
      次卧: '#F8FAFC',
      餐厅: '#F1F5F9',
      厨房: '#E2E8F0',
      卫生间: '#E2E8F0',
      阳台: '#EDF2F7',
    };
    const color = palette[r.type] || (idx % 2 === 0 ? '#F1F5F9' : '#F8FAFC');

    return {
      id: `slab_${r.id}`,
      roomId: r.id,
      name: r.name,
      type: 'slab',
      position: [center.x, 0, center.z],
      dimensions: [w3d, 0.05, d3d],
      color,
      elevation: 0,
      centerVantage: {
        position: [center.x, 1.6, center.z],
        roomName: r.name,
      },
    };
  });

  // 2. 生成墙体与门洞镂空 (Walls with Cutouts)
  const wallMeshes = [];
  walls.forEach((w) => {
    const p1 = to3D(w.x1, w.y1);
    const p2 = to3D(w.x2, w.y2);
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.1) return;

    const angle = Math.atan2(dz, dx);
    const midX = (p1.x + p2.x) / 2;
    const midZ = (p1.z + p2.z) / 2;

    // 检查该墙上是否存在门洞
    const wallDoors = doors.filter((d) => {
      const dp = to3D(d.x, d.y);
      // 距离墙体线段垂直距离小于容差
      const cross = Math.abs((dp.z - p1.z) * dx - (dp.x - p1.x) * dz) / len;
      return cross < 0.35;
    });

    if (wallDoors.length === 0) {
      // 整面实墙
      wallMeshes.push({
        id: `mesh_${w.id}`,
        wallId: w.id,
        type: 'wall_solid',
        position: [midX, wallHeight / 2, midZ],
        rotation: [0, -angle, 0],
        dimensions: [len, wallHeight, wallThickness],
        color: w.type === 'outer' ? '#CBD5E1' : '#E2E8F0',
      });
    } else {
      // 门洞分段（门顶过梁 + 门洞两侧墙）
      const doorW = Number((wallDoors[0].width || 70) / pixelToMeter);
      const sideW = Math.max(0.1, (len - doorW) / 2);

      // 左侧墙
      const leftDist = sideW / 2;
      wallMeshes.push({
        id: `mesh_${w.id}_left`,
        wallId: w.id,
        type: 'wall_part',
        position: [
          p1.x + Math.cos(angle) * leftDist,
          wallHeight / 2,
          p1.z + Math.sin(angle) * leftDist,
        ],
        rotation: [0, -angle, 0],
        dimensions: [sideW, wallHeight, wallThickness],
        color: '#E2E8F0',
      });

      // 右侧墙
      const rightDist = len - sideW / 2;
      wallMeshes.push({
        id: `mesh_${w.id}_right`,
        wallId: w.id,
        type: 'wall_part',
        position: [
          p1.x + Math.cos(angle) * rightDist,
          wallHeight / 2,
          p1.z + Math.sin(angle) * rightDist,
        ],
        rotation: [0, -angle, 0],
        dimensions: [sideW, wallHeight, wallThickness],
        color: '#E2E8F0',
      });

      // 门头过梁 (Lintel)
      const lintelH = wallHeight - doorHeight;
      if (lintelH > 0.1) {
        wallMeshes.push({
          id: `mesh_${w.id}_lintel`,
          wallId: w.id,
          type: 'lintel',
          position: [midX, doorHeight + lintelH / 2, midZ],
          rotation: [0, -angle, 0],
          dimensions: [doorW, lintelH, wallThickness],
          color: '#CBD5E1',
        });
      }
    }
  });

  // 3. 计算默认全局机位 (鸟瞰俯视视角)
  const span = Math.max(maxX - minX, maxY - minY) / pixelToMeter;
  const defaultCamera = {
    position: [0, Math.max(6, span * 1.3), Math.max(5, span * 1.1)],
    target: [0, 0, 0],
    fov: 38,
  };

  return {
    success: true,
    scale: {
      pixelToMeter,
      wallHeight,
      doorHeight,
      wallThickness,
    },
    bounds: {
      min: to3D(minX, minY),
      max: to3D(maxX, maxY),
      spanMeter: Number(span.toFixed(2)),
    },
    rooms: roomMeshes,
    walls: wallMeshes,
    defaultCamera,
  };
}

/**
 * 段 3：连接生成镜头顺序 (推导运镜序列)
 */
async function inferCameraSequence(services, { rooms = [], connections = [], photos = [] }) {
  const db = services.db;
  const config = services.config;

  const prompt = `已知室内的房间划分与门洞连接如下：
房间：${JSON.stringify(rooms)}
连接：${JSON.stringify(connections)}
【任务】：生成适合全景漫游视频的镜头顺序，规划顺畅的运镜路线。
要求返回严格 JSON 格式：
{
  "aspect_ratio": "16:9",
  "duration_per_shot": 4,
  "style": "平稳向前推进",
  "shots": [
    {
      "order": 1,
      "room_id": "${rooms[0]?.id || 'room_1'}",
      "room_name": "${rooms[0]?.name || '客厅'}",
      "movement": "forward",
      "prompt": "镜头从房间入口平稳向前缓慢推进，平视宽敞通透的室内空间，自然穿过门洞"
    }
  ]
}
只返回纯 JSON，不含解释。`;

  try {
    let llm = null;
    try {
      llm = resolveActiveVlmConfig(db, config, 'gemini-2.5-flash');
    } catch (_) {
      llm = resolveLiteLlmChatConfig(db, config, 'gemini-flash-latest');
    }

    const resp = await completeChat({
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      messages: [
        { role: 'system', content: (() => {
            if (services && services.db) {
              try {
                const { compileNodePrompt } = require('../prompt-compiler');
                const comp = compileNodePrompt(services.db, {
                  mountPointId: 'wf_studio_walkthrough',
                  nodeType: 'vlm_topology',
                  promptId: 'walkthrough_director',
                });
                if (comp && comp.prompt) return comp.prompt;
              } catch (_) {}
            }
            return '你是专业室内摄影导演与运镜规划专家。';
          })() },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const text = (resp?.choices?.[0]?.message?.content || '').trim();
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      aspect_ratio: parsed.aspect_ratio || '16:9',
      duration_per_shot: parsed.duration_per_shot || 4,
      style: parsed.style || '平稳向前推进',
      shots: parsed.shots || [],
    };
  } catch (e) {
    console.warn('[walkthrough] inferCameraSequence fallback:', e.message);
    const fallbackShots = (rooms || []).map((r, idx) => ({
      order: idx + 1,
      room_id: r.id,
      room_name: r.name,
      movement: 'forward',
      prompt: `镜头在${r.name}中缓慢平稳向前推进，自然平视全景室内空间。`,
    }));
    return {
      aspect_ratio: '16:9',
      duration_per_shot: 4,
      style: '平稳向前推进',
      shots: fallbackShots,
    };
  }
}

/**
 * 段 4：调度 Seedance 视频渲染任务
 */
function serverShotLine(shot, index, style) {
  const name = String(shot.room_name || shot.room_id || `空间${index + 1}`);
  const move = shot.movement === 'orbit' ? '缓慢环视' : '平稳向前推进';
  const written = String(shot.prompt || '').trim();
  const line = written || `镜头在${name}内${move}，平视空间，画面中没有人`;
  return `${index + 1}. [${name}] ${line}`;
}

async function scheduleSeedanceRender(services, { sequenceData, sourceFids = [] }) {
  const { executeAdapter } = require('../gen');
  const { findSeedanceAdapter } = require('./adapter-io');
  const shots = Array.isArray(sequenceData.shots) ? sequenceData.shots : [];
  const style = sequenceData.style || '平稳向前推进';
  const aspect = sequenceData.aspect_ratio || '16:9';
  const perShot = Number(sequenceData.duration_per_shot) || 4;
  const shotCount = Math.max(1, shots.length || sourceFids.length || 1);
  const durationSec = Math.max(4, Math.min(12, shotCount * perShot));
  const shotPrompts = shots.map((s, i) => serverShotLine(s, i, style)).join('；');
  const fullPrompt = `室内第一人称漫游运镜视频。整体画幅 ${aspect}，运镜风格：${style}。镜头动线：${shotPrompts}。画面平稳流畅，空间几何结构稳定，真实自然光影。`;

  const fids = sourceFids.filter(Boolean).slice(0, 6);
  if (fids.length < 1) throw new Error('漫游需要至少 1 张空间照片');
  const imageUrls = fids.map((fid) => `/api/viewer/assets/${encodeURIComponent(fid)}/file`);

  const adapter = findSeedanceAdapter(services && services.db);
  if (!adapter) throw new Error('未配置视频适配器 ark_seedance，漫游成片已停止');

  let model = 'doubao-video-seedance';
  try {
    const cfg =
      typeof adapter.config_json === 'string'
        ? JSON.parse(adapter.config_json || '{}')
        : adapter.config_json || {};
    if (cfg.model) model = cfg.model;
  } catch {
    /* 沿用默认 */
  }

  return executeAdapter(services, adapter, {
    model,
    gpuPriority: 'low',
    prompt: fullPrompt,
    imageUrls,
    ratio: aspect,
    aspect_ratio: aspect,
    durationSec,
    kind: 'video',
    timeoutMs: 12 * 60 * 1000,
  });
}

module.exports = {
  inferRoomTopology,
  generatePascal3DGeometry,
  inferCameraSequence,
  scheduleSeedanceRender,
};
