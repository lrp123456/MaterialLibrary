/**
 * mediaFrameExtractor.js
 * 常用媒体工具箱 - 极速逐帧解码与高精度抽帧引擎
 *
 * 核心设计：
 * 1. 双引擎：WebCodecs（mediabunny 硬解寻帧）一级，增强 HTML5 video 二级，失败自动回落；
 * 2. WebCodecs 通道会并行挂载同一个 blob: URL 到隐藏 <video>：
 *    - 寻帧/预览走 VideoSampleSink（1~3ms、可精确到帧）；
 *    - 播放（含声音）与全分辨率原画导出复用该 video，绝不再画到旧样片；
 * 3. LRU 仅缓存「预览尺寸」ImageBitmap（24 张上限），不缓存全分辨率帧，防止显存爆炸；
 * 4. 寻帧 350ms 看门狗超时绝不把旧帧当新帧上画/入缓存；
 * 5. 胶片条/批量抽帧带 generation 运行令牌，切源即作废，HTML5 通道出真实缩略图而非假占位；
 * 6. mediabunny / WGSL 增强器均为按需动态 import，不进主包；
 * 7. 本模块创建的 blob: URL 全部登记，换源/销毁时回收。
 */

// mediabunny 较重（含全部封装器），仅在选中本地视频且 WebCodecs 可用时异步加载
let _mbModulePromise = null;
function loadMediabunny() {
  if (!_mbModulePromise) _mbModulePromise = import('mediabunny');
  return _mbModulePromise;
}

const LRU_MAX_FRAMES = 24;                 // 预览尺寸位图上限（1080p 下约 24×8MB 内）
const BATCH_INTERVAL_MAX = 240;            // 定时间隔抽帧硬上限，防止 0.5s×10min 产出上千张全尺寸 PNG
const SEEK_WATCHDOG_MS = 350;

class LRUFrameCache {
  constructor(maxSize = LRU_MAX_FRAMES) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }

  set(key, val) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      const oldVal = this.cache.get(oldestKey);
      if (oldVal && typeof oldVal.close === 'function') {
        try { oldVal.close(); } catch (_) {}
      }
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, val);
  }

  clear() {
    for (const val of this.cache.values()) {
      if (val && typeof val.close === 'function') {
        try { val.close(); } catch (_) {}
      }
    }
    this.cache.clear();
  }
}

export class MediaFrameExtractor {
  constructor(options = {}) {
    this.videoEl = options.videoElement || null;
    this.canvasEl = options.canvasElement || null;
    this.stageEl = options.stageElement || null;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || (() => {});
    this.onFrameTick = options.onFrameTick || (() => {});

    this.cache = new LRUFrameCache(LRU_MAX_FRAMES);

    // 状态属性
    this.strategy = 'idle'; // 'webcodecs' | 'html5' | 'error' | 'idle'
    this.isLoading = false;
    this.isSeeking = false;
    this.isPlaying = false;
    this.videoWidth = 1920;
    this.videoHeight = 1080;
    this.duration = 10;
    this.fps = 30.0;
    this.currentTime = 0;
    this.currentFrameNumber = 0;
    this.sourceType = 'default';
    this.sourceName = '';
    this.rawFile = null;

    // WGSL 加速器（按需动态 import 后实例化）
    this.wgslEnhancer = null;
    this.useWgsl = false;
    this.wgslCanvasEl = null;

    // mediabunny 实例
    this.mbInput = null;
    this.mbTrack = null;
    this.mbSink = null;

    // 离屏渲染缓冲 Canvas（全分辨率导出）
    this.fullExportCanvas = document.createElement('canvas');
    this.fullExportCtx = this.fullExportCanvas.getContext('2d', { willReadFrequently: true });

    // HTML5 事件清理句柄与播放循环
    this._cleanups = [];
    this._playbackLoopId = 0;
    this._latestSeekTarget = null;
    this._seekWatchdog = null;

    // 运行令牌：任何异步任务在被新源取代后必须作废
    this._loadGeneration = 0;
    this._filmstripRun = 0;
    this._batchRun = 0;

    // 本模块创建并持有的 blob: URL
    this._ownedUrls = [];
  }

  get totalFrames() {
    return Math.max(1, Math.round(this.duration * this.fps));
  }

