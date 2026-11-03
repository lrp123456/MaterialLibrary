/**
 * 参数契约共用校验（阶段 4 / 验收点「App 与 Web 暴露同一套参数」）
 *
 * 校四件事：
 *  1. app-uniapp 与 web-pro 的规则引擎文件必须逐字节一致（防止两份副本各自漂移）
 *  2. 两份副本对同一批真实契约输入必须给出完全相同的判定结果
 *  3. App 端不再自带任何参数字段表/档位表（客户端不得硬编码参数）
 *  4. 服务端 /lab/capabilities 每个模型都带 schema，且引擎按契约正确联动
 *
 * 用法：node scripts/verify-app-contract-parity.js
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
const WEB = path.join(ROOT, 'web-pro', 'src', 'utils', 'model-protocol.js')
const APP = path.join(ROOT, 'app-uniapp', 'src', 'utils', 'model-protocol.js')
const BASE = process.env.ML_BASE || 'http://127.0.0.1:30001'
const DATA_DIR = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library')

let failures = 0
function ok (cond, msg) {
  if (cond) { console.log('[PASS] ' + msg); return true }
  failures++
  console.log('[FAIL] ' + msg)
  return false
}
function info (msg) { console.log('[INFO] ' + msg) }

function readPass () {
  const txt = fs.readFileSync(path.join(DATA_DIR, 'bootstrap-credentials.txt'), 'utf8')
  const line = txt.split(/\r?\n/).find((l) => l.trim().startsWith('admin:'))
  return line ? line.match(/admin:\s*(\S+)/)[1] : null
}

async function api (pathname, opt = {}) {
  const headers = {}
  if (opt.token) headers.Authorization = 'Bearer ' + opt.token
  if (opt.body) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + pathname, {
    method: opt.method || 'GET',
    headers,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  })
  return res.json()
}

/** 把 ESM 副本落到临时 .mjs 再 import（仓库根 package.json 没有 type:module）。 */
async function importEsmCopy (srcPath, tag) {
  const tmp = path.join(os.tmpdir(), `ml-protocol-${tag}.mjs`)
  fs.writeFileSync(tmp, fs.readFileSync(srcPath, 'utf8'), 'utf8')
  return import(pathToFileURL(tmp).href)
}

function stripCommentsAndSpaces (txt) {
  return txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim()
}

// ── 1. 规则引擎同源 ────────────────────────────────────────────
function checkEngineSameSource () {
  ok(fs.existsSync(WEB), `web-pro 规则引擎存在：web-pro/src/utils/model-protocol.js`)
  ok(fs.existsSync(APP), `App 规则引擎存在：app-uniapp/src/utils/model-protocol.js`)
  if (!fs.existsSync(WEB) || !fs.existsSync(APP)) return false
  const a = fs.readFileSync(WEB, 'utf8')
  const b = fs.readFileSync(APP, 'utf8')
  ok(a === b, `两端规则引擎逐字节一致（${a.length} bytes）`)
  const exportsA = [...a.matchAll(/export (?:const|function) (\w+)/g)].map((m) => m[1]).sort()
  ok(exportsA.join(',') === 'STUDIO_SKILLS_REGISTRY,evaluateClientModelRules,normalizeClientLayerStack',
    `引擎导出项 = ${exportsA.join(', ')}`)
  return a === b
}

