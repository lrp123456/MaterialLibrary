/**
 * floor-tour-page.js — 户型导览
 */
import { uid } from './workshop-store.js';
import {
  cutStoryboard,
  defaultShotPrompt,
  simulateVideoSegment,
  snapshotStill,
  cropPairToRatio,
  SHOT_METHODS,
  SEGMENT_MAX_SEC,
} from './workshop-model.js';
import { saveWorkshopMedia } from '../../../service/ViewerApi';

const STEPS = [
  { id: 'photos', label: '照片分配' },
  { id: 'plan', label: '矢量平面' },
  { id: 'path', label: '动线' },
  { id: 'story', label: '分镜表' },
  { id: 'film', label: '成片' },
];

export class FloorTourPage {
  constructor(root, store, toast, opts) {
    this.root = root;
    this.store = store;
    this.toast = toast;
    this.getStackSnapshot = (opts && opts.getStackSnapshot) || (async () => null);
    this.tour = store.createTourTask({ title: '户型导览 · 新任务' });
    this.step = 'photos';
    this.drawMode = null;
    this.render();
  }

  render() {
    this.root.innerHTML =
      '<div class="tour-layout"><div class="steps" id="stepBar"></div>' +
      '<div class="tour-body"><div class="tour-main" id="tourMain"></div>' +
      '<div class="tour-side" id="tourSide"></div></div></div>' +
      '<input type="file" id="tourFiles" accept="image/*" multiple class="hidden" />';
    this.root.querySelector('#tourFiles').onchange = (e) => this.addPhotos(Array.prototype.slice.call(e.target.files));
    this.renderAll();
  }

  renderAll() {
    this.renderSteps();
    this.renderMain();
    this.renderSide();
  }

