/**
 * image-stack-page.js — 图片栈工作流
 */
import {
  OPS,
  OUTPAINT_RATIOS,
  FURNITURE_CATALOG,
  newFrame,
  newImageEntry,
  uid,
} from './workshop-store.js';
import { defaultPrompt, loadImage } from './workshop-model.js';
import { saveWorkshopMedia } from '../../../service/ViewerApi';
import { runStackOp } from './workshop-ai';

export class ImageStackPage {
  constructor(root, store, toast) {
    this.root = root;
    this.store = store;
    this.toast = toast;
    this.task = store.createImageStackTask({ title: '图片栈 · 新任务' });
    this.activeImageId = null;
    this.activeOp = 'replace';
    this.toolMode = 'quad';
    this.drawing = null;
    this.yaw = 0;
    this.scalePct = 100;
    this.product = null;
    this.productPhotoDataUrl = null;
    this.materialRef = null;
    this.materialMode = 'surround';
    this.outpaintRatio = '16:9';
    this.busy = false;
    this.editedPrompt = null;
    this.forceFailNext = false;
    this.render();
  }

  get activeImage() {
    return this.task.images.find((i) => i.id === this.activeImageId) || null;
  }

  get activeFrame() {
    const img = this.activeImage;
    if (!img) return null;
    return img.stack.find((f) => f.id === img.activeFrameId) || img.stack[img.stack.length - 1] || null;
  }

  get parentDataUrl() {
    const img = this.activeImage;
    if (!img) return null;
    const top = img.stack.filter((f) => f.status === 'success').slice(-1)[0];
    return top ? top.dataUrl : img.dataUrl;
  }

  get currentOpMeta() {
    return OPS.find((o) => o.id === this.activeOp) || OPS[0];
  }

  render() {
    this.root.innerHTML =
      '<div class="stack-layout">' +
      '<div class="col"><div class="col-head"><span>图片</span><div class="row">' +
      '<button class="btn sm primary" id="btnAddImages">+ 导入</button>' +
      '<button class="btn sm" id="btnSample">样板</button></div></div>' +
      '<div class="col-body" id="imageList"></div>' +
      '<div class="panel-section"><button class="btn sm" id="btnBatchTpl" style="width:100%">批量模板</button></div></div>' +
      '<div class="col"><div class="op-toolbar" id="opToolbar"></div>' +
      '<div class="canvas-wrap"><div class="stage" id="stage"></div>' +
      '<div class="filmstrip"><div class="filmstrip-head"><span>线性栈 · 一图一条</span><div class="row">' +
      '<button class="btn sm" id="btnCopyStack">从此步复制新栈</button>' +
      '<button class="btn sm" id="btnResetSel">重画选区</button></div></div>' +
      '<div class="frames" id="frames"></div></div></div></div>' +
      '<div class="col" id="rightCol"></div></div>' +
      '<input type="file" id="fileImages" accept="image/*" multiple class="hidden" />' +
      '<input type="file" id="fileProduct" accept="image/*" class="hidden" />';
    this.bind();
    this.renderAll();
  }

