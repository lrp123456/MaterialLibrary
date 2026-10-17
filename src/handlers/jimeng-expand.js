/**
 * 即梦 AI 智能扩图（jimeng_img2img_seed3_painting_edit）
 * 凭证走 volc-openapi.resolveVolcCredentials（env / gen_adapters.secrets_json）
 * 比例扩展：top/bottom/left/right ∈[0,1]；画布扩展：canvas+mask（白=待补，黑=保留）
 */
const https = require('https')
const { volcOpenApi, resolveVolcCredentials, credentialsReady } = require('../volc-openapi')

const HOST = 'visual.volcengineapi.com'
const SERVICE = 'cv'
const VERSION = '2022-08-31'
const REQ_KEY = 'jimeng_img2img_seed3_painting_edit'

function resolveKeys(services) {
  return resolveVolcCredentials(services)
}

function jimengReady(services) {
  return credentialsReady(resolveKeys(services))
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function stripDataUrl(s) {
  return String(s || '').replace(/^data:[^,]+,/, '')
}

/**
 * @param {object} services
 * @param {{imageB64:string, maskB64?:string, top?:number, bottom?:number, left?:number, right?:number, prompt?:string}} opts
 * @returns {Promise<{b64:string, taskId:string}>}
 */
async function expandWithJimeng(services, opts) {
  const cfg = resolveKeys(services)
  if (!credentialsReady(cfg)) {
    throw new Error('未配置火山引擎 AK/SK：请设置 VOLC_ACCESSKEY / VOLC_SECRETKEY 或写入 gen_adapters.secrets_json')
  }
  const imageB64 = stripDataUrl(opts.imageB64)
  if (!imageB64) throw new Error('缺少 image')
  const prompt = String(opts.prompt || '').slice(0, 800)
  const req = {
    req_key: REQ_KEY,
    binary_data_base64: [imageB64],
  }
  if (opts.maskB64) {
    req.binary_data_base64.push(stripDataUrl(opts.maskB64))
  } else {
    const top = Number(opts.top || 0)
    const bottom = Number(opts.bottom || 0)
    const left = Number(opts.left || 0)
    const right = Number(opts.right || 0)
    for (const v of [top, bottom, left, right]) {
      if (!(v >= 0 && v <= 1)) throw new Error('扩图比例需在 [0,1] 内')
    }
    if (Math.max(top, bottom, left, right) <= 0) throw new Error('扩图比例全为 0')
    req.top = top
    req.bottom = bottom
    req.left = left
    req.right = right
  }
  if (prompt) req.prompt = prompt

  const sub = await volcOpenApi(cfg, {
    host: HOST,
    service: SERVICE,
    region: 'cn-north-1',
    action: 'CVSync2AsyncSubmitTask',
    version: VERSION,
    method: 'POST',
    body: req,
    timeoutMs: 60000,
  })
  // volc-openapi unwrap 可能剥掉 Result，这里兼容两种结构
  const subData = (sub && (sub.data || sub)) || {}
  const taskId = subData.task_id || (sub.task_id)
  if (!taskId) {
    // 若 unwrap 把 code 判断掉，再读原始
    if (sub && sub.code != null && Number(sub.code) !== 10000 && Number(sub.code) !== 0) {
      throw new Error('即梦扩图提交失败: ' + JSON.stringify(sub).slice(0, 400))
    }
    throw new Error('即梦扩图未返回 task_id: ' + JSON.stringify(sub).slice(0, 300))
  }

  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    await sleep(2000)
    const q = await volcOpenApi(cfg, {
      host: HOST,
      service: SERVICE,
      region: 'cn-north-1',
      action: 'CVSync2AsyncGetResult',
      version: VERSION,
      method: 'POST',
      body: { req_key: REQ_KEY, task_id: taskId },
      timeoutMs: 30000,
    })
    const d = (q && (q.data || q)) || {}
    const status = d.status
    if (status === 'done') {
      const b64s = d.binary_data_base64
      if (b64s && b64s[0]) return { b64: b64s[0], taskId }
      const urls = d.image_urls
      if (urls && urls[0]) {
        const fetched = await new Promise((resolve, reject) => {
          https
            .get(urls[0], (res) => {
              const chunks = []
              res.on('data', (c) => chunks.push(c))
              res.on('end', () => resolve(Buffer.concat(chunks)))
            })
            .on('error', reject)
        })
        return { b64: fetched.toString('base64'), taskId }
      }
      throw new Error('即梦扩图完成但未返回图片')
    }
    if (status === 'not_found' || status === 'expired') {
      throw new Error(`即梦扩图任务异常（${status}）`)
    }
  }
  throw new Error('即梦扩图轮询超时（180s）task_id=' + taskId)
}

module.exports = {
  expandWithJimeng,
  jimengReady,
  resolveKeys,
  REQ_KEY,
}