  renderSteps() {
    const el = this.root.querySelector('#stepBar');
    el.innerHTML = STEPS.map((s, i) => {
      return (
        '<button class="step-btn ' +
        (this.step === s.id ? 'active' : '') +
        '" data-step="' +
        s.id +
        '"><span class="num">' +
        (i + 1) +
        '</span>' +
        s.label +
        '</button>'
      );
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-step]'), (b) => {
      b.onclick = () => {
        this.step = b.getAttribute('data-step');
        this.renderAll();
      };
    });
  }

  renderMain() {
    const el = this.root.querySelector('#tourMain');
    if (this.step === 'photos') el.innerHTML = this.photosHtml();
    else if (this.step === 'plan') el.innerHTML = this.planHtml();
    else if (this.step === 'path') el.innerHTML = this.pathHtml();
    else if (this.step === 'story') el.innerHTML = this.storyHtml();
    else el.innerHTML = this.filmHtml();
    this.bindMain();
  }

  photosHtml() {
    const t = this.tour;
    return (
      '<div class="row" style="justify-content:space-between"><div><h2 style="font-size:15px">照片分配</h2>' +
      '<div class="muted mt8">视觉推断矢量草稿，非测量。待分配清空才能确认。</div></div><div class="row">' +
      '<button class="btn" id="btnInferPlan">推断户型草稿</button>' +
      '<button class="btn primary" id="btnAddPhotos">导入照片</button></div></div>' +
      '<div class="mt12"><h3 style="font-size:12px;color:#64748b">待分配</h3><div class="room-pool" id="unassignedPool">' +
      (t.photos.filter((p) => !p.roomId && p.used !== false)
        .map((p) => this.photoCard(p))
        .join('') || '<div class="empty"><p>无待分配照片</p></div>') +
      '</div></div>' +
      t.plan.rooms
        .map((room) => {
          return (
            '<div class="mt12"><h3 style="font-size:12px;color:#64748b">' +
            escapeHtml(room.name) +
            '</h3><div class="room-pool" data-room-drop="' +
            room.id +
            '">' +
            (t.photos
              .filter((p) => p.roomId === room.id)
              .map((p) => this.photoCard(p))
              .join('') || '<div class="empty" style="padding:12px"><p>拖入照片</p></div>') +
            '</div></div>'
          );
        })
        .join('') +
      '<div class="notice mt12"><strong>待分配不清空不能确认。</strong> 可标「不使用」。</div>'
    );
  }

  photoCard(p) {
    return (
      '<div class="photo-card" draggable="true" data-photo="' +
      p.id +
      '"><img src="' +
      p.dataUrl +
      '" alt="" /><div class="pbody"><div class="ptitle">' +
      escapeHtml(p.name) +
      '</div><div class="pmeta"><span class="badge ' +
      (p.label ? 'blue' : 'muted') +
      '">' +
      escapeHtml(p.label || '无标签') +
      '</span><button class="btn sm" data-unused="' +
      p.id +
      '">' +
      (p.used === false ? '启用' : '不使用') +
      '</button></div></div></div>'
    );
  }

  planHtml() {
    return (
      '<div class="row" style="justify-content:space-between"><div><h2 style="font-size:15px">矢量平面</h2>' +
      '<div class="muted mt8">确认前改完墙/门/窗/房名与尺度。</div></div><div class="row">' +
      ['wall', 'door', 'window', 'room']
        .map((m) => {
          return '<button class="btn sm ' + (this.drawMode === m ? 'active' : '') + '" data-draw="' + m + '">' + m + '</button>';
        })
        .join('') +
      '</div></div><div class="plan-board mt12" id="planBoard">' +
      this.planSvg() +
      '</div><div class="split-2 mt12"><div class="card"><h4>尺度（必须）</h4>' +
      '<div class="kv"><span>模式</span><span>' +
      (this.tour.plan.scale.mode === 'doorHeight' ? '门高 2m' : '实测墙长') +
      '</span></div>' +
      '<button class="btn sm" id="btnScaleDoor">默认门高 2m</button> ' +
      '<button class="btn sm" id="btnScaleWall">实测墙长</button>' +
      (this.hasScale() ? '<div class="notice ok">尺度已就绪。</div>' : '<div class="notice warn">没有尺度不能确认。</div>') +
      '</div><div class="card"><h4>确认</h4>' +
      '<div class="kv"><span>房间</span><span>' +
      this.tour.plan.rooms.length +
      '</span></div>' +
      '<button class="btn primary mt12" id="btnConfirmPlan" style="width:100%"' +
      (this.canConfirmPlan() ? '' : ' disabled') +
      '>确认并挤出 3D</button>' +
      (this.tour.confirmed ? '<div class="notice ok mt8">已确认，3D 已挤出。</div>' : '') +
      '</div></div>'
    );
  }

  planSvg() {
    return (
      '<svg id="planSvg" viewBox="0 0 800 480" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="800" height="480" fill="#f8fafc"/>' +
      this.tour.plan.rooms
        .map((r) => {
          return (
            '<g data-room="' +
            r.id +
            '"><rect x="' +
            r.x +
            '" y="' +
            r.y +
            '" width="' +
            r.w +
            '" height="' +
            r.h +
            '" fill="rgba(37,99,235,0.1)" stroke="#2563eb" stroke-width="1.5" rx="4"/>' +
            '<text x="' +
            (r.x + r.w / 2) +
            '" y="' +
            (r.y + r.h / 2) +
            '" text-anchor="middle" dominant-baseline="central" fill="#0f172a" font-size="14">' +
            escapeHtml(r.name) +
            '</text></g>'
          );
        })
        .join('') +
      this.tour.plan.walls
        .map((w) => {
          return (
            '<line data-wall="' +
            w.id +
            '" x1="' +
            w.x1 +
            '" y1="' +
            w.y1 +
            '" x2="' +
            w.x2 +
            '" y2="' +
            w.y2 +
            '" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>'
          );
        })
        .join('') +
      '</svg>'
    );
  }

  pathHtml() {
    return (
      '<div class="row" style="justify-content:space-between"><div><h2 style="font-size:15px">动线</h2>' +
      '<div class="muted mt8">镜头线必填，人物线可空。</div></div><div class="row">' +
      '<button class="btn sm ' +
      (this.drawMode === 'camera' ? 'active' : '') +
      '" data-draw="camera">画镜头线</button>' +
      '<button class="btn sm ' +
      (this.drawMode === 'person' ? 'active' : '') +
      '" data-draw="person">画人物线</button>' +
      '<button class="btn sm" id="btnClearPath">清空</button></div></div>' +
      '<div class="plan-board mt12"><svg id="pathSvg" viewBox="0 0 800 480"><rect width="800" height="480" fill="#f8fafc"/>' +
      this.tour.plan.rooms
        .map((r) => {
          return (
            '<rect x="' +
            r.x +
            '" y="' +
            r.y +
            '" width="' +
            r.w +
            '" height="' +
            r.h +
            '" fill="rgba(37,99,235,0.08)" stroke="#cbd5e1" rx="4"/>' +
            '<text x="' +
            (r.x + r.w / 2) +
            '" y="' +
            (r.y + r.h / 2) +
            '" text-anchor="middle" fill="#64748b" font-size="12">' +
            escapeHtml(r.name) +
            '</text>'
          );
        })
        .join('') +
      this.pathPolyline(this.tour.cameraPath, '#2563eb') +
      this.pathPolyline(this.tour.personPath, '#d97706') +
      '</svg></div>' +
      '<div class="notice mt12">不画人物线 → 成片无人、提示词不写人。人 1.7m / 眼高 1.6m / 步速 1.2m/s。</div>'
    );
  }

  pathPolyline(points, color) {
    if (!points.length) return '';
    const d = points.map((p, i) => (i ? 'L' : 'M') + ' ' + p.x + ' ' + p.y).join(' ');
    return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="3"/>';
  }

  storyHtml() {
    const segs = this.tour.segments;
    return (
      '<div class="row" style="justify-content:space-between"><div><h2 style="font-size:15px">分镜表</h2>' +
      '<div class="muted mt8">先切表再逐段生成。上限 ' +
      SEGMENT_MAX_SEC +
      ' 秒。</div></div><div class="row">' +
      '<button class="btn" id="btnCutStory">按动线切分镜</button>' +
      '<button class="btn primary" id="btnGenAll">逐段生成</button></div></div>'
    );
  }

  filmHtml() {
    const f = this.tour.film;
    const adopted = this.tour.segments.filter((s) => s.status === 'adopted');
    return (
      '<div class="row" style="justify-content:space-between"><div><h2 style="font-size:15px">成片</h2>' +
      '<div class="muted mt8">采用段硬切。音乐/对白/字幕分开关，默认关。</div></div>' +
      '<button class="btn primary" id="btnSaveTour">保存到素材库（真写入）</button></div>' +
      '<div class="split-2 mt12"><div class="card"><h4>音轨开关</h4>' +
      '<div class="switch-row"><span>音乐</span><div class="switch ' +
      (f.music ? 'on' : '') +
      '" data-toggle="music"></div></div>' +
      '<div class="switch-row"><span>对白（须人写台词）</span><div class="switch ' +
      (f.dialogue ? 'on' : '') +
      '" data-toggle="dialogue"></div></div>' +
      '<div class="switch-row"><span>字幕（须人写字幕）</span><div class="switch ' +
      (f.subtitle ? 'on' : '') +
      '" data-toggle="subtitle"></div></div>' +
      '<div class="notice">模型不现编词、不现写字。</div></div>' +
      '<div class="card"><h4>已采用 ' +
      adopted.length +
      ' 段</h4><div class="notice">生成后「待确认」→ 采用进成片 / 退回播 3D。</div></div></div>'
    );
  }

  bindMain() {
    const el = this.root.querySelector('#tourMain');
    Array.prototype.forEach.call(el.querySelectorAll('[data-draw]'), (b) => {
      b.onclick = () => {
        this.drawMode = this.drawMode === b.getAttribute('data-draw') ? null : b.getAttribute('data-draw');
        this.renderMain();
      };
    });
    const btnAdd = el.querySelector('#btnAddPhotos');
    if (btnAdd) btnAdd.onclick = () => this.root.querySelector('#tourFiles').click();
    const btnInfer = el.querySelector('#btnInferPlan');
    if (btnInfer) btnInfer.onclick = () => this.inferPlan();
    Array.prototype.forEach.call(el.querySelectorAll('[data-unused]'), (b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const p = this.tour.photos.find((x) => x.id === b.getAttribute('data-unused'));
        if (p) {
          p.used = p.used === false;
          if (p.used === false) p.roomId = null;
          this.store.emit();
          this.renderMain();
        }
      };
    });
    Array.prototype.forEach.call(el.querySelectorAll('.photo-card'), (card) => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/photo', card.getAttribute('data-photo'));
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-room-drop]'), (zone) => {
      zone.addEventListener('dragover', (e) => e.preventDefault());
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        const pid = e.dataTransfer.getData('text/photo');
        const photo = this.tour.photos.find((p) => p.id === pid);
        if (photo) {
          photo.roomId = zone.getAttribute('data-room-drop');
          photo.used = true;
          this.store.emit();
          this.renderMain();
          this.toast('已分配到房间', 'ok');
        }
      });
    });
    const btnConfirm = el.querySelector('#btnConfirmPlan');
    if (btnConfirm) btnConfirm.onclick = () => this.confirmPlan();
    const btnScaleDoor = el.querySelector('#btnScaleDoor');
    if (btnScaleDoor)
      btnScaleDoor.onclick = () => {
        this.tour.plan.scale.mode = 'doorHeight';
        this.tour.plan.scale.doorHeight = 2;
        this.store.emit();
        this.renderMain();
      };
    const btnScaleWall = el.querySelector('#btnScaleWall');
    if (btnScaleWall)
      btnScaleWall.onclick = () => {
        this.tour.plan.scale.mode = 'wall';
        this.tour.plan.scale.wallRef = { id: 'w1', len: 3 };
        this.store.emit();
        this.renderMain();
      };
    const planSvg = el.querySelector('#planSvg');
    if (planSvg) this.bindPlanSvg(planSvg);
    const pathSvg = el.querySelector('#pathSvg');
    if (pathSvg) this.bindPathSvg(pathSvg);
    const btnCut = el.querySelector('#btnCutStory');
    if (btnCut) btnCut.onclick = () => this.cutStory();
    const btnGenAll = el.querySelector('#btnGenAll');
    if (btnGenAll) btnGenAll.onclick = () => this.generateAll();
    Array.prototype.forEach.call(el.querySelectorAll('[data-toggle]'), (sw) => {
      sw.onclick = () => {
        const k = sw.getAttribute('data-toggle');
        this.tour.film[k] = !this.tour.film[k];
        this.store.emit();
        this.renderMain();
      };
    });
    const btnSaveTour = el.querySelector('#btnSaveTour');
    if (btnSaveTour) btnSaveTour.onclick = () => this.saveTour();
    const btnClearPath = el.querySelector('#btnClearPath');
    if (btnClearPath)
      btnClearPath.onclick = () => {
        this.tour.cameraPath = [];
        this.tour.personPath = [];
        this.store.emit();
        this.renderMain();
      };
  }

  bindPlanSvg(svg) {
    svg.addEventListener('click', (e) => {
      const pt = svgPoint(svg, e);
      if (this.drawMode === 'wall') {
        if (!this._wallStart) {
          this._wallStart = pt;
          this.toast('点第二点完成墙', 'ok');
        } else {
          this.tour.plan.walls.push({
            id: uid('wall'),
            x1: this._wallStart.x,
            y1: this._wallStart.y,
            x2: pt.x,
            y2: pt.y,
          });
          this._wallStart = null;
          this.store.emit();
          this.renderMain();
        }
      } else if (this.drawMode === 'room') {
        const name = window.prompt('房间名称', '客厅') || '房间';
        this.tour.plan.rooms.push({
          id: uid('room'),
          name: name,
          type: name,
          x: pt.x - 70,
          y: pt.y - 45,
          w: 140,
          h: 90,
        });
        this.store.emit();
        this.renderMain();
      }
    });
  }

  bindPathSvg(svg) {
    svg.addEventListener('click', (e) => {
      const pt = svgPoint(svg, e);
      if (this.drawMode === 'camera') {
        const headingDeg = Number(window.prompt('朝向角度 0-359', '0') || 0);
        const stillId = window.prompt('静帧图片 ID（可空）', '') || null;
        this.tour.cameraPath.push({
          x: pt.x,
          y: pt.y,
          headingDeg: ((headingDeg % 360) + 360) % 360,
          tSec: this.tour.cameraPath.length * 4,
          room: this.roomAt(pt),
          stillId: stillId,
          wallWithoutPhoto: this.isWallWithoutPhoto(pt),
        });
        this.store.emit();
        this.renderMain();
      } else if (this.drawMode === 'person') {
        this.tour.personPath.push({ x: pt.x, y: pt.y, tSec: this.tour.personPath.length * 3 });
        this.store.emit();
        this.renderMain();
      }
    });
  }

  roomAt(pt) {
    const r = this.tour.plan.rooms.find(
      (room) => pt.x >= room.x && pt.x <= room.x + room.w && pt.y >= room.y && pt.y <= room.y + room.h
    );
    return r ? r.id : null;
  }

  isWallWithoutPhoto(pt) {
    const r = this.tour.plan.rooms.find(
      (room) => pt.x >= room.x - 20 && pt.x <= room.x + room.w + 20 && pt.y >= room.y - 20 && pt.y <= room.y + room.h + 20
    );
    if (!r) return true;
    return !this.tour.photos.some((p) => p.roomId === r.id && p.used !== false);
  }

  hasScale() {
    const s = this.tour.plan.scale;
    if (s.mode === 'doorHeight') return s.doorHeight > 0;
    return !!(s.wallRef && s.wallRef.len > 0);
  }

  canConfirmPlan() {
    if (!this.hasScale()) return false;
    if (!this.tour.plan.rooms.length) return false;
    const unassigned = this.tour.photos.filter((p) => !p.roomId && p.used !== false);
    if (unassigned.length) return false;
    return true;
  }

  renderSide() {
    const el = this.root.querySelector('#tourSide');
    const t = this.tour;
    el.innerHTML =
      '<div class="panel-section"><h3>确认清单</h3>' +
      '<div class="kv"><span>尺度</span><span>' +
      (this.hasScale() ? '<span class="badge green">OK</span>' : '<span class="badge red">缺失</span>') +
      '</span></div>' +
      '<div class="kv"><span>待分配</span><span>' +
      t.photos.filter((p) => !p.roomId && p.used !== false).length +
      '</span></div>' +
      '<div class="kv"><span>镜头线</span><span>' +
      t.cameraPath.length +
      ' 点</span></div>' +
      '<div class="kv"><span>人物线</span><span>' +
      (t.personPath.length ? t.personPath.length + ' 点' : '无（成片无人）') +
      '</span></div></div>' +
      '<div class="panel-section"><h3>固定参数</h3>' +
      '<div class="kv"><span>人体身高</span><span class="mono">1.7 m</span></div>' +
      '<div class="kv"><span>段时长上限</span><span class="mono">' +
      SEGMENT_MAX_SEC +
      ' s</span></div>' +
      '<div class="kv"><span>默认视频</span><span class="mono">Seedance 2.5</span></div></div>';
  }

  async addPhotos(files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const dataUrl = await fileToDataUrl(f);
      this.tour.photos.push({
        id: uid('ph'),
        name: f.name,
        dataUrl: dataUrl,
        label: guessLabel(f.name),
        roomId: null,
        used: true,
        cam: null,
      });
    }
    this.autoAssign();
    this.store.emit();
    this.renderAll();
    this.toast('已导入 ' + files.length + ' 张', 'ok');
  }

  autoAssign() {
    const counts = {};
    this.tour.photos.forEach((p) => {
      if (!p.label) return;
      counts[p.label] = (counts[p.label] || 0) + 1;
    });
    this.tour.photos.forEach((p) => {
      if (!p.label || p.used === false) return;
      const rooms = this.tour.plan.rooms.filter((r) => r.type === p.label || r.name === p.label);
      if (rooms.length === 1 && counts[p.label] === 1) p.roomId = rooms[0].id;
      else p.roomId = null;
    });
  }

  inferPlan() {
    this.tour.plan.rooms = [
      { id: uid('room'), name: '客厅', type: '客厅', x: 80, y: 60, w: 320, h: 220 },
      { id: uid('room'), name: '卧室', type: '卧室', x: 420, y: 60, w: 220, h: 160 },
      { id: uid('room'), name: '厨房', type: '厨房', x: 420, y: 240, w: 220, h: 120 },
    ];
    this.tour.plan.walls = [
      { id: uid('wall'), x1: 80, y1: 60, x2: 640, y2: 60 },
      { id: uid('wall'), x1: 80, y1: 280, x2: 640, y2: 280 },
    ];
    this.autoAssign();
    this.store.emit();
    this.renderAll();
    this.toast('已生成矢量户型草稿', 'ok');
  }

  confirmPlan() {
    if (!this.canConfirmPlan()) {
      this.toast('仍有待分配/缺尺度', 'err');
      return;
    }
    this.tour.confirmed = true;
    this.store.emit();
    this.step = 'path';
    this.renderAll();
    this.toast('已确认，墙体已挤出 3D', 'ok');
  }

  cutStory() {
    if (!this.tour.cameraPath.length) {
      this.toast('先画镜头线', 'err');
      return;
    }
    const stillStations = [];
    this.tour.cameraPath.forEach((p, i) => {
      if (p.stillId) stillStations.push(i);
    });
    this.tour.segments = cutStoryboard(this.tour.cameraPath, { stillStations: stillStations });
    this.tour.segments.forEach((s) => {
      s.hasPerson = this.tour.personPath.length > 0;
      s.prompt = defaultShotPrompt(s);
    });
    this.store.emit();
    this.step = 'story';
    this.renderAll();
    this.toast('已切 ' + this.tour.segments.length + ' 段', 'ok');
  }

  async generateAll() {
    if (!this.tour.segments.length) this.cutStory();
    for (let i = 0; i < this.tour.segments.length; i++) {
      await this.generateSegment(this.tour.segments[i].id);
    }
  }

  async generateSegment(id) {
    const s = this.tour.segments.find((x) => x.id === id);
    if (!s) return;
    s.status = 'generating';
    const res = await simulateVideoSegment(s);
    if (!res.ok) {
      s.status = s.latest ? 'pending' : 'failed';
      s.results = s.results || [];
      s.results.push({ ok: false, reason: res.reason, at: Date.now() });
      this.toast('生成失败：' + res.reason, 'err');
    } else {
      s.results = s.results || [];
      s.results.push({ ok: true, outputUrl: res.outputUrl, kind: res.kind, at: Date.now() });
      s.latest = { outputUrl: res.outputUrl, kind: res.kind };
      s.status = 'pending';
      this.toast('生成完成，待确认', 'ok');
    }
    this.store.emit();
    this.renderAll();
  }

  async saveTour() {
    const adopted = this.tour.segments.filter((s) => s.status === 'adopted');
    if (!adopted.length) {
      this.toast('没有已采用的段', 'err');
      return;
    }
    if (this.tour.film.dialogue && !String(this.tour.film.dialogueText || '').trim()) {
      this.toast('对白已打开，必须有人写的台词', 'err');
      return;
    }
    if (this.tour.film.subtitle && !String(this.tour.film.subtitleText || '').trim()) {
      this.toast('字幕已打开，必须有人写的字幕文本', 'err');
      return;
    }
    const cover = adopted.map((s) => s.latest && s.latest.outputUrl).filter(Boolean)[0];
    if (!cover) {
      this.toast('没有可入库的成片帧', 'err');
      return;
    }
    try {
      const res = await saveWorkshopMedia({
        dataUrl: cover,
        fileName: (this.tour.title || 'tour') + '.jpg',
        title: this.tour.title,
        source: 'workshop',
        clientAssetId: this.tour.id,
      });
      const fid = res && (res.fid || res.assetId || res.id);
      this.store.saveToLibrary({
        kind: 'tour',
        title: this.tour.title,
        frames: adopted.map((s) => s.latest && s.latest.outputUrl).filter(Boolean),
        dataUrl: cover,
        sourceTaskId: this.tour.id,
        meta: { segments: adopted.length, fid: fid, remote: true },
      });
      this.toast(fid ? '导览已写入素材库 fid=' + fid : '导览已写入素材库', 'ok');
    } catch (e) {
      this.toast('导览入库失败：' + (e && e.message), 'err');
    }
  }
}

function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function guessLabel(name) {
  const n = String(name).toLowerCase();
  if (/客厅|living/.test(n)) return '客厅';
  if (/卧|bed/.test(n)) return '卧室';
  if (/厨|kitchen/.test(n)) return '厨房';
  return '';
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { cropPairToRatio, snapshotStill, SHOT_METHODS };
