/**
 * 离线 payload 断言：不碰任何真实供应商
 *
 * 覆盖三处修复：
 *  1) resolveImageToDataUrl 取「用户选中的那一版」全尺寸衍生图，不再一律送 512px 预览缩略图
 *  2) 线上 Seedance 路径带上 first_frame / last_frame 角色（以前只有带人像时才带）
 *  3) shapeVolcVideo 支持尾帧，图片编号与 content 顺序一致
 *
 * 运行：node test/gen-video-payload-offline.test.js
 * 真实素材与真实 DB 只读使用；API Key 由测试内注入的假接入点提供，请求只会发往 127.0.0.1。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const REAL_DB = process.env.MLS_REAL_DB || '/home/lrp/.dsh-material-library/material.db';
const DATA_DIR = process.env.MLS_DATA_DIR || '/home/lrp/.dsh-material-library';
const DB = path.join(os.tmpdir(), `mls_offline_${Date.now()}.db`);

let pass = 0;
let fail = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('  PASS  ' + name); })
    .catch((e) => { fail++; console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); });
}

function bytesOfDataUrl(u) {
  const comma = String(u || '').indexOf(',');
  return comma < 0 ? 0 : Buffer.from(String(u).slice(comma + 1), 'base64').length;
}
function mimeOfDataUrl(u) {
  const m = /^data:([^;,]+)/.exec(String(u || ''));
  return m ? m[1] : '';
}
function absOf(storageRef, storageType) {
  if (!storageRef) return '';
  if (path.isAbsolute(storageRef)) return storageRef;
  return storageType === 'nas' ? path.join(DATA_DIR, 'nas_material', storageRef) : path.join(DATA_DIR, storageRef);
}

(async () => {
  if (!fs.existsSync(REAL_DB)) {
    console.log('跳过：找不到真实库 ' + REAL_DB);
    return;
  }
  const Database = require('better-sqlite3');
  const src = new Database(REAL_DB, { readonly: true });
  await src.backup(DB);
  src.close();
  const db = new Database(DB);

  // 挑两个「本地缓存里确有全尺寸衍生图 + 确有缩略图」的素材
  const rows = db.prepare(`
    SELECT a.fid fid, a.main_derivative_id mid, d.kind mkind, d.storage_type mtype, d.storage_ref mref,
           d.width mw, d.height mh,
           (SELECT COUNT(*) FROM derivatives x WHERE x.asset_fid = a.fid AND x.storage_type='local_cache') lc
    FROM assets a JOIN derivatives d ON d.id = a.main_derivative_id
    WHERE a.kind='image' AND d.storage_type='local_cache'
      AND (SELECT COUNT(*) FROM derivatives x WHERE x.asset_fid=a.fid) >= 2
    ORDER BY a.created_at DESC LIMIT 25
  `).all();
  const picked = [];
  for (const r of rows) {
    const mainAbs = absOf(r.mref, r.mtype);
    const thumb = path.join(DATA_DIR, 'cache', 'thumbs', `${r.fid}.jpg`);
    if (fs.existsSync(mainAbs) && fs.existsSync(thumb) &&
        fs.statSync(mainAbs).size > fs.statSync(thumb).size * 4) {
      const alt = db.prepare(
        "SELECT id, kind, storage_type, storage_ref, width, height FROM derivatives WHERE asset_fid=? AND id!=? AND storage_type='local_cache' ORDER BY id DESC LIMIT 1"
      ).get(r.fid, r.mid);
      if (alt && fs.existsSync(absOf(alt.storage_ref, alt.storage_type)) &&
          absOf(alt.storage_ref, alt.storage_type) !== mainAbs) {
        picked.push({ ...r, mainAbs, thumbAbs: thumb, alt });
      }
    }
    if (picked.length === 2) break;
  }
  if (picked.length < 2) {
    console.log('跳过：本地没有「主衍生 + 备用衍生 + 缩略图」齐活的素材');
    db.close(); fs.rmSync(DB, { force: true });
    return;
  }
  const [A, B] = picked;
  console.log(`素材 A=${A.fid} 主衍生#${A.mid}(${A.mkind}) B=${B.fid} 主衍生#${B.mid}(${B.mkind})`);

  // 假接入点：钥匙是假的，请求只发往 127.0.0.1 的抓包服务
  const capture = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { capture.push(JSON.parse(raw)); } catch (_) { capture.push(raw); }
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('OFFLINE_CAPTURE 不做真实生成');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // credentials_json 存的是「环境变量名」，所以假钥匙靠注入一个变量提供。
  // 请求只发往 127.0.0.1 的抓包服务，任何密钥都不会外发。
  process.env.MLS_OFFLINE_ARK_KEY = 'sk-offline-only';
  const ep = db.prepare("SELECT id FROM llm_endpoints WHERE id='volc_ark'").get();
  if (ep) {
    db.prepare("UPDATE llm_endpoints SET credentials_json='[\"MLS_OFFLINE_ARK_KEY\"]' WHERE id='volc_ark'").run();
  } else {
    db.prepare(`
      INSERT INTO llm_endpoints (id, provider_id, name, base_url, auth_type, credentials_json, enabled)
      VALUES ('volc_ark', 'volcengine', 'offline', ?, 'bearer', '["MLS_OFFLINE_ARK_KEY"]', 1)
    `).run(`http://127.0.0.1:${port}`);
  }

  const services = {
    db,
    config: { dataDir: DATA_DIR, port: 1, litellmApiKey: '' },
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  };
  const { executeAdapter } = require('../src/gen');
  const adapter = {
    id: 'ark_seedance_video',
    name: 'offline',
    protocol: 'async_http_job',
    endpoint_id: 'volc_ark',
    base_url: `http://127.0.0.1:${port}`,
    secrets_json: '{}',
    config_json: JSON.stringify({
      submitPath: '/submit',
      defaultModel: 'doubao-seedance-2-0-260128',
      submitBodyTemplate: { model: '{{model}}', content: [] }
    })
  };

  const urlA = `/api/viewer/assets/${A.fid}/image?token=offline`;
  const urlB = `/api/viewer/assets/${B.fid}/image?token=offline`;

  async function runSubmit(input) {
    capture.length = 0;
    let err = null;
    let ret = null;
    try { ret = await executeAdapter(services, adapter, { kind: 'video', timeoutMs: 5000, ...input }); }
    catch (e) { err = e; }
    const body = capture[0];
    const why = err ? err.message : (ret && (ret.error || ret.message)) || JSON.stringify(ret || '').slice(0, 200);
    assert(body && Array.isArray(body.content), `没抓到提交体：${why}`);
    return body;
  }
  const roleOf = (body, role) => body.content.find((c) => c.role === role);

  console.log('\n=== 1. 参考图不再是 512px 预览缩略图 ===');
  await t('chip URL 解析出的字节 = 主衍生全图，且明显大于缩略图', async () => {
    const thumbSize = fs.statSync(A.thumbAbs).size;
    const mainSize = fs.statSync(A.mainAbs).size;
    const body = await runSubmit({
      prompt: '客厅漫游', model: 'doubao-seedance-2-0-260128',
      imageUrls: [urlA], genMode: 'image_to_video', ratio: '9:16', durationSec: 5
    });
    const url = body.content.find((c) => c.type === 'image_url').image_url.url;
    assert(mimeOfDataUrl(url).startsWith('image/'), 'mime 不是图片：' + mimeOfDataUrl(url));
    const n = bytesOfDataUrl(url);
    assert(Math.abs(n - mainSize) <= mainSize * 0.35, `字节数 ${n} 既不像全图 ${mainSize} 也不像预览档`);
    assert(n > thumbSize * 4, `仍在送缩略图（${n} vs thumb ${thumbSize}）`);
  });

  await t('?derivative=N 指定的那一版被采纳（不是主衍生）', async () => {
    const altAbs = absOf(B.alt.storage_ref, B.alt.storage_type);
    const mainSize = fs.statSync(B.mainAbs).size;
    const altSize = fs.statSync(altAbs).size;
    assert(altSize !== mainSize, '测试素材两版字节数相同，无法区分');
    const body = await runSubmit({
      prompt: '客厅漫游', model: 'doubao-seedance-2-0-260128',
      imageUrls: [`${urlB}&derivative=${B.alt.id}`], genMode: 'image_to_video', ratio: '3:4', durationSec: 5
    });
    const n = bytesOfDataUrl(body.content.find((c) => c.type === 'image_url').image_url.url);
    assert(Math.abs(n - altSize) <= altSize * 0.35, `没取到指定衍生：${n} vs 指定 ${altSize} / 主 ${mainSize}`);
  });

  console.log('\n=== 2. 线上 Seedance 路径带上首尾帧角色 ===');
  await t('first_last_frame：content 含 first_frame + last_frame，且不重复送成参考图', async () => {
    const body = await runSubmit({
      prompt: '镜头推进', model: 'doubao-seedance-2-0-260128',
      imageUrls: [urlA, urlB], firstFrame: urlA, lastFrame: urlB,
      genMode: 'first_last_frame', ratio: '9:16', durationSec: 5
    });
    const first = roleOf(body, 'first_frame');
    const last = roleOf(body, 'last_frame');
    assert(first && last, `缺首/尾帧角色：${JSON.stringify(body.content.map((c) => c.role || c.type))}`);
    assert(bytesOfDataUrl(first.image_url.url) > 0 && bytesOfDataUrl(last.image_url.url) > 0, '首尾帧没带上图片');
    assert(first.image_url.url !== last.image_url.url, '首帧和尾帧是同一张：下标错位没修好');
    assert(!body.content.some((c) => c.role === 'reference_image'), '首尾帧又被当参考图重复送了一遍');
    assert(body.duration >= 4 && body.duration <= 12, 'duration 没夹到 4~12：' + body.duration);
  });

  await t('文生视频（无参考图）不产生多余 image_url 项', async () => {
    const body = await runSubmit({
      prompt: '纯文生视频', model: 'doubao-seedance-2-0-260128',
      genMode: 'text_to_video', ratio: '16:9', durationSec: 5
    });
    assert(!body.content.some((c) => c.type === 'image_url'), JSON.stringify(body.content));
  });

  console.log('\n=== 3. shapeVolcVideo 尾帧与图片编号 ===');
  await t('带人像 + 尾帧：编号连续、尾帧在最后、caption 说明首尾帧', async () => {
    const { shapeVolcVideo } = require('../src/portrait-contract');
    const out = shapeVolcVideo({
      isVolc: true, model: 'doubao-seedance-2-0-260128', prompt: 'p',
      images: ['data:image/jpeg;base64,REF1', 'data:image/jpeg;base64,REF2'],
      firstFrameUrl: 'data:image/jpeg;base64,FIRST',
      lastFrameUrl: 'data:image/jpeg;base64,LAST',
      genMode: 'first_last_frame', ratio: '9:16', duration: 5,
      portraits: [{ volc_asset_id: 'asset-1', groupName: '女主' }]
    });
    const roles = out.content.map((c) => `${c.type}:${c.role || '-'}`);
    assert.strictEqual(roles[1], 'image_url:first_frame', JSON.stringify(roles));
    assert.strictEqual(roles[2], 'image_url:reference_image', JSON.stringify(roles));
    assert.strictEqual(out.content[out.content.length - 1].role, 'last_frame', JSON.stringify(roles));
    const text = out.content[0].text;
    assert(/图片1是首帧/.test(text), 'caption 缺首帧说明：' + text);
    // content[0] 是文本，图片编号从 1 起算：尾帧是第 N 张图（N = 图片项个数）
    const imgCount = out.content.length - 1;
    assert(text.includes(`图片${imgCount}是尾帧`), `caption 尾帧编号应为图片${imgCount}：` + text);
  });

  console.log('\n=== 4. 前端首尾帧槽位（脚本断言，不跑模型）===');
  const vue = fs.readFileSync(path.join(__dirname, '..', 'web-pro', 'src', 'views', 'studio', 'ChatStudio.vue'), 'utf8');
  await t('firstFrame/lastFrame 取槽位数组而不是 imageUrls[0]/[1]', () => {
    assert(!/firstFrame:.*imageUrls\[0\]/.test(vue), '仍在用 imageUrls 下标');
    assert(/firstFrame: isKeyframeMode \? \(slotUrls\[0\] \|\| undefined\)/.test(vue), '首帧没按 slotUrls[0]');
    assert(/lastFrame: isKeyframeMode \? \(slotUrls\[1\] \|\| undefined\)/.test(vue), '尾帧没按 slotUrls[1]');
    assert(/slotUrls\.push\(mediaKind\(item\) === 'image'/.test(vue), '槽位没按可见槽位对齐');
  });
  await t('复用配方重签发引用 + 会话状态重置', () => {
    assert(/resignAssetUrl\(rawUrl\)/.test(vue), '复用时没重签发 token');
    assert(vue.includes('resolved: !!url && !url.startsWith(\'blob:\')'), 'blob 引用没标记为不可用');
    assert(/function resetComposerState\(\)[\s\S]*sessionRefPool\.value = \[\][\s\S]*activeSkillIds\.value = \[\]/.test(vue), '会话切换没清引用池和技能');
    assert(/createNewSession\(\{ keepComposer: true \}\)/.test(vue), '首条消息懒建会话会误清技能');
  });
  await t('显示名写进 modelKey 的旧配方能反查回契约 id', () => {
    assert(vue.includes('function repairStudioModelKeys()'), '缺 repairStudioModelKeys');
    assert(/applyTemplate[\s\S]{0,4000}repairStudioModelKeys\(\);/.test(vue), '复用路径没调用回退');
  });
  await t('假元数据已下线，徽章跟随所选模型', () => {
    assert(!/videoCameraMove/.test(vue), '运镜假参数还在');
    assert(!/30 FPS/.test(vue), '伪造 30 FPS 还在');
    assert(vue.includes('{{ getModelDisplayName(videoModelKey) }} 驱动'), '徽章仍写死 Seedance 2.5');
  });

  console.log('\n=== 5. 对话产物取图（脚本断言，不跑模型）===');
  await t('产物图/下载优先走素材路由，不吃会被清理的 temp 目录', () => {
    assert(/function resultImageCandidates\(msg\)[\s\S]{0,200}getAssetImageUrl\(msg\.assetFid\)[\s\S]{0,120}msg\.imageUrl/.test(vue), '降级候选不是「素材路由在前、temp 直链在后」');
    assert(/function resultImageSrc\(msg\)[\s\S]{0,160}resultImageCandidates\(msg\)/.test(vue), '产物图没走候选列表取图');
    assert(/:src="resultImageSrc\(msg\)"/.test(vue), '图片卡片没换成素材路由');
    assert(/function resultImageDownloadHref\(msg\)[\s\S]{0,200}getAssetDownloadUrl\(msg\.assetFid\)/.test(vue), '下载仍指向 temp 文件');
    assert(!/:href="authedMediaUrl\(msg\.imageUrl\)"/.test(vue), '下载按钮还挂着裸 temp 地址');
  });
  await t('换登录后已渲染的媒体会重签 token（localStorage 不是响应式源）', () => {
    assert(/function authedMediaUrl\(raw\)\s*\{\s*void mediaAuthTick\.value;/.test(vue), '取图地址没把 token 拉进依赖图');
    assert(/window\.addEventListener\('ml_login', bumpMediaAuth\)/.test(vue), '登录事件没触发重签');
    assert(/window\.addEventListener\('ml_auth_required', bumpMediaAuth\)/.test(vue), '掉登录事件没触发重签');
    assert(/window\.removeEventListener\('ml_login', bumpMediaAuth\)/.test(vue), '卸载没摘 ml_login 监听');
  });
  await t('破图先换备胎路由，换完仍失败才报错并给出真实原因', () => {
    assert(/@error="onResultImgError\(msg\)"/.test(vue), '图片失败没有走降级回调');
    assert(/if \(idx \+ 1 < list\.length\)[\s\S]{0,120}msg\.imgSrcIdx = idx \+ 1;[\s\S]{0,120}return;/.test(vue), '还有备胎就直接报错，等于白降级');
    assert(/await probeMediaError\(msg, list\[idx\]\)/.test(vue), '最后一条也失败时没探真实原因');
    assert(/msg\.imgErr = `HTTP \$\{res\.status\}`/.test(vue), '探到的 HTTP 状态码没落到 msg.imgErr');
    assert(/v-if="msg\.imgFailed"/.test(vue), '失败后仍是浏览器默认破图标');
    assert(/这张产物取不到了\{\{ msg\.imgErr \?/.test(vue), '浮层没把真实原因显示出来');
    assert(/resultImageSrc\(msg\)\.replace\(\/token=\[\^&\]\*\/, 'token=\*\*\*'\)/.test(vue), '失败卡片没显示真正请求的 URL（无法自查路由）');
    assert(/function retryResultImage\(msg\)[\s\S]{0,260}msg\.imgSrcIdx = 0/.test(vue), '重试没退回第一个候选');
    assert(/_r=\$\{msg\.imgRetry\}/.test(vue), '重试 URL 不变，会直接吃浏览器缓存');
  });
  await t('真实库里确实存在「衍生图没了、temp 还活着」的产物，降级不是纸上功夫', () => {
    // temp 直链不落 derivatives 表，只存在 chat_messages.result_json 里，所以两边都得按磁盘实文件判活
    const rows = db.prepare(
      "SELECT result_json FROM chat_messages WHERE result_json LIKE '%imageUrl%' AND result_json LIKE '%assetFid%' ORDER BY id DESC LIMIT 120"
    ).all();
    let derivGone = 0, bothAlive = 0, bothDead = 0;
    for (const r of rows) {
      let j = null;
      try { j = JSON.parse(r.result_json); } catch (_) { continue; }
      const fid = String(j.assetFid || '');
      const img = String(j.imageUrl || '');
      if (!fid || !img) continue;
      const d = db.prepare("SELECT storage_ref, storage_type FROM derivatives WHERE asset_fid=? AND kind='origin' ORDER BY id DESC LIMIT 1").get(fid);
      const derivAlive = d ? fs.existsSync(absOf(d.storage_ref, d.storage_type)) : false;
      const tempAbs = absOf(img.replace(/^\/api\//, '').split('?')[0], 'local_cache');
      const tempAlive = fs.existsSync(tempAbs);
      if (!derivAlive && tempAlive) derivGone += 1;
      else if (derivAlive && tempAlive) bothAlive += 1;
      else if (!derivAlive && !tempAlive) bothDead += 1;
    }
    const scanned = derivGone + bothAlive + bothDead;
    if (!scanned) return; // 这台机器上没有可判定的历史产物，不判失败
    assert(derivGone > 0 || bothDead === 0, `${scanned} 条产物里，${bothDead} 条两条路由都死、${derivGone} 条只剩 temp —— 说明只剩「素材路由 → temp 直链」这一条降级路`);
  });
  const appVue = fs.readFileSync(path.join(__dirname, '..', 'web-pro', 'src', 'App.vue'), 'utf8');
  await t('旧页签能自己发现新构建（不再靠人肉刷新）', () => {
    assert(/async function checkForUpdate\(\)/.test(appVue), '没有新版本探测');
    assert(/cache: 'no-store'/.test(appVue), '探测 index.html 会吃到缓存，永远发现不了新版本');
    assert(/document\.addEventListener\('visibilitychange', onVisibilityChange\)/.test(appVue), '切回页签时不探测');
    assert(/setInterval\(checkForUpdate/.test(appVue), '一直盯在页签上的场景没有周期探测');
    assert(/clearInterval\(updateTimer\)/.test(appVue), '卸载时没清定时器');
    assert(/reloadForUpdate/.test(appVue), '提示里没有刷新入口');
  });

  console.log('\n=== 6. 未授权要当场要登录（不能只给一屏破图）===');
  const webApi = fs.readFileSync(path.join(__dirname, '..', 'web-pro', 'src', 'api.js'), 'utf8');
  const loginModal = fs.readFileSync(path.join(__dirname, '..', 'web-pro', 'src', 'components', 'LoginModal.vue'), 'utf8');
  await t('服务端判定未授权时，本地死 token 先作废再广播（否则登录框永远弹不出）', () => {
    assert(/export function reportUnauthorized\(\)\s*\{\s*setSession\('', null\);\s*notifyAuthRequired\('expired'\);/.test(webApi), '未授权没收口：没清会话或没带 expired 原因');
    assert(/if \(res\.status === 401\) \{\s*reportUnauthorized\(\);/.test(webApi), 'authFetch 还在自己清会话，媒体链路收不到同一个口');
    assert(!/if \(!isLoggedIn\(\)\) openLogin\(\);/.test(appVue), 'App 仍用「本地有 token 字符串」当已登录 —— 死会话永远不弹框');
    assert(/openLogin\(e && e\.detail === 'expired' \? '登录已过期，请重新登录' : ''\)/.test(appVue), '过期原因没透到登录框');
  });
  await t('监听建在 setup 阶段，抢在子视图首屏 401 之前', () => {
    const at = appVue.indexOf("window.addEventListener('ml_auth_required'");
    const mountAt = appVue.indexOf('onMounted(() =>');
    assert(at > -1 && mountAt > -1 && at < mountAt, 'ml_auth_required 注册晚于 onMounted：子视图先 401 时原因会被丢掉');
    assert(/window\.removeEventListener\('ml_auth_required', onAuthRequired\)/.test(appVue), '卸载没摘监听');
  });
  await t('进页面 / 切回页签各验一次会话，网络异常不算掉登录', () => {
    assert(/export async function verifySession\(\)/.test(webApi), '没有服务端会话校验');
    assert(/if \(e && e\.name === 'AuthRequiredError'\) return false;\s*return true;/.test(webApi), '把断网当成了掉登录');
    assert(/guardSession\(\);[\s\S]{0,120}\}\);/.test(appVue), '挂载时没验会话');
    assert(/checkForUpdate\(\);\s*guardSession\(\);/.test(appVue), '切回页签时没验会话');
  });
  await t('带原因的登录框不给点背景关掉', () => {
    assert(/reason: \{ type: String, default: '' \}/.test(loginModal), 'LoginModal 没接原因');
    assert(/@click\.self="onBackdrop"/.test(loginModal), '背景点击还是直接关框');
    assert(/function onBackdrop\(\)\s*\{\s*if \(props\.reason\) return;/.test(loginModal), '带原因时仍能点背景逃掉登录');
    assert(/v-if="reason"/.test(loginModal), '原因文案没显示');
  });
  await t('产物图 401 不再换备胎，直接要登录；登录后自动清失败态', () => {
    assert(/if \(res\.status === 401 \|\| res\.status === 403\) \{\s*msg\.imgAuth = true;\s*reportUnauthorized\(\);/.test(vue), '401/403 没走「要登录」这条');
    assert(/if \(idx === 0\) \{[\s\S]{0,260}await probeMediaError\(msg, list\[0\]\);[\s\S]{0,120}if \(msg\.imgAuth\) \{ msg\.imgFailed = true; return; \}/.test(vue), '第一条失败没先判性质，用户要等两条路都破才知道是没登录');
    assert(/@load="onResultImgLoad\(msg\)"/.test(vue), '重新登录后失败态不会自己清，图出来了还压着浮层');
    assert(/@click="reportUnauthorized\(\)">重新登录</.test(vue), '浮层上没有「重新登录」这个可行动入口');
    assert(/if \(msg\.imgAuth\) return;/.test(vue), '已经在要登录了还在继续换路由刷破图');
  });
  await t('失效引用不提交：正文里的死标签会先拦住', () => {
    assert(/\.inline-asset-chip\[data-resolved="0"\]/.test(vue), '没检测未解析芯片');
    assert(/const deadChips =[\s\S]{0,400}composerError\.value = [\s\S]{0,200}\n\s*return;/.test(vue), '死芯片没阻断提交');
  });
  await t('旧配方引用缺失时复用即提示，而不是静默降级', () => {
    assert(/这条旧配方没能恢复/.test(vue), '复用路径缺引用丢失提示');
  });
  await t('旧配方顶层 ratio/resolution 会回填进 schemaParams', () => {
    // 提交优先读 schemaParams.ratio，只回填 selectedRatio 会被上一个模型的残留值盖掉
    assert(/legacySeed\.ratio = params\.ratio/.test(vue), 'ratio 没写回 schemaParams');
    assert(/legacySeed\.resolution = params\.resolution/.test(vue), 'resolution 没写回 schemaParams');
    assert(/!isFieldLocked\('ratio'\)/.test(vue), '没避开模式锁定（首尾帧强制 adaptive）');
  });
  await t('真实目录里，配方存的显示名能反查到契约 id', () => {
    const { getModelPublicCatalog } = require('../src/models-contract');
    const catalog = getModelPublicCatalog(db);
    const row = db.prepare("SELECT params_json FROM creation_templates WHERE type='video' ORDER BY use_count DESC LIMIT 1").get();
    if (!row) return;
    const stored = (JSON.parse(row.params_json || '{}').model) || '';
    const list = catalog.studio.video.models;
    const hit = list.find((m) => m.name === stored || `${m.name} · ${m.badge}` === stored || m.id === stored);
    assert(hit, `目录里找不到配方存的模型名「${stored}」`);
    assert(list.some((m) => m.id === hit.id), '命中的不是启用列表里的 id');
  });

  server.close();
  db.close();
  try { fs.rmSync(DB, { force: true }); } catch (_) {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试自身异常:', e); process.exit(2); });
