/**
 * 端侧本地模型运行时（API_CONTRACT §10 / §13）
 * - 首次使用 load，编辑页内常驻
 * - seg / upscale 互斥
 * - 推理走 NativeInfer（Android NCNN 插件）；未接入时明确报错，由上层回落
 */
import { fetchLocalModels } from './ViewerApi'
import { builtinLocalModels } from './AndroidLocalInfer'

const BUILTIN_CATALOG = {
  models: [builtinLocalModels().segment, builtinLocalModels().upscale],
}

const STATE_KEY = 'local_model_state_v1'

/** 可替换的原生桥。接入 UTS/原生模块后在 App 启动时 setNativeInfer。 */
let nativeInfer = null

export function setNativeInfer(impl) {
  nativeInfer = impl && typeof impl.segment === 'function' ? impl : null
}

export function hasNativeInfer() {
  return !!nativeInfer
}

function loadState() {
  try {
    const s = uni.getStorageSync(STATE_KEY)
    if (s && typeof s === 'object') return s
  } catch (e) {}
  return { loadedId: null, exclusiveGroup: null, catalogAt: 0, catalog: null }
}

function saveState(s) {
  try {
    uni.setStorageSync(STATE_KEY, s)
  } catch (e) {}
}

class LocalModelRuntime {
  constructor() {
    this.state = loadState()
    this._loading = null
    this._catalogPromise = null
  }

  get loadedId() {
    return this.state.loadedId || null
  }

  get loadedGroup() {
    return this.state.exclusiveGroup || null
  }

  /** 拉取服务端目录（带内存缓存 10min） */
  async getCatalog(force = false) {
    const now = Date.now()
    if (!force && this.state.catalog && now - (this.state.catalogAt || 0) < 10 * 60 * 1000) {
      return this.state.catalog
    }
    if (!this._catalogPromise) {
      this._catalogPromise = fetchLocalModels()
        .then((data) => {
          const models = (data && data.models) || []
          this.state.catalog = models.length ? data : BUILTIN_CATALOG
          this.state.catalogAt = Date.now()
          saveState(this.state)
          return this.state.catalog
        })
        .catch(() => {
          this.state.catalog = BUILTIN_CATALOG
          this.state.catalogAt = Date.now()
          saveState(this.state)
          return BUILTIN_CATALOG
        })
        .finally(() => {
          this._catalogPromise = null
        })
    }
    return this._catalogPromise
  }

  async findModel(task) {
    const cat = await this.getCatalog()
    const list = (cat && cat.models) || []
    return list.find((m) => m.task === task) || list.find((m) => m.id === task) || null
  }

  /**
   * 确保某 task 模型已 load；互斥组会先卸载另一组。
   * @returns {Promise<{model: object, alreadyLoaded: boolean}>}
   */
  async ensureLoaded(task, { force = false } = {}) {
    const model = await this.findModel(task)
    if (!model) {
      const err = new Error(`本地模型目录无 ${task}`)
      err.code = 'model_not_in_catalog'
      throw err
    }
    if (!force && this.state.loadedId === model.id && this._sessionReady()) {
      return { model, alreadyLoaded: true }
    }
    if (this._loading) await this._loading.catch(() => {})

    this._loading = this._doLoad(model)
    try {
      const r = await this._loading
      return r
    } finally {
      this._loading = null
    }
  }

  _sessionReady() {
    return this.state.loadedId && (nativeInfer ? nativeInfer.isLoaded?.(this.state.loadedId) !== false : false)
  }

  async _doLoad(model) {
    // 互斥：加载另一 exclusiveGroup 前卸载当前
    if (this.state.loadedId && this.state.exclusiveGroup !== model.exclusiveGroup) {
      await this.unload()
    }
    if (!hasNativeInfer()) {
      const err = new Error('本地推理插件未接入（NCNN NativeInfer）')
      err.code = 'native_missing'
      err.model = model
      throw err
    }
    if (nativeInfer.load) {
      await nativeInfer.load(model)
    }
    this.state.loadedId = model.id
    this.state.exclusiveGroup = model.exclusiveGroup || model.task
    saveState(this.state)
    return { model, alreadyLoaded: false }
  }

  async unload() {
    if (!this.state.loadedId) return
    try {
      if (nativeInfer && nativeInfer.unload) {
        await nativeInfer.unload(this.state.loadedId)
      }
    } catch (e) {
      console.warn('[LocalModelRuntime] unload error', e)
    }
    this.state.loadedId = null
    this.state.exclusiveGroup = null
    saveState(this.state)
  }

  /** 编辑页 onHide / onUnload */
  async releasePage() {
    await this.unload()
  }

  /**
   * EdgeSAM 点选分割
   * @param {{imagePath: string, points?: Array<{x:number,y:number,label?:1|0}>, box?: {x1:number,y1:number,x2:number,y2:number}, width?: number, height?: number}} opts
   * @returns {Promise<{maskPath: string, polygon: number[][], width: number, height: number, modelId: string}>}
   */
  async segment(opts) {
    const { model } = await this.ensureLoaded('segment')
    if (!hasNativeInfer()) {
      const err = new Error('本地推理插件未接入')
      err.code = 'native_missing'
      throw err
    }
    const out = await nativeInfer.segment({
      modelId: model.id,
      inputSize: model.inputSize || 640,
      ...opts,
    })
    if (!out || !out.maskPath) {
      const err = new Error('分割未产出 mask')
      err.code = 'segment_empty'
      throw err
    }
    return { ...out, modelId: model.id }
  }

  /**
   * 离线 4x 超分（分块）
   * @returns {Promise<{outputPath: string, scale: number, modelId: string}>}
   */
  async upscale4x(opts) {
    const { model } = await this.ensureLoaded('upscale')
    if (!hasNativeInfer()) {
      const err = new Error('本地推理插件未接入')
      err.code = 'native_missing'
      throw err
    }
    const maxSide = model.maxSide || 1024
    const tile = model.tile || 256
    const out = await nativeInfer.upscale({
      modelId: model.id,
      scale: model.scale || 4,
      maxSide,
      tile,
      ...opts,
    })
    if (!out || !out.outputPath) {
      const err = new Error('超分失败')
      err.code = 'upscale_failed'
      throw err
    }
    return { ...out, scale: model.scale || 4, modelId: model.id }
  }

  /**
   * 检查在线升级（比较 version）
   * @returns {Promise<{needUpdate: boolean, model?: object, remote?: object}>}
   */
  async checkUpgrade(task) {
    const local = await this.findModel(task)
    const remote = local
    if (!remote) return { needUpdate: false }
    // 内置包 version 与目录一致则无需更新；后续可读本地缓存 version
    const localVersion = this.state.builtinVersions?.[remote.id] || remote.version
    return {
      needUpdate: localVersion !== remote.version,
      model: remote,
      remote,
    }
  }

  /** 下载并落盘（需原生或 uni 文件系统桥） */
  async downloadModel(model) {
    if (!nativeInfer || !nativeInfer.downloadModel) {
      const err = new Error('模型下载需原生文件桥')
      err.code = 'native_missing'
      throw err
    }
    await nativeInfer.downloadModel(model)
    this.state.builtinVersions = this.state.builtinVersions || {}
    this.state.builtinVersions[model.id] = model.version
    saveState(this.state)
    return model
  }
}

export const localModelRuntime = new LocalModelRuntime()

export default localModelRuntime