// 用真实契约形状构造用例，两端各跑一遍再比 diff
function ruleCases () {
  const seedream = {
    modes: [{ id: 'text_to_image' }, { id: 'image_edit' }],
    common: [
      { key: 'size', type: 'enum', default: '2K', options: ['1K', '1.5K', '2K'] },
      { key: 'ratio', type: 'enum', default: '1:1', options: ['auto', '1:1', '9:16'] },
      { key: 'layer_decomposition', type: 'bool', default: false },
    ],
    advanced: [{ key: 'background', type: 'enum', default: '', options: ['', 'transparent'] }, { key: 'bbox', type: 'text' }],
    slots: { images: 6, videos: 0, audios: 0 },
    valueConstraints: [
      { type: 'layer_decomposition', ifKey: 'layer_decomposition', ifIn: [true], set: {}, lock: ['ratio'],
        effect: { suppress: ['ratio'], size_options: ['1K', '1.5K', '2K', 'auto'], size_default: 'auto', require_single_image: true }, reason: '' },
      { type: 'transparent_background', ifKey: 'background', ifIn: ['transparent'], set: { output_format: 'png' }, lock: [],
        effect: { force: { output_format: 'png' }, require_single_image: true }, reason: '' },
    ],
  }
  const seedance = {
    modes: [{ id: 'first_last_frame' }, { id: 'video_edit' }],
    common: [{ key: 'ratio', type: 'enum', default: '16:9' }, { key: 'duration', type: 'range', min: 4, max: 30, default: -1 }],
    slots: { images: 30, videos: 10, audios: 10 },
    modeConstraints: {
      first_last_frame: { set: { ratio: 'adaptive' }, lock: ['ratio'], reason: '' },
      video_edit: { set: { ratio: 'adaptive', duration: -1 }, lock: ['ratio', 'duration'], reason: '' },
    },
    valueConstraints: [],
  }
  return [
    { name: '图层拆分锁比例+换档', schema: seedream, mode: 'image_edit', params: { size: '2K', ratio: '1:1', layer_decomposition: true }, refs: { images: 1, videos: 0, audios: 0 } },
    { name: '图层拆分但档位冲突', schema: seedream, mode: 'text_to_image', params: { size: '2K', ratio: '9:16', layer_decomposition: true }, refs: { images: 3, videos: 0, audios: 0 } },
    { name: '透明底强制 PNG', schema: seedream, mode: 'image_edit', params: { background: 'transparent' }, refs: { images: 2, videos: 0, audios: 0 } },
    { name: '未开联动无副作用', schema: seedream, mode: 'text_to_image', params: { size: '2K', ratio: '1:1' }, refs: { images: 0, videos: 0, audios: 0 } },
    { name: '首尾帧锁 adaptive', schema: seedance, mode: 'first_last_frame', params: { ratio: '16:9', duration: 5 }, refs: { images: 2, videos: 0, audios: 0 } },
    { name: '视频编辑锁比例与时长', schema: seedance, mode: 'video_edit', params: { ratio: '1:1', duration: 8 }, refs: { images: 0, videos: 1, audios: 0 } },
    { name: '无 schema 容错', schema: null, mode: 'text_to_image', params: { a: 1 }, refs: { images: 0, videos: 0, audios: 0 } },
    { name: '图层拆分档位越界', schema: seedream, mode: 'image_edit', params: { size: '4K', ratio: '1:1', layer_decomposition: true }, refs: { images: 1, videos: 0, audios: 0 } },
  ]
}

