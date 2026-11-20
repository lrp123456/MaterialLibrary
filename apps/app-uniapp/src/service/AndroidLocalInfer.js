/**
 * Vue3 app-plus 端侧推理桥：uni.requireNativePlugin → plus.android。
 */
const BUILTIN = {
  segment: {
    id: 'edge_sam_mobile',
    task: 'segment',
    exclusiveGroup: 'seg',
    fileName: 'edge_sam_encoder.param',
    companionFile: 'edge_sam_encoder.bin',
    extraFiles: {
      decoderParam: 'edge_sam_decoder.param',
      decoderBin: 'edge_sam_decoder.bin',
    },
    inputSize: 1024,
  },
  upscale: {
    id: 'realesrgan_x4_ncnn',
    task: 'upscale',
    exclusiveGroup: 'upscale',
    fileName: 'realesr-animevideov3-x4.param',
    companionFile: 'realesr-animevideov3-x4.bin',
    scale: 4,
    maxSide: 1024,
    tile: 256,
  },
}

function getPlugin() {
  // 标准 HBuilder 调试基座会在 requireNativePlugin 时打「基座不包含原生插件」。
  // 先探测 JNI 类；只有自定义基座/整包 APK 才继续要 UniModule。
  if (!nativeClass()) return null
  try {
    if (typeof uni !== 'undefined' && typeof uni.requireNativePlugin === 'function') {
      const p = uni.requireNativePlugin('uni-local-infer')
      if (p && (p.load || p.segmentPoint)) return p
    }
  } catch (e) {}
  return null
}

function nativeClass() {
  try {
    if (typeof plus === 'undefined' || !plus.android) return null
    return plus.android.importClass('io.dcloud.uni_modules.unilocalinfer.LocalInferNative')
  } catch (e) {
    return null
  }
}

function parseJson(s) {
  if (s && typeof s === 'object') return s
  try {
    return JSON.parse(String(s || '{}'))
  } catch (e) {
    return { error: String(s || e), code: 'bad_json' }
  }
}

function modelDir(model) {
  let root = ''
  const plugin = getPlugin()
  if (plugin && typeof plugin.filesDir === 'function') {
    try { root = plugin.filesDir() || '' } catch (e) {}
  }
  if (!root && typeof plus !== 'undefined' && plus.android) {
    try {
      const act = plus.android.runtimeMainActivity()
      root = act.getFilesDir().getAbsolutePath() + '/local-models'
    } catch (e) {}
  }
  return (root || '/data/user/0/io.dcloud.HBuilder/files/local-models') + '/' + model.id
}

function ensurePluginModels() {
  const plugin = getPlugin()
  if (plugin && typeof plugin.ensureModels === 'function') {
    const r = plugin.ensureModels()
    if (r && r.ok === false) throw new Error(r.error || 'ensureModels failed')
  }
}

export function createAndroidLocalInfer() {
  const plugin = getPlugin()
  const Cls = nativeClass()
  if (!plugin && !Cls) return null

  return {
    isLoaded(modelId) {
      try {
        if (plugin && plugin.isLoaded) {
          const r = plugin.isLoaded({ modelId })
          return !!(r && r.loaded)
        }
        if (Cls) return !!Cls.isLoaded(modelId)
      } catch (e) {}
      return false
    },
    async load(model) {
      ensurePluginModels()
      const m = model || BUILTIN.segment
      const dir = modelDir(m)
      const extra = m.extraFiles || {}
      const paramPath = dir + '/' + (m.fileName || 'model.param')
      const binPath = dir + '/' + (m.companionFile || 'model.bin')
      const auxParam = extra.decoderParam ? dir + '/' + extra.decoderParam : ''
      const auxBin = extra.decoderBin ? dir + '/' + extra.decoderBin : ''
      if (plugin && plugin.load) {
        const r = plugin.load({
          modelId: m.id,
          paramPath,
          binPath,
          auxParam,
          auxBin,
        })
        if (r && r.ok === false) throw new Error(r.error || 'native load failed')
        return
      }
      Cls.load(m.id, paramPath, binPath, auxParam, auxBin)
    },
    async unload(modelId) {
      try {
        if (plugin && plugin.unload) plugin.unload({ modelId })
        else if (Cls) Cls.unload(modelId)
      } catch (e) {}
    },
    async segment(opts) {
      const modelId = opts.modelId
      const imagePath = opts.imagePath
      const inputSize = opts.inputSize || 1024
      let json = ''
      if (opts.box) {
        const boxJson = JSON.stringify(opts.box)
        json = plugin && plugin.segmentBox
          ? plugin.segmentBox({ modelId, imagePath, inputSize, boxJson })
          : Cls.segmentBox(modelId, imagePath, inputSize, boxJson)
      } else {
        const pointsJson = JSON.stringify(opts.points || [])
        json = plugin && plugin.segmentPoint
          ? plugin.segmentPoint({ modelId, imagePath, inputSize, pointsJson })
          : Cls.segmentPoint(modelId, imagePath, inputSize, pointsJson)
      }
      const out = parseJson(json)
      if (out.error) {
        const err = new Error(out.error)
        err.code = out.code || 'segment_failed'
        throw err
      }
      return out
    },
    async upscale(opts) {
      const modelId = opts.modelId
      const imagePath = opts.imagePath
      const scale = opts.scale || 4
      const maxSide = opts.maxSide || 1024
      const tile = opts.tile || 256
      const json = plugin && plugin.upscale
        ? plugin.upscale({ modelId, imagePath, scale, maxSide, tile })
        : Cls.upscale(modelId, imagePath, scale, maxSide, tile)
      const out = parseJson(json)
      if (out.error) {
        const err = new Error(out.error)
        err.code = out.code || 'upscale_failed'
        throw err
      }
      return out
    },
  }
}

export function builtinLocalModels() {
  return BUILTIN
}

export default createAndroidLocalInfer
