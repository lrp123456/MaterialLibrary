/**
 * workshop-store.js — 工坊本地状态与素材库持久化
 * 栈存在任务上；点保存才写入素材库。
 */
const LS_LIB = 'workshop.library.v1';
const LS_TASK = 'workshop.tasks.v1';

export const OPS = [
  { id: 'replace', label: '替换', mode: 'quad', rotate: true, needModel: true, needPhoto: true },
  { id: 'install', label: '安装', mode: 'quad', rotate: false, needModel: false, needPhoto: true },
  { id: 'add', label: '增加', mode: 'quad', rotate: true, needModel: true, needPhoto: false },
  { id: 'blank', label: '留白', mode: 'rect', rotate: false, needModel: false, needPhoto: false },
  { id: 'remove', label: '去除', mode: 'rect', rotate: false, needModel: false, needPhoto: false },
  { id: 'outpaint', label: '扩图', mode: 'rect', rotate: false, needModel: false, needPhoto: false },
  { id: 'dewm', label: '去水印', mode: 'rect', rotate: false, needModel: false, needPhoto: false },
  { id: 'clarity', label: '清晰度', mode: 'rect', rotate: false, needModel: false, needPhoto: false },
];

export const OUTPAINT_RATIOS = [
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '3:4', label: '3:4' },
  { id: '4:3', label: '4:3' },
  { id: '1:1', label: '1:1' },
];

export const FURNITURE_CATALOG = [
  { id: 'sofa_modular_a', name: '模块沙发 A', category: '沙发', hasModel: true, modelFile: 'models/sofa_modular_a.glb' },
  { id: 'armchair_boucle', name: '羊羔绒单椅', category: '单椅', hasModel: true, modelFile: 'models/armchair_boucle.glb' },
  { id: 'coffee_marble', name: '大理石茶几', category: '茶几', hasModel: true, modelFile: 'models/coffee_marble.glb' },
  { id: 'floor_lamp_arc', name: '弧形落地灯', category: '灯具', hasModel: true, modelFile: 'models/floor_lamp_arc.glb' },
  { id: 'sideboard_oak', name: '橡木餐边柜', category: '柜类', hasModel: true, modelFile: 'models/sideboard_oak.glb' },
  {
    id: 'product_chair_photo',
    name: '产品照·藤编椅（无模型）',
    category: '产品照',
    hasModel: false,
    modelFile: null,
    productPhotoOnly: true,
  },
];

export const MATERIAL_PRESETS = [];

function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('localStorage write failed', e);
  }
}

export class Store {
  constructor() {
    this.library = loadJSON(LS_LIB, []);
    this.tasks = loadJSON(LS_TASK, { imageStacks: [], tours: [] });
    this.listeners = new Set();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    saveJSON(LS_LIB, this.library);
    saveJSON(LS_TASK, this.tasks);
    this.listeners.forEach((fn) => fn(this));
  }

  saveToLibrary(entry) {
    const item = {
      id: uid('lib'),
      createdAt: Date.now(),
      kind: entry.kind || 'image',
      title: entry.title || '未命名',
      dataUrl: entry.dataUrl || null,
      frames: entry.frames || null,
      meta: entry.meta || {},
      sourceTaskId: entry.sourceTaskId || null,
    };
    this.library.unshift(item);
    this.emit();
    return item;
  }

  listLibrary(kind) {
    return kind ? this.library.filter((x) => x.kind === kind) : this.library.slice();
  }

  removeLibrary(id) {
    this.library = this.library.filter((x) => x.id !== id);
    this.emit();
  }

  createImageStackTask(payload = {}) {
    const task = {
      id: uid('istk'),
      title: payload.title || '图片栈任务',
      createdAt: Date.now(),
      images: [],
      saved: false,
    };
    this.tasks.imageStacks.push(task);
    this.emit();
    return task;
  }

  createTourTask(payload = {}) {
    const tour = {
      id: uid('tour'),
      title: payload.title || '户型导览',
      createdAt: Date.now(),
      photos: [],
      plan: {
        walls: [],
        doors: [],
        windows: [],
        rooms: [],
        scale: { mode: 'doorHeight', doorHeight: 2.0, wallRef: null },
      },
      cameraPath: [],
      personPath: [],
      segments: [],
      film: { music: false, dialogue: false, subtitle: false, dialogueText: '', subtitleText: '' },
      confirmed: false,
      saved: false,
    };
    this.tasks.tours.push(tour);
    this.emit();
    return tour;
  }

  getTour(id) {
    return this.tasks.tours.find((t) => t.id === id) || null;
  }

  getStackTask(id) {
    return this.tasks.imageStacks.find((t) => t.id === id) || null;
  }
}

export function newFrame(partial = {}) {
  return {
    id: uid('frm'),
    parentId: partial.parentId || null,
    op: partial.op || null,
    opLabel: partial.opLabel || '',
    dataUrl: partial.dataUrl || '',
    status: partial.status || 'success',
    failReason: partial.failReason || null,
    prompt: partial.prompt || '',
    frozen: partial.frozen || null,
    history: partial.history || [],
    parentChanged: false,
    orientationRef: partial.orientationRef || null,
    createdAt: Date.now(),
    detail: partial.detail || [],
  };
}

export function newImageEntry(name, dataUrl, w, h) {
  return {
    id: uid('img'),
    name,
    dataUrl,
    w,
    h,
    stack: [],
    activeFrameId: null,
    copiedFrom: null,
    batchFail: null,
  };
}

export { uid };
export { Store as WorkshopStore };