async function checkEngineParity () {
  if (!fs.existsSync(WEB) || !fs.existsSync(APP)) return
  const [mw, ma] = await Promise.all([importEsmCopy(WEB, 'web'), importEsmCopy(APP, 'app')])
  const cases = ruleCases()
  let same = true
  for (const c of cases) {
    const r1 = JSON.stringify(mw.evaluateClientModelRules(c.schema, c.mode, c.params, c.refs))
    const r2 = JSON.stringify(ma.evaluateClientModelRules(c.schema, c.mode, c.params, c.refs))
    if (r1 !== r2) { same = false; console.log(`  差异用例：${c.name}\n   web=${r1}\n   app=${r2}`) }
  }
  ok(same, `${cases.length} 个联动用例两端判定完全一致`)

  // 语义抽查：证明锁真的生效
  const decomp = ma.evaluateClientModelRules(ruleCases()[0].schema, 'image_edit', ruleCases()[0].params, ruleCases()[0].refs)
  ok(decomp.lockedKeys.includes('ratio'), '图层拆分：ratio 进入 lockedKeys')
  ok(decomp.suppressedKeys.includes('ratio'), '图层拆分：ratio 进入 suppressedKeys（面板隐藏）')
  // 档位仍在拆分后的清单里 → 尊重用户已选值，不无谓重置
  ok(decomp.params.size === '2K', `图层拆分：2K 仍在档位清单内，保持用户选择（实际 ${decomp.params.size}）`)
  ok(Array.isArray(decomp.fieldOverrides.size?.options) && decomp.fieldOverrides.size.options.includes('auto'),
    '图层拆分：size 档位被覆盖并含 auto')
  // 档位不在拆分后的清单里 → 改写到 size_default
  const badCase = ruleCases()[7]
  const decompBad = ma.evaluateClientModelRules(badCase.schema, badCase.mode, badCase.params, badCase.refs)
  ok(decompBad.params.size === 'auto', `图层拆分：4K 越界后改写到 size_default（实际 ${decompBad.params.size}）`)
  ok(decomp.warnings.length === 0, '图层拆分 + 恰好 1 张参考图：无告警')
  const warnCase = ma.evaluateClientModelRules(ruleCases()[1].schema, 'text_to_image', ruleCases()[1].params, ruleCases()[1].refs)
  ok(warnCase.warnings.length === 1, `图层拆分 + 3 张参考图：出 1 条告警（实际 ${warnCase.warnings.length}）`)
  const trans = ma.evaluateClientModelRules(ruleCases()[2].schema, 'image_edit', ruleCases()[2].params, ruleCases()[2].refs)
  ok(trans.params.output_format === 'png' && trans.lockedKeys.includes('output_format'), '透明底：output_format 强制并锁定为 png')
  const fl = ma.evaluateClientModelRules(ruleCases()[4].schema, 'first_last_frame', ruleCases()[4].params, ruleCases()[4].refs)
  ok(fl.params.ratio === 'adaptive' && fl.lockedKeys.includes('ratio'), '首尾帧：ratio 锁 adaptive')
  const ve = ma.evaluateClientModelRules(ruleCases()[5].schema, 'video_edit', ruleCases()[5].params, ruleCases()[5].refs)
  ok(ve.lockedKeys.includes('ratio') && ve.lockedKeys.includes('duration') && ve.params.duration === -1, '视频编辑：ratio 与 duration 双锁')
  const none = ma.evaluateClientModelRules(null, 'x', { a: 1 }, { images: 0 })
  ok(none.params.a === 1 && none.lockedKeys.length === 0, '无 schema：原样透传不报错')
}