  formatTimecode(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const remainderS = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    return `${String(m).padStart(2, '0')}:${String(remainderS).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  isWebCodecsAvailable() {
    return typeof window !== 'undefined' &&
           typeof window.VideoDecoder !== 'undefined' &&
           Boolean(window.isSecureContext);
  }

  attachElements({ videoElement, canvasElement, wgslCanvasElement, stageElement }) {
    if (videoElement) this.videoEl = videoElement;
    if (canvasElement) this.canvasEl = canvasElement;
    if (wgslCanvasElement) this.wgslCanvasEl = wgslCanvasElement;
    if (stageElement) this.stageEl = stageElement;
  }

  _createObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    this._ownedUrls.push(url);
    return url;
  }

  _revokeOwnedUrls() {
    for (const url of this._ownedUrls) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
    this._ownedUrls = [];
  }

  /**
   * 开启或关闭 WGSL GPU 增强（增强器模块按需加载）
   */
  async toggleWgslEnhancer(enable, wgslCanvas) {
    if (wgslCanvas) this.wgslCanvasEl = wgslCanvas;
    if (!enable) {
      this.useWgsl = false;
      this.renderCurrent();
      return true;
    }

    if (!this.wgslCanvasEl) {
      throw new Error('未检测到专属 WebGPU Canvas 画板');
    }

    if (!this.wgslEnhancer) {
      const { WgslVideoEnhancer } = await import('./wgslVideoEnhancer');
      this.wgslEnhancer = new WgslVideoEnhancer();
    }
    const ok = await this.wgslEnhancer.init(this.wgslCanvasEl);
    if (!ok) {
      this.useWgsl = false;
      return false;
    }
    this.useWgsl = true;
    this.renderCurrent();
    return true;
  }

  /**
   * 载入视频源
   */
  async loadSource(sourceConfig) {
    const gen = ++this._loadGeneration;
    this._filmstripRun++;       // 作废在途胶片条
    this._batchRun++;           // 作废在途批量抽帧
    this.stopPlayback();
    this.isLoading = true;
    this.sourceType = sourceConfig.kind || 'default';
    this.sourceName = sourceConfig.name || '未知视频';
    this.rawFile = sourceConfig.file || null;
    this.currentTime = 0;
    this.currentFrameNumber = 0;
    this.cache.clear();

    this.onStatusChange({
      loading: true,
      strategy: this.strategy,
      message: '正在精准解析视频轨道与色彩空间...'
    });

    this._disposeMediabunny();
    this._revokeOwnedUrls();    // 上一源的 blob URL 在新源开始接管时回收

    let webcodecsSuccess = false;

    // 1. 尝试 WebCodecs 一级火箭（仅本地文件，mediabunny 按需加载）
    if (this.rawFile && this.isWebCodecsAvailable()) {
      try {
        this.onStatusChange({ loading: true, strategy: 'webcodecs', message: '正在初始化 GPU 硬件加速解码器...' });
        await this._initWebCodecsFromFile(this.rawFile);
        webcodecsSuccess = true;
      } catch (e) {
        console.warn('[FrameExtractor] WebCodecs 初始化失败，将平滑回退到增强 HTML5 寻帧:', e);
        webcodecsSuccess = false;
      }
    }

    if (gen !== this._loadGeneration) return; // 已被更新的 loadSource 取代

    if (webcodecsSuccess) {
      this.strategy = 'webcodecs';

      // 关键：把同一个本地文件以 blob URL 挂到隐藏 video 上，供「带声音播放」与
      // 「全分辨率原画导出」复用；失败不影响 WebCodecs 寻帧本身
      try {
        const syncUrl = this._createObjectUrl(this.rawFile);
        await this._initHTML5Video(syncUrl, true);
      } catch (e) {
        console.warn('[FrameExtractor] 并行导出 video 挂载失败，原画导出将回退预览画布:', e);
      }
      if (gen !== this._loadGeneration) return;

      this.isLoading = false;
      this.onStatusChange({
        loading: false,
        strategy: 'webcodecs',
        message: '⚡ WebCodecs GPU 硬件解码就绪 (1~3ms)'
      });
      await this.seekToFrame(0, true);
      return;
    }

    // 2. 增强 HTML5 二级火箭
    this.strategy = 'html5';
    try {
      let finalUrl = sourceConfig.url;
      if (!finalUrl && this.rawFile) {
        finalUrl = this._createObjectUrl(this.rawFile);
      }
      await this._initHTML5Video(finalUrl, sourceConfig.kind === 'local');
      if (gen !== this._loadGeneration) return;
      this.isLoading = false;
      this.onStatusChange({
        loading: false,
        strategy: 'html5',
        message: `🎬 HTML5 极速寻帧引擎就绪 (带 ${LRU_MAX_FRAMES} 帧预览级内存热缓存)`
      });
      await this.seekToFrame(0, true);
    } catch (err) {
      if (gen !== this._loadGeneration) return;
      this.isLoading = false;
      this.strategy = 'error';
      this.onStatusChange({
        loading: false,
        strategy: 'error',
        message: '视频格式或解码异常'
      });
      this.onError(err);
    }
  }

  async _initWebCodecsFromFile(file) {
    const mb = await loadMediabunny();
    const input = new mb.Input({
      source: new mb.BlobSource(file),
      formats: mb.ALL_FORMATS,
    });

    try {
      const duration = await input.computeDuration();
      const videoTrack = await input.getPrimaryVideoTrack();

      if (!videoTrack) {
        throw new Error('未找到视频轨道');
      }

      // 部分浏览器 canDecode 会误报 false，先捕获
      let canDecode = false;
      try {
        canDecode = await videoTrack.canDecode();
      } catch (_) {}

      if (!canDecode) {
        throw new Error('WebCodecs 硬件管线暂不支持此编码 profile');
      }

      this.duration = duration || 10;
      this.videoWidth = videoTrack.displayWidth || 1920;
      this.videoHeight = videoTrack.displayHeight || 1080;

      let fps = 30.0;
      try {
        const stats = await videoTrack.computePacketStats(40);
        if (stats?.averagePacketRate && stats.averagePacketRate > 0) {
          fps = Math.round(stats.averagePacketRate * 100) / 100;
        }
      } catch (_) {}
      this.fps = fps || 30.0;

      this.mbSink = new mb.VideoSampleSink(videoTrack);
      this.mbInput = input;
      this.mbTrack = videoTrack;
    } catch (e) {
      // computeDuration/getTrack 中途失败时 input 尚未挂到 this，必须就地释放
      try { input.dispose(); } catch (_) {}
      throw e;
    }
  }

  _initHTML5Video(url, isLocalFile = false) {
    return new Promise((resolve, reject) => {
      const v = this.videoEl;
      if (!v) return reject(new Error('未找到 video DOM 节点'));
      if (!url) return reject(new Error('缺少视频 URL'));

      this._clearHTML5Listeners();

      if (isLocalFile || url.startsWith('blob:') || url.startsWith('data:')) {
        v.removeAttribute('crossorigin');
      } else {
        v.setAttribute('crossorigin', 'anonymous');
      }

      let resolved = false;

      const applyMeta = () => {
        this.duration = v.duration || 10;
        this.videoWidth = v.videoWidth || 1920;
        this.videoHeight = v.videoHeight || 1080;
      };

      const onReady = () => {
        if (!resolved) {
          resolved = true;
          applyMeta();
          resolve();
        }
      };

      const onError = () => {
        const errCode = v.error ? v.error.code : 'UNKNOWN';
        const errMsg = v.error ? v.error.message : '无法解析的媒体数据';
        if (!resolved) {
          resolved = true;
          reject(new Error(`视频加载失败 [${errCode}]: ${errMsg}`));
        }
      };

      v.addEventListener('loadedmetadata', applyMeta);
      v.addEventListener('loadeddata', onReady);
      v.addEventListener('canplay', onReady);
      v.addEventListener('error', onError);

      this._cleanups.push(() => {
        v.removeEventListener('loadedmetadata', applyMeta);
        v.removeEventListener('loadeddata', onReady);
        v.removeEventListener('canplay', onReady);
        v.removeEventListener('error', onError);
      });

      v.preload = 'auto';
      v.playsInline = true;
      v.muted = false; // 播放需要声音；点击触发不受自动播放策略限制
      v.src = url;
      v.load();

      const readyTimer = setTimeout(() => {
        if (!resolved) {
          if (v.readyState >= 1) {
            resolved = true;
            applyMeta();
            resolve();
          } else {
            resolved = true;
            reject(new Error('视频加载超时'));
          }
        }
      }, 7000);
      this._cleanups.push(() => clearTimeout(readyTimer));
    });
  }

  _computeTargetPreviewSize() {
    const stage = this.stageEl;
    const availW = stage ? stage.clientWidth : 800;
    const availH = stage ? stage.clientHeight : 480;
    const maxEdge = 1280;

    const scale = Math.min(availW / this.videoWidth, availH / this.videoHeight, 1);
    let tw = Math.max(2, Math.round(this.videoWidth * scale));
    let th = Math.max(2, Math.round(this.videoHeight * scale));

    const edge = Math.max(tw, th);
    if (edge > maxEdge) {
      const k = maxEdge / edge;
      tw = Math.max(2, Math.round(tw * k));
      th = Math.max(2, Math.round(th * k));
    }
    return [tw, th];
  }

  /**
   * 将当前帧渲染到主预览画布
   * 注意：WGSL 零拷贝通道只接受「真实 video 元素」。缓存位图/离屏 canvas
   * 必须走普通 2D 绘制，否则会被 live video 的旧画面覆盖。
   */
  _paintToCanvas(source) {
    if (this.useWgsl &&
        source instanceof HTMLVideoElement &&
        this.wgslEnhancer && this.wgslEnhancer.isReady &&
        this.wgslCanvasEl) {
      const ok = this.wgslEnhancer.renderFrame(source, ...this._computeTargetPreviewSize());
      if (ok) return;
    }

    const c = this.canvasEl;
    if (!c) return;

    const [tw, th] = this._computeTargetPreviewSize();
    if (c.width !== tw || c.height !== th) {
      c.width = tw;
      c.height = th;
    }

    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, tw, th);
    ctx.drawImage(source, 0, 0, tw, th);
  }

  renderCurrent() {
    const cached = this.cache.get(this.currentFrameNumber);
    if (cached) {
      this._paintToCanvas(cached);
      return;
    }
    if (this.videoEl && this.videoEl.videoWidth > 0) {
      this._paintToCanvas(this.videoEl);
    }
  }

  // ===========================================================================
  // 播放控制
  // ===========================================================================
  startPlayback(playbackRate = 1.0) {
    const v = this.videoEl;
    if (!v || !v.src) return;

    this.isPlaying = true;
    v.playbackRate = playbackRate;

    const playLoop = () => {
      if (!this.isPlaying || v.paused || v.ended) {
        this.isPlaying = false;
        return;
      }

      this._paintToCanvas(v);
      this.currentTime = v.currentTime;
      this.currentFrameNumber = Math.max(0, Math.min(this.totalFrames - 1, Math.round(v.currentTime * this.fps)));

      this.onFrameTick({
        currentTime: this.currentTime,
        frameNumber: this.currentFrameNumber
      });

      if (typeof v.requestVideoFrameCallback === 'function') {
        this._playbackLoopId = v.requestVideoFrameCallback(playLoop);
      } else {
        this._playbackLoopId = requestAnimationFrame(playLoop);
      }
    };

    // WebCodecs 通道下并行 video 可能停在别的时间点，先对齐再播
    try {
      if (Math.abs(v.currentTime - this.currentTime) > 0.25) v.currentTime = this.currentTime;
    } catch (_) {}

    v.play().then(() => {
      if (typeof v.requestVideoFrameCallback === 'function') {
        this._playbackLoopId = v.requestVideoFrameCallback(playLoop);
      } else {
        this._playbackLoopId = requestAnimationFrame(playLoop);
      }
    }).catch((err) => {
      console.warn('[FrameExtractor] 播放失败:', err);
      this.isPlaying = false;
    });
  }

  stopPlayback() {
    this.isPlaying = false;
    const v = this.videoEl;
    if (v && !v.paused) {
      v.pause();
    }
    if (v && typeof v.cancelVideoFrameCallback === 'function' && this._playbackLoopId) {
      try { v.cancelVideoFrameCallback(this._playbackLoopId); } catch (_) {}
    } else if (this._playbackLoopId) {
      cancelAnimationFrame(this._playbackLoopId);
    }
    this._playbackLoopId = 0;

    // 暂停后记录当前画面
    this.renderCurrent();
  }

  // ===========================================================================
  // 智能寻帧与切帧（防抖丢帧）
  // ===========================================================================
  async seekToFrame(frameNumber, isPrecise = true) {
    const clampedFrame = Math.max(0, Math.min(this.totalFrames - 1, Math.round(frameNumber)));
    this.currentFrameNumber = clampedFrame;
    const targetTimestamp = clampedFrame / this.fps;
    this.currentTime = Math.max(0, Math.min(this.duration, targetTimestamp));

    // 1. 命中 LRU 内存缓存：0ms 瞬间响应
    const cachedBitmap = this.cache.get(clampedFrame);
    if (cachedBitmap) {
      this._paintToCanvas(cachedBitmap);
      this._syncVideoTime(targetTimestamp);
      return;
    }

    // 2. WebCodecs 通道
    if (this.strategy === 'webcodecs' && this.mbSink) {
      try {
        const sample = await this.mbSink.getSample(this.currentTime);
        if (sample) {
          const [tw, th] = this._computeTargetPreviewSize();
          const tempC = document.createElement('canvas');
          tempC.width = tw;
          tempC.height = th;
          sample.draw(tempC.getContext('2d'), 0, 0, tw, th);

          this._paintToCanvas(tempC);

          if (typeof createImageBitmap === 'function') {
            createImageBitmap(tempC).then((bmp) => {
              this.cache.set(clampedFrame, bmp);
            }).catch(() => {});
          }

          sample.close();
          // 并行隐藏 video 同步到同一时间点（不阻塞预览），保证播放/导出位置正确
          this._syncVideoTime(targetTimestamp);
          return;
        }
      } catch (err) {
        console.warn('[FrameExtractor] WebCodecs 单帧解码异常:', err);
      }
    }

    // 3. HTML5 Video 寻帧（带丢帧调度）
    await this._seekHTML5VideoScheduled(this.currentTime, clampedFrame, isPrecise);
  }

  /**
   * 非阻塞地把并行/主 video 对齐到目标时间（供播放起点与原画导出使用）
   */
  _syncVideoTime(t) {
    const v = this.videoEl;
    if (!v || v.videoWidth === 0 || v.seeking) return;
    try {
      if (Math.abs(v.currentTime - t) > 0.01) v.currentTime = t;
    } catch (_) {}
  }

  /**
   * 等待并行 video 真正定位到目标时间（全分辨率导出前调用）
   */
  _ensureVideoAt(t) {
    const v = this.videoEl;
    return new Promise((resolve) => {
      if (!v || v.videoWidth === 0) return resolve(false);
      const tol = Math.max(0.04, 1.5 / this.fps);
      if (!v.seeking && Math.abs(v.currentTime - t) <= tol) return resolve(true);

      let done = false;
      const timer = setTimeout(() => finish(false), 800);
      const onSeeked = () => finish(Math.abs(v.currentTime - t) <= tol * 2);
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeEventListener('seeked', onSeeked);
        resolve(ok);
      };
      v.addEventListener('seeked', onSeeked);
      try { v.currentTime = t; } catch (_) { finish(false); }
    });
  }

  /**
   * 丢弃过时请求的调度寻帧。
   * 看门狗超时且画面未到位时：不上画、不入缓存，绝不把旧帧冒充新帧。
   */
  _seekHTML5VideoScheduled(targetTime, frameNumber, isPrecise) {
    this._latestSeekTarget = { targetTime, frameNumber, isPrecise };

    if (this.isSeeking) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.isSeeking = true;
      const v = this.videoEl;
      if (!v) {
        this.isSeeking = false;
        return resolve();
      }

      let settled = false;
      const tolerance = Math.max(0.05, 1.5 / this.fps);

      const finishSeek = (timedOut = false) => {
        if (settled) return;
        const closeEnough = Math.abs(v.currentTime - targetTime) <= tolerance;

        if (timedOut && !closeEnough) {
          // 解码器未到位：保留旧画面，等待下一次寻帧/真正的 seeked 事件
          settled = true;
          clearTimeout(this._seekWatchdog);
          this._seekWatchdog = null;
          v.removeEventListener('seeked', onSeeked);
          this.isSeeking = false;
          if (this._latestSeekTarget && this._latestSeekTarget.frameNumber !== frameNumber) {
            const next = this._latestSeekTarget;
            this.seekToFrame(next.frameNumber, next.isPrecise).then(resolve);
          } else {
            resolve();
          }
          return;
        }

        settled = true;
        clearTimeout(this._seekWatchdog);
        this._seekWatchdog = null;
        v.removeEventListener('seeked', onSeeked);
        this.isSeeking = false;

        if (v.videoWidth > 0) {
          this._paintToCanvas(v);

          // 仅真实 seeked（非超时兜底）缓存「预览尺寸」位图，绝不缓存全分辨率帧
          if (!timedOut && isPrecise && typeof createImageBitmap === 'function') {
            const [tw, th] = this._computeTargetPreviewSize();
            const previewC = document.createElement('canvas');
            previewC.width = tw;
            previewC.height = th;
            previewC.getContext('2d').drawImage(v, 0, 0, tw, th);
            createImageBitmap(previewC).then((bmp) => {
              this.cache.set(frameNumber, bmp);
            }).catch(() => {});
          }
        }

        // 检查中途是否有更新的寻帧请求
        if (this._latestSeekTarget && this._latestSeekTarget.frameNumber !== frameNumber) {
          const next = this._latestSeekTarget;
          this.seekToFrame(next.frameNumber, next.isPrecise).then(resolve);
        } else {
          resolve();
        }
      };

      const onSeeked = () => finishSeek(false);
      v.addEventListener('seeked', onSeeked);

      this._seekWatchdog = setTimeout(() => finishSeek(true), SEEK_WATCHDOG_MS);

      // 如果不是必须单帧逐像素精确且支持 fastSeek，走更轻快的 fastSeek
      if (!isPrecise && typeof v.fastSeek === 'function') {
        try {
          v.fastSeek(targetTime);
          return;
        } catch (_) {}
      }

      v.currentTime = targetTime;
    });
  }

  // ===========================================================================
  // 100% 原画全分辨率无损导出
  // WebCodecs：VideoSampleSink 按源物理分辨率直绘；
  // 否则：等待并行隐藏 video 精确定位后按 videoWidth/Height 直绘。
  // ===========================================================================
  async _drawFullFrameToExportCanvas() {
    if (this.isPlaying) this.stopPlayback();

    const w = this.videoWidth || 1920;
    const h = this.videoHeight || 1080;
    this.fullExportCanvas.width = w;
    this.fullExportCanvas.height = h;
    const ctx = this.fullExportCtx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);

    // 1. WebCodecs：从源物理分辨率 sample 直绘（最准确，与播放元素互不干扰）
    if (this.strategy === 'webcodecs' && this.mbSink) {
      try {
        const sample = await this.mbSink.getSample(this.currentTime);
        if (sample) {
          sample.draw(ctx, 0, 0, w, h);
          sample.close();
          return true;
        }
      } catch (err) {
        console.warn('[FrameExtractor] 原画导出 WebCodecs 取帧失败，回退 video:', err);
      }
    }

    // 2. 真实 video 元素（HTML5 主源，或 WebCodecs 的并行同源元素）
    if (this.videoEl && this.videoEl.videoWidth > 0) {
      const ok = await this._ensureVideoAt(this.currentTime);
      if (ok || Math.abs(this.videoEl.currentTime - this.currentTime) <= 0.25) {
        ctx.drawImage(this.videoEl, 0, 0, w, h);
        return true;
      }
    }

    // 3. 最后兜底：当前预览画布（可能为放大图）
    if (this.canvasEl && this.canvasEl.width > 0) {
      ctx.drawImage(this.canvasEl, 0, 0, w, h);
      return true;
    }

    return false;
  }

  async captureFullFrameDataUrl() {
    const ok = await this._drawFullFrameToExportCanvas();
    return ok ? this.fullExportCanvas.toDataURL('image/png', 1.0) : '';
  }

  async captureFullFrameBlob() {
    const ok = await this._drawFullFrameToExportCanvas();
    if (!ok) return null;
    return new Promise((resolve) => {
      this.fullExportCanvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
    });
  }

  // ===========================================================================
  // 胶片微缩条与批量抽帧
  // ===========================================================================
  async generateFilmstrip(count = 12) {
    const runId = ++this._filmstripRun;
    const frames = [];
    const dur = Math.max(0.1, this.duration);
    const step = dur / count;
    const thumbWidth = 160;
    const thumbHeight = Math.round((this.videoHeight / this.videoWidth) * thumbWidth) || 90;

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbWidth;
    thumbCanvas.height = thumbHeight;
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = 'high';

    // 寻帧会移动（可能存在的）并行 video 的位置，记录原位置，结束后恢复
    const restoreTime = this.currentTime;

    try {
      for (let i = 0; i < count; i++) {
        if (runId !== this._filmstripRun) break; // 切源即作废
        const t = Math.min(dur - 0.05, i * step + step * 0.2);
        const frameIndex = Math.round(t * this.fps);
        let dataUrl = '';

        if (this.strategy === 'webcodecs' && this.mbSink) {
          try {
            const sample = await this.mbSink.getSample(t);
            if (sample) {
              thumbCtx.clearRect(0, 0, thumbWidth, thumbHeight);
              sample.draw(thumbCtx, 0, 0, thumbWidth, thumbHeight);
              dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);
              sample.close();
            }
          } catch (_) {}
        }

        // HTML5 主通道 / WebCodecs sample 失败：真实寻帧后绘制，绝不用假占位冒充
        if (!dataUrl && this.videoEl && this.videoEl.videoWidth > 0) {
          await this._seekHTML5VideoScheduled(t, frameIndex, true);
          if (runId !== this._filmstripRun) break;
          thumbCtx.drawImage(this.videoEl, 0, 0, thumbWidth, thumbHeight);
          dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);
        }

        if (!dataUrl) {
          dataUrl = this._generatePlaceholderThumb(i, count);
        }

        frames.push({
          index: i,
          time: t,
          frame: frameIndex,
          timeStr: this.formatTimecode(t),
          dataUrl
        });
      }
    } finally {
      if (runId === this._filmstripRun) {
        this._syncVideoTime(restoreTime);
      }
    }

    return frames;
  }

  _generatePlaceholderThumb(index, total) {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d');

    // 智能感知暗黑 / 明朗 / 护眼三大主题
    let isLight = false;
    let isEyeCare = false;
    if (typeof document !== 'undefined') {
      const cl = document.documentElement.classList;
      isLight = cl.contains('light');
      isEyeCare = cl.contains('eye-care');
    }

    let bgColor = '#0f172a';       // 专业暗黑
    let borderColor = '#27354d';
    let textColor = '#94a3b8';
    let perfColor = '#1e293b';
    let accentDot = '#38bdf8';

    if (isLight) {
      bgColor = '#f1f5f9';         // 白瓷明朗
      borderColor = '#cbd5e1';
      textColor = '#475569';
      perfColor = '#e2e8f0';
      accentDot = '#4f46e5';
    } else if (isEyeCare) {
      bgColor = '#f5eee2';         // 沉香宣纸护眼
      borderColor = '#dbcbaf';
      textColor = '#6d533a';
      perfColor = '#eae0cd';
      accentDot = '#b45309';
    }

    // 1. 背景底板
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 160, 90);

    // 2. 上下微型胶片齿孔 (Film Sprocket Holes)
    ctx.fillStyle = perfColor;
    const holeWidth = 8;
    const holeHeight = 5;
    const holeSpacing = 16;
    for (let x = 6; x < 155; x += holeSpacing) {
      ctx.fillRect(x, 3, holeWidth, holeHeight);
      ctx.fillRect(x, 82, holeWidth, holeHeight);
    }

    // 3. 内侧胶片取景画框
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 11.5, 147, 67);

    // 4. 居中微缩胶片状态文字
    ctx.fillStyle = textColor;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Frame ${index + 1}/${total}`, 80, 45);