  bind() {
    this.root.querySelector('#btnAddImages').onclick = () => this.root.querySelector('#fileImages').click();
    this.root.querySelector('#fileImages').onchange = (e) => this.addImages(Array.prototype.slice.call(e.target.files));
    this.root.querySelector('#btnSample').onclick = () => this.loadSample();
    this.root.querySelector('#btnResetSel').onclick = () => {
      this.drawing = null;
      this.renderStage();
    };
    this.root.querySelector('#btnCopyStack').onclick = () => this.copyStackBranch();
    this.root.querySelector('#btnBatchTpl').onclick = () => {
      const tpl = window.prompt('批量模板（仅操作顺序 + 家具/材质预设，不含画框）', 'replace>clarity | furniture:sofa_modular_a');
      if (tpl) this.toast('模板已保存。每张图仍需自画区域。', 'ok');
    };
    this.root.querySelector('#fileProduct').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      this.productPhotoDataUrl = await fileToDataUrl(f);
      this.toast('产品照片已载入', 'ok');
      this.renderRight();
      this.renderStage();
    };
  }

  renderAll() {
    this.renderOpToolbar();
    this.renderImageList();
    this.renderStage();
    this.renderFrames();
    this.renderRight();
  }

  renderOpToolbar() {
    const el = this.root.querySelector('#opToolbar');
    el.innerHTML = OPS.map((op) => {
      return (
        '<button class="op-btn ' +
        (this.activeOp === op.id ? 'active' : '') +
        '" data-op="' +
        op.id +
        '">' +
        op.label +
        '<span class="hint">' +
        (op.mode === 'quad' ? '四点' : '矩形') +
        (op.rotate ? ' · 旋转' : '') +
        '</span></button>'
      );
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-op]'), (b) => {
      b.onclick = () => {
        this.activeOp = b.getAttribute('data-op');
        this.toolMode = this.currentOpMeta.mode;
        this.drawing = null;
        this.renderAll();
      };
    });
  }

  renderImageList() {
    const el = this.root.querySelector('#imageList');
    if (!this.task.images.length) {
      el.innerHTML = '<div class="empty"><div class="icon">🖼️</div><p>导入照片后按图建栈</p></div>';
      return;
    }
    el.innerHTML = this.task.images
      .map((img) => {
        const top = img.stack.filter((f) => f.status === 'success').slice(-1)[0];
        const thumb = (top && top.dataUrl) || img.dataUrl;
        return (
          '<div class="image-item ' +
          (img.id === this.activeImageId ? 'active' : '') +
          '" data-id="' +
          img.id +
          '"><img class="thumb" src="' +
          thumb +
          '" alt="" /><div class="meta"><div class="name">' +
          escapeHtml(img.name) +
          '</div><div class="sub">栈 ' +
          img.stack.length +
          ' 帧</div></div></div>'
        );
      })
      .join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-id]'), (n) => {
      n.onclick = () => {
        this.activeImageId = n.getAttribute('data-id');
        this.drawing = null;
        this.renderAll();
      };
    });
  }

  renderStage() {
    const stage = this.root.querySelector('#stage');
    const img = this.activeImage;
    if (!img) {
      stage.innerHTML = '<div class="empty"><div class="icon">📐</div><p>选择一张图片开始标注</p><p class="faint">选区手动画，不接 YOLO</p></div>';
      return;
    }
    const parent = this.parentDataUrl;
    stage.innerHTML =
      '<div class="stage-box" id="stageBox"><img id="sceneImg" src="' +
      parent +
      '" alt="scene" draggable="false" /><div class="overlay" id="overlay"><svg class="link-layer" id="linkLayer"></svg></div></div>' +
      '<div class="stage-tip" id="stageTip"></div>';
    const imgEl = stage.querySelector('#sceneImg');
    const overlay = stage.querySelector('#overlay');
    imgEl.onload = () => this.drawOverlay();
    if (imgEl.complete) this.drawOverlay();
    overlay.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    overlay.addEventListener('pointermove', (e) => this.onPointerMove(e));
    overlay.addEventListener('pointerup', () => this.onPointerUp());
    const tip = stage.querySelector('#stageTip');
    const op = this.currentOpMeta;
    tip.innerHTML =
      '当前操作：<strong>' +
      op.label +
      '</strong> · ' +
      (op.mode === 'quad' ? '四点定中心/接地线/透视' : '矩形选区') +
      (op.rotate ? ' · 仅绕垂直轴转' : '') +
      (this.product && !this.product.hasModel ? ' · <strong>朝向锁不住</strong>' : '');
  }

  drawOverlay() {
    const overlay = this.root.querySelector('#overlay');
    if (!overlay) return;
    Array.prototype.forEach.call(overlay.querySelectorAll('.shape,.footprint,.handle'), (n) => n.remove());
    const svg = overlay.querySelector('#linkLayer');
    if (svg) svg.innerHTML = '';
    const d = this.drawing;
    if (!d) return;
    if (d.points && d.points.length) {
      const pts = d.points;
      if (pts.length >= 3 && svg) {
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pts.map((p) => p.x + '%,' + p.y + '%').join(' '));
        poly.setAttribute('fill', 'rgba(37,99,235,0.15)');
        poly.setAttribute('stroke', '#2563eb');
        poly.setAttribute('stroke-width', '2');
        svg.appendChild(poly);
      }
      const scaled = this.scaledPoints(pts, this.scalePct);
      const fp = document.createElement('div');
      fp.className = 'footprint';
      const xs = scaled.map((p) => p.x);
      const ys = scaled.map((p) => p.y);
      fp.style.left = Math.min.apply(null, xs) + '%';
      fp.style.top = Math.min.apply(null, ys) + '%';
      fp.style.width = Math.max.apply(null, xs) - Math.min.apply(null, xs) + '%';
      fp.style.height = Math.max.apply(null, ys) - Math.min.apply(null, ys) + '%';
      overlay.appendChild(fp);
      pts.forEach((p, i) => {
        const h = document.createElement('div');
        h.className = 'handle' + (i < 2 ? ' primary' : '');
        h.style.left = p.x + '%';
        h.style.top = p.y + '%';
        h.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          this.dragIdx = i;
          overlay.setPointerCapture(ev.pointerId);
        });
        overlay.appendChild(h);
      });
    } else if (d.rect) {
      const r = d.rect;
      const box = document.createElement('div');
      box.className = 'shape';
      box.style.left = Math.min(r.x1, r.x2) + '%';
      box.style.top = Math.min(r.y1, r.y2) + '%';
      box.style.width = Math.abs(r.x2 - r.x1) + '%';
      box.style.height = Math.abs(r.y2 - r.y1) + '%';
      overlay.appendChild(box);
    }
  }

  scaledPoints(points, scalePct) {
    const s = (scalePct || 100) / 100;
    const cx = points.reduce((a, p) => a + p.x, 0) / points.length;
    const cy = points.reduce((a, p) => a + p.y, 0) / points.length;
    return points.map((p) => ({ x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s }));
  }

  onPointerDown(e) {
    if (this.busy) return;
    const overlay = this.root.querySelector('#overlay');
    const rect = overlay.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (this.dragIdx != null) return;
    if (this.toolMode === 'quad') {
      if (!this.drawing || !this.drawing.points) this.drawing = { points: [] };
      if (this.drawing.points.length < 4) {
        this.drawing.points.push({ x: x, y: y });
        this.drawOverlay();
      }
    } else {
      this.drawing = { rect: { x1: x, y1: y, x2: x, y2: y }, _drag: true };
      this.drawOverlay();
    }
  }

  onPointerMove(e) {
    const overlay = this.root.querySelector('#overlay');
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (this.dragIdx != null && this.drawing && this.drawing.points) {
      this.drawing.points[this.dragIdx] = { x: x, y: y };
      this.drawOverlay();
      return;
    }
    if (this.drawing && this.drawing._drag && this.drawing.rect) {
      this.drawing.rect.x2 = x;
      this.drawing.rect.y2 = y;
      this.drawOverlay();
    }
  }

  onPointerUp() {
    this.dragIdx = null;
    if (this.drawing && this.drawing._drag) delete this.drawing._drag;
    this.renderRight();
    this.renderStage();
  }

  renderFrames() {
    const el = this.root.querySelector('#frames');
    const img = this.activeImage;
    if (!img) {
      el.innerHTML = '<div class="faint" style="font-size:11px">无栈</div>';
      return;
    }
    let html =
      '<div class="frame-card ' +
      (!img.activeFrameId ? 'active' : '') +
      '" data-frame="__origin"><img class="fimg" src="' +
      img.dataUrl +
      '" alt="" /><div class="fmeta"><b>原图</b>父快照</div></div>';
    html += img.stack
      .map((f) => {
        return (
          '<div class="frame-card ' +
          (img.activeFrameId === f.id ? 'active' : '') +
          '" data-frame="' +
          f.id +
          '"><img class="fimg" src="' +
          (f.status === 'success' ? f.dataUrl : this.parentDataUrl || img.dataUrl) +
          '" alt="" /><div class="fmeta"><b>' +
          escapeHtml(f.opLabel || f.op || '帧') +
          '</b>' +
          (f.status === 'fail' ? '<span class="badge red">失败</span>' : f.parentChanged ? '<span class="badge warn">父帧已变</span>' : '<span class="badge green">成功</span>') +
          '</div></div>'
        );
      })
      .join('');
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('[data-frame]'), (n) => {
      n.onclick = () => {
        const v = n.getAttribute('data-frame');
        img.activeFrameId = v === '__origin' ? null : v;
        this.renderFrames();
        this.renderStage();
        this.renderRight();
      };
    });
  }

  renderRight() {
    const col = this.root.querySelector('#rightCol');
    const op = this.currentOpMeta;
    const frame = this.activeFrame;
    const needRotate = op.rotate && (op.id === 'replace' || op.id === 'add');
    let html = '<div class="panel-section"><h3>操作参数 <span class="badge blue">' + op.label + '</span></h3>';
    html +=
      '<div class="kv"><span>选区</span><span class="mono">' +
      (op.mode === 'quad' ? ((this.drawing && this.drawing.points && this.drawing.points.length) || 0) + '/4 点' : this.drawing && this.drawing.rect ? '矩形已框' : '未框') +
      '</span></div>';
    if (needRotate) {
      html +=
        '<div class="field"><label>朝向 Yaw（只绕垂直轴）</label><div class="row">' +
        '<input type="range" min="0" max="360" value="' +
        this.yaw +
        '" id="yawRange" /><span class="val" id="yawVal">' +
        this.yaw +
        '°</span></div></div>' +
        '<div class="field"><label>缩放（四边形 100% 为基准）</label><div class="row">' +
        '<input type="range" min="40" max="200" value="' +
        this.scalePct +
        '" id="scaleRange" /><span class="val" id="scaleVal">' +
        this.scalePct +
        '%</span></div></div>' +
        '<div class="notice">模型只看见烘焙草稿与固定机位朝向参考，不看见滑块数字。</div>';
    }
    if (op.id === 'install') {
      html +=
        '<div class="notice">安装必须有产品照片，不用模型，不弹旋转器。</div>' +
        '<button class="btn sm" id="btnProductPhoto">' +
        (this.productPhotoDataUrl ? '更换产品照片' : '选择产品照片') +
        '</button>';
    }
    if (op.id === 'replace' || op.id === 'add') {
      html +=
        '<div class="field"><label>家具 / 产品（素材库，须带模型）</label><select id="productSelect"><option value="">— 选择 —</option>' +
        FURNITURE_CATALOG.map((f) => {
          return (
            '<option value="' +
            f.id +
            '"' +
            (this.product && this.product.id === f.id ? ' selected' : '') +
            '>' +
            f.name +
            (f.hasModel ? '' : '（无模型）') +
            '</option>'
          );
        }).join('') +
        '</select>';
      if (this.product && !this.product.hasModel) {
        html += '<div class="notice warn mt8">只有产品照片、没有模型：允许跑，但<strong>朝向锁不住</strong>。</div>';
      }
      html += '</div>';
    }
    if (op.id === 'outpaint') {
      html +=
        '<div class="field"><label>固定比例</label><div class="chip-row">' +
        OUTPAINT_RATIOS.map((r) => {
          return '<button class="chip ' + (this.outpaintRatio === r.id ? 'active' : '') + '" data-ratio="' + r.id + '">' + r.label + '</button>';
        }).join('') +
        '</div></div>';
    }
    html +=
      '<div class="field"><label>材质</label><div class="chip-row">' +
      '<button class="chip ' +
      (this.materialMode === 'surround' ? 'active' : '') +
      '" data-mat="surround">贴合周围</button>' +
      '<button class="chip ' +
      (this.materialMode === 'ref' ? 'active' : '') +
      '" data-mat="ref">原图另框参考</button></div></div>';
    html +=
      '<div class="row"><button class="btn primary grow" id="btnRun"' +
      (this.canRun() && !this.busy ? '' : ' disabled') +
      '>冻住草稿并生成</button>' +
      '<button class="btn sm" id="btnForceFail">模拟失败</button></div>';
    if (this.busy) html += '<div class="notice mt8">正在跑策略 B…</div>';
    html += '</div>';
    html += '<div class="panel-section"><h3>详情对话</h3><div class="chat">' + this.chatHtml(frame) + '</div></div>';
    html +=
      '<div class="panel-section"><h3>保存</h3><div class="notice">栈存在任务上，不自动进素材库。</div>' +
      '<button class="btn primary" id="btnSaveLib" style="width:100%">保存到素材库（真写入）</button></div>';
    col.innerHTML = html;
    this.bindRight();
  }

  chatHtml(frame) {
    if (!frame || !frame.detail || !frame.detail.length) {
      return '<div class="empty"><div class="icon">💬</div><p>每次模型调用会在这里留下对话</p></div>';
    }
    return frame.detail
      .map((m) => {
        return (
          '<div class="msg ' +
          (m.ok === false ? 'fail' : '') +
          '"><div class="msg-head"><span class="mode">' +
          escapeHtml(m.mode) +
          '</span><span class="time">' +
          new Date(m.at).toLocaleTimeString() +
          '</span></div><div class="prompt">' +
          escapeHtml(m.prompt || '') +
          '</div><div class="io">' +
          (m.inputs || [])
            .map((src, i) => {
              return '<figure><img src="' + src + '" alt="" /><figcaption>' + escapeHtml((m.inputLabels && m.inputLabels[i]) || '输入') + '</figcaption></figure>';
            })
            .join('') +
          (m.output ? '<figure><img src="' + m.output + '" alt="" /><figcaption>结果</figcaption></figure>' : '') +
          (m.orientationRef ? '<figure><img src="' + m.orientationRef + '" alt="" /><figcaption>朝向参考</figcaption></figure>' : '') +
          '</div>' +
          (m.reason ? '<div class="reason">' + escapeHtml(m.reason) + '</div>' : '') +
          '</div>'
        );
      })
      .join('');
  }

  bindRight() {
    const col = this.root.querySelector('#rightCol');
    Array.prototype.forEach.call(col.querySelectorAll('[data-ratio]'), (b) => {
      b.onclick = () => {
        this.outpaintRatio = b.getAttribute('data-ratio');
        this.renderRight();
      };
    });
    Array.prototype.forEach.call(col.querySelectorAll('[data-mat]'), (b) => {
      b.onclick = () => {
        this.materialMode = b.getAttribute('data-mat');
        this.renderRight();
      };
    });
    const yawRange = col.querySelector('#yawRange');
    if (yawRange) {
      yawRange.oninput = () => {
        this.yaw = Number(yawRange.value);
        const v = col.querySelector('#yawVal');
        if (v) v.textContent = this.yaw + '°';
        this.drawOverlay();
      };
    }
    const scaleRange = col.querySelector('#scaleRange');
    if (scaleRange) {
      scaleRange.oninput = () => {
        this.scalePct = Number(scaleRange.value);
        const v = col.querySelector('#scaleVal');
        if (v) v.textContent = this.scalePct + '%';
        this.drawOverlay();
      };
    }
    const productSelect = col.querySelector('#productSelect');
    if (productSelect) {
      productSelect.onchange = () => {
        this.product = FURNITURE_CATALOG.find((f) => f.id === productSelect.value) || null;
        this.renderRight();
        this.renderStage();
      };
    }
    const btnProductPhoto = col.querySelector('#btnProductPhoto');
    if (btnProductPhoto) btnProductPhoto.onclick = () => this.root.querySelector('#fileProduct').click();
    const btnRun = col.querySelector('#btnRun');
    if (btnRun) btnRun.onclick = () => this.runOp({ forceFail: false });
    const btnForceFail = col.querySelector('#btnForceFail');
    if (btnForceFail) btnForceFail.onclick = () => this.runOp({ forceFail: true });
    const btnSaveLib = col.querySelector('#btnSaveLib');
    if (btnSaveLib) btnSaveLib.onclick = () => this.saveToLibrary(false);
  }

  canRun() {
    if (this.busy) return false;
    if (!this.activeImage) return false;
    const op = this.currentOpMeta;
    if (op.mode === 'quad' && (!this.drawing || !this.drawing.points || this.drawing.points.length < 4)) return false;
    if (op.mode === 'rect' && (!this.drawing || !this.drawing.rect)) return false;
    if (op.id === 'install' && !this.productPhotoDataUrl) return false;
    if (op.id === 'replace' && !this.product && !this.productPhotoDataUrl) return false;
    return true;
  }

  async addImages(files) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const dataUrl = await fileToDataUrl(f);
      const im = await loadImage(dataUrl);
      const entry = newImageEntry(f.name, dataUrl, im.naturalWidth, im.naturalHeight);
      this.task.images.push(entry);
      if (!this.activeImageId) this.activeImageId = entry.id;
    }
    this.store.emit();
    this.renderAll();
    this.toast('已加入 ' + files.length + ' 张图片', 'ok');
  }

  loadSample() {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 800;
    const ctx = c.getContext('2d');
    const wall = ctx.createLinearGradient(0, 0, 0, 800);
    wall.addColorStop(0, '#d9dee8');
    wall.addColorStop(0.55, '#eef1f6');
    wall.addColorStop(1, '#c5ccd8');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#b7a292';
    ctx.fillRect(0, 520, 1200, 280);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(520, 470, 420, 160);
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    const entry = newImageEntry('样板客厅.jpg', dataUrl, 1200, 800);
    this.task.images.push(entry);
    this.activeImageId = entry.id;
    this.activeOp = 'replace';
    this.toolMode = 'quad';
    this.drawing = {
      points: [
        { x: 42, y: 72 },
        { x: 78, y: 70 },
        { x: 82, y: 88 },
        { x: 38, y: 90 },
      ],
    };
    this.product = FURNITURE_CATALOG[0];
    this.store.emit();
    this.renderAll();
    this.toast('样板已载入', 'ok');
  }

  copyStackBranch() {
    const img = this.activeImage;
    if (!img) return;
    const idx = this.task.images.findIndex((x) => x.id === img.id);
    const clone = {
      id: uid('img'),
      name: img.name + ' · 分支',
      dataUrl: img.dataUrl,
      w: img.w,
      h: img.h,
      stack: img.stack.map((f) => Object.assign({}, f)),
      activeFrameId: img.activeFrameId,
      copiedFrom: img.id,
      batchFail: null,
    };
    this.task.images.splice(idx + 1, 0, clone);
    this.activeImageId = clone.id;
    this.store.emit();
    this.renderAll();
    this.toast('已复制为新线性栈', 'ok');
  }

  async runOp(opts) {
    opts = opts || {};
    const img = this.activeImage;
    if (!img) return;
    const op = this.currentOpMeta;
    const forceFail = !!opts.forceFail;
    const strategyC = !!opts.strategyC;
    if (!this.canRun() && !forceFail) {
      this.toast('请先完成选区/必要素材', 'err');
      return;
    }
    this.busy = true;
    this.renderRight();
    const parentUrl = this.parentDataUrl;
    const mid = uid('msg');
    try {
      const result = await runStackOp({
        op: this.activeOp,
        parentDataUrl: parentUrl,
        drawing: this.drawing,
        yaw: this.yaw,
        scalePct: this.scalePct,
        product: this.product,
        productPhotoDataUrl: this.productPhotoDataUrl,
        materialRef: this.materialRef,
        outpaintRatio: this.outpaintRatio,
        strategyC: strategyC,
        promptOverride: this.editedPrompt,
        forceFail: forceFail,
        preferServer: false,
      });
      const outputUrl = result.ok ? result.outputUrl : null;
      const failReason = result.ok ? null : result.reason || '生成失败';
      const prompt = result.prompt;
      const orientationRef = result.orientationRef || null;
      const inputs = result.inputs || [{ src: parentUrl, label: '父快照' }];
      const frozen = result.frozen || { inputs: { parentUrl: parentUrl }, params: {}, outputs: outputUrl };
      const detailMsg = {
        mid: mid,
        mode: op.label + ' · 策略' + (strategyC ? 'C→B' : 'B') + ' · ' + (result.via === 'server' ? '服务端' : '本地'),
        prompt: prompt,
        inputs: inputs.map((i) => i.src),
        inputLabels: inputs.map((i) => i.label),
        output: outputUrl,
        orientationRef: orientationRef,
        ok: !failReason,
        reason: failReason,
        at: Date.now(),
        strategyC: strategyC,
      };
      const prevSuccess = img.stack.filter((f) => f.status === 'success').slice(-1)[0];
      const frame = newFrame({
        parentId: prevSuccess ? prevSuccess.id : null,
        op: this.activeOp,
        opLabel: op.label,
        dataUrl: outputUrl || parentUrl,
        status: failReason ? 'fail' : 'success',
        failReason: failReason,
        prompt: prompt,
        frozen: frozen,
        history: prevSuccess ? (prevSuccess.history || []).concat([prevSuccess.dataUrl]) : [],
        orientationRef: orientationRef,
        detail: [detailMsg],
      });
      img.stack.push(frame);
      img.activeFrameId = frame.id;
      if (prevSuccess) {
        img.stack.forEach((f) => {
          if (f.parentId === prevSuccess.id && f.id !== frame.id) f.parentChanged = true;
        });
      }
      this.store.emit();
      this.toast(failReason ? '失败：栈顶保持上一张成功' : '成功：新结果已到栈顶', failReason ? 'err' : 'ok');
    } catch (e) {
      console.error(e);
      this.toast('执行异常：' + e.message, 'err');
    } finally {
      this.busy = false;
      this.forceFailNext = false;
      this.renderAll();
    }
  }

  async saveToLibrary(frameOnly) {
    const img = this.activeImage;
    if (!img) return;
    const top = img.stack.filter((f) => f.status === 'success').slice(-1)[0] || { dataUrl: img.dataUrl };
    const title = frameOnly ? img.name + ' · ' + (top.opLabel || '帧') : img.name;
    const fileName = (img.name || 'workshop').replace(/\.[^.]+$/, '') + '.jpg';
    try {
      this.busy = true;
      this.renderRight();
      const res = await saveWorkshopMedia({
        dataUrl: top.dataUrl,
        fileName: fileName,
        title: title,
        source: 'workshop',
        clientAssetId: this.task.id,
      });
      const fid = res && (res.fid || res.assetId || res.id);
      this.store.saveToLibrary({
        kind: 'image',
        title: title,
        dataUrl: top.dataUrl,
        sourceTaskId: this.task.id,
        meta: { stackLen: img.stack.length, frameOnly: frameOnly, fid: fid, remote: true },
      });
      this.toast(fid ? '已写入素材库 fid=' + fid : '已写入素材库', 'ok');
    } catch (e) {
      this.toast('入库失败：' + (e && e.message), 'err');
    } finally {
      this.busy = false;
      this.renderRight();
    }
  }
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

export { defaultPrompt };