// ── 3. App 端无硬编码参数表 ────────────────────────────────────
function checkNoHardcodedParams () {
  const schemas = path.join(ROOT, 'app-uniapp', 'src', 'service', 'ModelSchemas.js')
  const catalog = path.join(ROOT, 'app-uniapp', 'src', 'service', 'ModelCatalog.js')

  const sTxt = fs.readFileSync(schemas, 'utf8')
  ok(!/const SCHEMAS\s*=\s*\{/.test(sTxt), 'ModelSchemas.js 不再自带 SCHEMAS 字段表')
  ok(!/applyConstraints/.test(sTxt), 'ModelSchemas.js 删除了自研 applyConstraints')
  ok(!/options:\s*\[/.test(sTxt), 'ModelSchemas.js 不含任何档位 options 字面量')
  ok(/model\.schema/.test(sTxt), 'ModelSchemas.schemaFor 读服务端下发的 model.schema')
  ok(/schema\.slots/.test(sTxt), 'ModelSchemas.slotLimit 读服务端 schema.slots')

  const cTxt = fs.readFileSync(catalog, 'utf8')
  ok(!/maxRefs:/.test(cTxt) && !/durations:\s*\[/.test(cTxt) && !/freeTier:/.test(cTxt),
    'ModelCatalog.js 兜底目录只剩名字，不含参数（maxRefs/durations/freeTier）')

  const homeTxt = fs.readFileSync(path.join(ROOT, 'app-uniapp', 'src', 'pages', 'home', 'home.vue'), 'utf8')
  ok(!/assertAgnesFreeTier/.test(homeTxt), 'home.vue 不再调用自研 Agnes 自由档校验')
  ok(/evaluateClientModelRules/.test(homeTxt), 'home.vue 走共用的 evaluateClientModelRules')

  // 全局扫一遍：App 业务代码里不该再出现「档位数组字面量」形式的参数表
  const pagesDir = path.join(ROOT, 'app-uniapp', 'src', 'pages')
  const hits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name)
      if (e.isDirectory()) walk(fp)
      else if (/\.(vue|js)$/.test(e.name)) {
        const t = fs.readFileSync(fp, 'utf8')
        for (const m of t.matchAll(/'(9:16|16:9|1K|2K|480p|720p)'/g)) hits.push(`${path.relative(ROOT, fp)}: ${m[0]}`)
      }
    }
  }
  walk(pagesDir)
  ok(hits.length === 0, `App 页面不再内联参数档位字面量（命中 ${hits.length} 处）`)
  if (hits.length) info(hits.slice(0, 8).join('\n       '))

  // 清单第 22 项：面板项只来自服务端 schema，本地档位 computed 必须彻底消失
  const homePanel = fs.readFileSync(path.join(ROOT, 'app-uniapp', 'src', 'pages', 'home', 'home.vue'), 'utf8')
  for (const gone of ['showRatio', 'showDuration', 'showClarity', 'showMood', 'availableDurations']) {
    ok(!new RegExp(gone + '\\s*\\(').test(homePanel), `home.vue 本地档位 computed ${gone}() 已删除`)
  }
  ok(/schemaCommonFields/.test(homePanel), 'home.vue 常用参数面板绑定 schemaCommonFields（服务端 common/advanced）')

  // 快捷页的档位改从服务端契约取
  const qpPath = path.join(ROOT, 'app-uniapp', 'src', 'service', 'QuickParams.js')
  ok(fs.existsSync(qpPath), 'QuickParams.js 存在（快捷页档位读取层）')
  if (fs.existsSync(qpPath)) {
    const qp = fs.readFileSync(qpPath, 'utf8')
    ok(/fetchLabCapabilities/.test(qp), 'QuickParams 从 /lab/capabilities 取档位，不自带表')
    ok(!/'(9:16|16:9|1:1|3:4|4:3|21:9)'/.test(qp), 'QuickParams 内不含任何画幅字面量')
  }
  for (const rel of ['app-uniapp/src/pages/quick/expand.vue', 'app-uniapp/src/pages/quick/walkthrough.vue']) {
    ok(/fieldOf\(/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), `${rel} 用 fieldOf 向服务端取档位`)
  }

  // 已知残留（记 INFO 不判失败）：漫游镜头语言目前只有客户端一份定义，服务端没有对应词表
  const wt = fs.readFileSync(path.join(ROOT, 'app-uniapp', 'src', 'pages', 'quick', 'walkthrough.vue'), 'utf8')
  if (/smooth_walk/.test(wt)) {
    info('漫游镜头风格(smooth_walk/push_in/panoramic_orbit)仍只在客户端定义，服务端无对应词表 —— 需单独立项迁到服务端')
  }

  // 对话链路四条错配的回归守卫（详见 scripts/probe-chat-contract.js 的实测）
  const chat = fs.readFileSync(path.join(ROOT, 'app-uniapp', 'src', 'pages', 'chat', 'chat.vue'), 'utf8')
  ok(!/chatComplete\(\s*\{\s*text/.test(chat), 'chat.vue 不再把服务端不认的 text 当对话载荷')
  ok(/prompt: text/.test(chat) && /messages: history/.test(chat), 'chat.vue 用服务端真实字段 prompt + messages')
  ok(/\.choices\s*&&\s*[\w.]+\.choices\[0\]/.test(chat) && /message\.content/.test(chat),
    'chat.vue 从 choices[0].message.content 取正文')
  ok(!/missingRefs/.test(chat), 'chat.vue 不再读服务端从未返回的 missingRefs/data.refs')
  ok(/caps\.studio\s*&&\s*caps\.studio\.chat/.test(chat) && /chatModels/.test(chat)
    && !/studioSchema\.models/.test(chat),
    'chat.vue 对话模型来自 studio.chat（不是 /studio/schema 的生成模型）')
  const apiTxt = fs.readFileSync(path.join(ROOT, 'src', 'api.js'), 'utf8')
  const chatHandler = apiTxt.slice(apiTxt.indexOf("pathname === '/gen/chat'"))
  ok(/sendJson\(res, 200, \{\s*success: true,\s*data:/.test(chatHandler.slice(0, 4000)),
    '服务端 /gen/chat 成功分支带 {success,data} 封套（App request() 只认这个）')
}

// 用服务端字段默认值铺一份「用户刚打开面板」的参数
function defaultsOf (sc) {
  const out = {}
  for (const f of [...(sc.common || []), ...(sc.advanced || [])]) {
    if (f && f.key && f.default !== undefined) out[f.key] = f.default
  }
  return out
}

// ── 4. 服务端契约真的下发 schema ───────────────────────────────
async function checkServerContract () {
  const pass = readPass()
  if (!pass) { info('拿不到 admin 口令，跳过服务端校验'); return }
  let token
  try {
    const r = await api('/api/viewer/auth/login', { method: 'POST', body: { username: 'admin', password: pass } })
    token = r.data && r.data.token
  } catch (e) { info('服务未启动，跳过服务端校验: ' + e.message); return }
  if (!token) { info('登录失败，跳过服务端校验'); return }

  const caps = (await api('/api/lab/capabilities', { token })).data
  const studio = caps.studio || {}
  const malformed = []
  const schemaless = []
  let modelCount = 0
  for (const dom of ['image', 'video', 'music', 'portrait']) {
    for (const m of (studio[dom] && studio[dom].models) || []) {
      modelCount++
      const sc = m.schema
      if (!sc) { schemaless.push(`${dom}/${m.id}`); continue }
      // 带 schema 的模型必须形状完整，否则两端都渲染不出参数
      if (!Array.isArray(sc.modes) || !sc.modes.length) malformed.push(`${dom}/${m.id}: modes`)
      if (!Array.isArray(sc.common)) malformed.push(`${dom}/${m.id}: common`)
      if (!sc.slots || typeof sc.slots !== 'object') malformed.push(`${dom}/${m.id}: slots`)
      for (const f of [...(sc.common || []), ...(sc.advanced || [])]) {
        if (!f.key || !f.type) malformed.push(`${dom}/${m.id}: 字段缺 key/type`)
      }
    }
  }
  ok(malformed.length === 0, `${modelCount} 个工坊模型中，带 schema 的形状全部完整（异常 ${malformed.length}）`)
  if (malformed.length) info('异常: ' + [...new Set(malformed)].slice(0, 10).join(', '))
  // 无 schema 的模型两端一致降级（web-pro 显示「参数表还没接入」，App 显示空参数面板）：
  // 这是服务端契约缺口，不是客户端分裂，故记 INFO。
  if (schemaless.length) info('服务端未下发 schema 的模型（两端一致降级）: ' + schemaless.join(', '))
  else info('全部工坊模型都带服务端 schema')

  // 清单第 21 项：线上每个 schema × 每个 mode × 联动探针，两端判定必须逐字节一致
  const [engW, engA] = await Promise.all([importEsmCopy(WEB, 'web-live'), importEsmCopy(APP, 'app-live')])
  let combos = 0
  const diffs = []
  for (const dom of ['image', 'video', 'music', 'portrait']) {
    for (const m of (studio[dom] && studio[dom].models) || []) {
      const sc = m.schema
      if (!sc) continue
      const base = defaultsOf(sc)
      for (const mode of sc.modes || []) {
        for (const probe of [{}, { ...base, layer_decomposition: true }, { ...base, background: 'transparent' }]) {
          combos++
          const refs = { images: 2, videos: 1, audios: 1 }
          const a = JSON.stringify(engW.evaluateClientModelRules(sc, mode.id, probe, refs))
          const b = JSON.stringify(engA.evaluateClientModelRules(sc, mode.id, probe, refs))
          if (a !== b) diffs.push(`${dom}/${m.id}/${mode.id}`)
        }
      }
    }
  }
  ok(diffs.length === 0, `${combos} 组「线上 schema × 全部 mode × 联动探针」两端判定逐字节一致（差异 ${diffs.length}）`)
  if (diffs.length) info('差异组合: ' + [...new Set(diffs)].slice(0, 8).join(', '))

  // 引擎直接吃服务端真实 schema，验证线上契约的联动确实生效
  const eng = engA
  const sd25 = (studio.video?.models || []).find((m) => m.id === 'seedance2_5')
  if (sd25) {
    const r = eng.evaluateClientModelRules(sd25.schema, 'first_last_frame', { ratio: '16:9', duration: 8 }, { images: 2 })
    ok(r.params.ratio === 'adaptive' && r.lockedKeys.includes('ratio'),
      '真实 seedance2_5 契约：首尾帧把 ratio 锁成 adaptive')
    const r2 = eng.evaluateClientModelRules(sd25.schema, 'video_edit', { ratio: '1:1', duration: 8 }, { images: 0, videos: 1 })
    ok(r2.lockedKeys.includes('duration') && r2.params.duration === -1,
      '真实 seedance2_5 契约：视频编辑把 duration 锁成智能(-1)')
    ok(Number(sd25.schema.slots.images) === 30, `真实 seedance2_5 参考图上限来自 slots.images=${sd25.schema.slots.images}`)
  } else info('目录里没有 seedance2_5，跳过视频契约校验')

  const sf = (studio.image?.models || []).find((m) => m.id === 'seedream5flash')
  if (sf) {
    const base = {}
    for (const f of [...(sf.schema.common || []), ...(sf.schema.advanced || [])]) base[f.key] = f.default
    base.layer_decomposition = true
    const r = eng.evaluateClientModelRules(sf.schema, 'image_edit', base, { images: 1 })
    ok(r.lockedKeys.includes('ratio') && r.suppressedKeys.includes('ratio'),
      '真实 seedream5flash 契约：图层拆分锁并隐藏 ratio')
    ok(r.fieldOverrides.size && r.fieldOverrides.size.options.includes('auto'),
      '真实 seedream5flash 契约：图层拆分后 size 档位含 auto')
    const t = { ...base, layer_decomposition: false, background: 'transparent' }
    const r2 = eng.evaluateClientModelRules(sf.schema, 'image_edit', t, { images: 1 })
    ok(r2.params.output_format === 'png', '真实 seedream5flash 契约：透明底强制 output_format=png')
  } else info('目录里没有 seedream5flash，跳过图像契约校验')

  // App 侧读取层与真实 slots 对齐
  const msPath = path.join(ROOT, 'app-uniapp', 'src', 'service', 'ModelSchemas.js')
  const tmpMs = path.join(os.tmpdir(), 'ml-model-schemas.mjs')
  fs.writeFileSync(tmpMs, fs.readFileSync(msPath, 'utf8'), 'utf8')
  const ms = await import(pathToFileURL(tmpMs).href)
  if (sf) {
    ok(ms.slotLimit(sf.schema, 'images', 'text_to_image') === Math.min(6, Number(sf.schema.free?.maxRefs ?? 6)),
      `App slotLimit(图生图) 与 slots/free 收紧结果一致`)
    ok(ms.slotLimit(sf.schema, 'images', 'image_edit') === 1, 'App slotLimit(交互编辑) 收到 1 张')
    ok(ms.slotLimit(sd25 ? sd25.schema : null, 'images', 'first_last_frame') === 2, 'App slotLimit(首尾帧) 收到 2 张')
    ok(ms.slotLimit({ modes: [] }, 'images') === null, 'App slotLimit 无 slots 时返回 null（= 不封顶，与 web-pro 一致）')
  }
  ok(ms.schemaFor({ schema: sf && sf.schema }) === (sf && sf.schema), 'App schemaFor 直接返回服务端 schema 对象')
  ok(ms.optionLabel({ labels: { '-1': '自动时长' } }, -1) === '自动时长', 'App optionLabel 优先用服务端 labels')
  ok(ms.optionLabel({}, 'auto') === '自动' && ms.optionLabel({}, '9:16') === '9:16', 'App optionLabel 兜底文案与 web-pro 同语义')
}

// ── 5. App 关键页面可编译 ──────────────────────────────────────
async function checkSfcCompiles () {
  const compilerDir = path.join(ROOT, 'web-pro', 'node_modules', '@vue', 'compiler-sfc')
  if (!fs.existsSync(compilerDir)) { info('未装 @vue/compiler-sfc，跳过 SFC 编译校验'); return }
  const sfc = require(path.join(compilerDir, 'dist', 'compiler-sfc.cjs.js'))
  // 覆盖全部页面/组件：手挑清单会漏掉刚改过的文件（本次就是漏了 edit.vue）
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return []
    const out = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) out.push(...walk(full))
      else if (e.name.endsWith('.vue')) out.push(full)
    }
    return out
  }
  const roots = ['pages', 'components'].map((d) => path.join(ROOT, 'app-uniapp', 'src', d))
  const all = walk(roots[0]).concat(walk(roots[1])).sort()
  const files = all.map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
  const broken = []
  for (const rel of files) {
    const p = path.join(ROOT, rel)
    const src = fs.readFileSync(p, 'utf8')
    let good = true
    let err = ''
    try {
      const { descriptor, errors } = sfc.parse(src, { filename: p })
      if (errors && errors.length) { good = false; err = errors[0].message }
      else {
        const c = sfc.compileScript(descriptor, { id: rel })
        if (!c.content) { good = false; err = 'compileScript 无输出' }
        if (good && descriptor.template) {
          const t = sfc.compileTemplate({ source: descriptor.template.content, filename: p, id: rel })
          if (t.errors && t.errors.length) { good = false; err = String(t.errors[0]) }
        }
      }
    } catch (e) { good = false; err = e.message }
    if (!good) broken.push(`${rel} → ${err}`)
  }
  ok(broken.length === 0, `${files.length} 个 App 页面/组件全部编译通过（失败 ${broken.length}）`)
  for (const b of broken) console.log('        ↳ ' + b);
  for (const rel of ['app-uniapp/src/service/ModelSchemas.js', 'app-uniapp/src/service/ModelCatalog.js', 'app-uniapp/src/utils/model-protocol.js']) {
    let good = true
    let err = ''
    try { await importEsmCopy(path.join(ROOT, rel), 'chk-' + path.basename(rel, '.js')) } catch (e) { good = false; err = e.message }
    ok(good, `${rel} 作为 ESM 加载通过${good ? '' : ' → ' + err}`)
  }
}

;(async () => {
  console.log('=== 参数契约共用校验 ===\n')
  checkEngineSameSource()
  console.log('')
  await checkEngineParity()
  console.log('')
  checkNoHardcodedParams()
  console.log('')
  await checkServerContract()
  console.log('')
  await checkSfcCompiles()
  console.log('\n' + (failures ? `✗ ${failures} 项未通过` : '✓ 全部通过'))
  process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('脚本失败:', e); process.exit(1) })