    // 5. 左下角极小脉冲提示点
    ctx.fillStyle = accentDot;
    ctx.beginPath();
    ctx.arc(14, 72, 2.5, 0, Math.PI * 2);
    ctx.fill();

    return c.toDataURL('image/jpeg', 0.65);
  }

  async batchExtractFrames({ mode = 'interval', intervalSec = 1.0, count = 20, onProgress = () => {} }) {
    const runId = this._batchRun;
    const results = [];
    const dur = this.duration;
    let targetTimes = [];

    if (mode === 'interval') {
      const step = Math.max(0.1, Number(intervalSec) || 1.0);
      for (let t = 0; t <= dur; t += step) {
        targetTimes.push(t);
      }
      // 硬上限：超长视频 + 小间隔会产出上千张全尺寸 PNG（内存与 UI 双双爆炸），
      // 超限时等距重采样到 BATCH_INTERVAL_MAX 个时间点
      if (targetTimes.length > BATCH_INTERVAL_MAX) {
        const src = targetTimes;
        targetTimes = Array.from({ length: BATCH_INTERVAL_MAX }, (_, i) =>
          src[Math.round(i * (src.length - 1) / (BATCH_INTERVAL_MAX - 1))]
        );
      }
    } else {
      const totalCount = Math.max(2, Math.min(200, Number(count) || 20));
      const step = dur / (totalCount - 1 || 1);
      for (let i = 0; i < totalCount; i++) {
        targetTimes.push(Math.min(dur, i * step));
      }
    }

    const total = targetTimes.length;
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = this.videoWidth;
    fullCanvas.height = this.videoHeight;
    const fullCtx = fullCanvas.getContext('2d');
    fullCtx.imageSmoothingEnabled = true;
    fullCtx.imageSmoothingQuality = 'high';

    for (let idx = 0; idx < total; idx++) {
      if (runId !== this._batchRun) break; // 切源即作废
      const t = targetTimes[idx];
      const frameNum = Math.round(t * this.fps);
      let dataUrl = '';

      if (this.strategy === 'webcodecs' && this.mbSink) {
        try {
          const sample = await this.mbSink.getSample(t);
          if (sample) {
            fullCtx.clearRect(0, 0, this.videoWidth, this.videoHeight);
            sample.draw(fullCtx, 0, 0, this.videoWidth, this.videoHeight);
            dataUrl = fullCanvas.toDataURL('image/png', 1.0);
            sample.close();
          }
        } catch (_) {}
      }

      if (!dataUrl && this.videoEl) {
        await this._seekHTML5VideoScheduled(t, frameNum, true);
        if (runId !== this._batchRun) break;
        if (this.videoEl.videoWidth > 0) {
          fullCtx.clearRect(0, 0, this.videoWidth, this.videoHeight);
          fullCtx.drawImage(this.videoEl, 0, 0, this.videoWidth, this.videoHeight);
          dataUrl = fullCanvas.toDataURL('image/png', 1.0);
        }
      }

      if (dataUrl) {
        results.push({
          frame: frameNum,
          time: t,
          timeStr: this.formatTimecode(t),
          dataUrl
        });
      }

      onProgress({ current: idx + 1, total, percent: Math.round(((idx + 1) / total) * 100) });
    }

    return results;
  }

  async extractKeyframes(onProgress = () => {}) {
    let interval = 1.5;
    if (this.duration < 10) interval = 0.8;
    else if (this.duration > 60) interval = 3.0;

    return await this.batchExtractFrames({
      mode: 'interval',
      intervalSec: interval,
      onProgress
    });
  }

  _clearHTML5Listeners() {
    while (this._cleanups.length) {
      const fn = this._cleanups.pop();
      try { fn(); } catch (_) {}
    }
  }

  _disposeMediabunny() {
    if (this.mbInput) {
      try { this.mbInput.dispose(); } catch (_) {}
      this.mbInput = null;
      this.mbTrack = null;
      this.mbSink = null;
    }
  }

  destroy() {
    this._loadGeneration++;
    this._filmstripRun++;
    this._batchRun++;
    this.stopPlayback();
    if (this._seekWatchdog) {
      clearTimeout(this._seekWatchdog);
      this._seekWatchdog = null;
    }
    this._clearHTML5Listeners();
    this._disposeMediabunny();
    if (this.wgslEnhancer) {
      this.wgslEnhancer.destroy();
      this.wgslEnhancer = null;
    }
    this.cache.clear();
    this._revokeOwnedUrls();
    const v = this.videoEl;
    if (v) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load(); // 释放本地文件句柄
      } catch (_) {}
    }
  }
}
