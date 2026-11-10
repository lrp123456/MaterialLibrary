/**
 * P3 验收：创作配方（服务端同源）/ 语音输入 / 图片快捷工具 / 3D 朝向拖拽。
 *
 * 纯静态契约断言：不启动服务、不碰生产数据。
 * 服务端只校验 viewer 白名单与处理器守卫，确认没有为了 App 降低权限。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function main() {
  // ── 服务端：配方库与语音路由对 viewer 开放，但处理器仍是登录守卫 ──
  const api = read('src/api.js');
  assert.ok(api.includes("['GET', /^\\/creation-templates$/]"), 'viewer 白名单必须包含配方列表');
  assert.ok(api.includes("['POST', /^\\/creation-templates\\/pull-external$/]"), 'viewer 白名单必须包含外部拉取');
  assert.ok(api.includes("['PATCH', /^\\/creation-templates\\/[^\\/]+$/]"), 'viewer 白名单必须包含配方 PATCH');
  assert.ok(api.includes("['DELETE', /^\\/creation-templates\\/[^\\/]+$/]"), 'viewer 白名单必须包含配方删除');
  assert.ok(api.includes("['GET', /^\\/asr\\/status$/]") && api.includes("['POST', /^\\/asr\\/transcribe$/]"), 'viewer 白名单必须包含语音状态与转写');
  const asrGate = api.slice(api.indexOf("pathname === '/asr/status' || pathname === '/asr/transcribe'"));
  const asrGuardAt = asrGate.indexOf('isViewerOrAdmin');
  const asrHandlerAt = asrGate.indexOf("require('./asr').handleAsrApi");
  assert.ok(asrGuardAt > -1 && asrHandlerAt > asrGuardAt, 'ASR 路由必须先做登录守卫');
  const tplGet = api.slice(api.indexOf("pathname === '/creation-templates' && req.method === 'GET'"));
  assert.ok(tplGet.includes('isViewerOrAdmin'), '配方列表处理器必须保持登录守卫');

  // ── ViewerApi：配方 + 语音客户端契约 ──
  const viewerApi = read('app-uniapp/src/service/ViewerApi.js');
  for (const fn of [
    'fetchCreationTemplates',
    'createCreationTemplate',
    'markCreationTemplateUsed',
    'patchCreationTemplate',
    'deleteCreationTemplate',
    'pullExternalCreationTemplates',
    'fetchAsrStatus',
    'transcribeVoiceFile',
    'transcribeVoiceBlob',
  ]) {
    assert.ok(viewerApi.includes(`export async function ${fn}`) || viewerApi.includes(`export function ${fn}`), `ViewerApi 必须导出 ${fn}`);
  }
  const useFn = viewerApi.slice(viewerApi.indexOf('export async function markCreationTemplateUsed'));
  assert.ok(useFn.slice(0, 400).includes("action: 'use'"), '复用配方必须上报 action=use 累加频次');
  assert.ok(viewerApi.includes("form.append('file', blob, filename)") && viewerApi.includes('new FormData()'), 'H5 语音必须用 multipart 上传 blob');
  assert.ok(viewerApi.includes('/asr/transcribe?clean=1'), '语音转写必须带 clean=1');

  // ── 创作库抽屉：真实服务端配方，不再使用本地假数据 ──
  const drawer = read('app-uniapp/src/components/CreationLibraryDrawer.vue');
  assert.ok(!drawer.includes('PRESET_TEMPLATES'), '配方不得再使用本地预置数组');
  assert.ok(drawer.includes('fetchCreationTemplates'), '抽屉必须从服务端拉取配方');
  assert.ok(drawer.includes("'apply-template'"), '抽屉必须向父级抛出应用配方事件');
  assert.ok(drawer.includes('@click="onApplyTemplate(tpl)"'), '点卡片必须应用配方');
  assert.ok(drawer.includes('@longpress="openTemplateMenu(tpl)"'), '长按必须能置顶/重命名/删除');
  assert.ok(drawer.includes('uni.showActionSheet({'), '长按菜单必须使用系统操作表');
  assert.ok(drawer.includes('pullExternalCreationTemplates'), '必须能拉取外部数据源配方');
  assert.ok(drawer.includes('templatesLoading') && drawer.includes('templatesError'), '必须有加载与失败态');
  assert.ok(drawer.includes('typeLabel(tpl.type)'), '配方卡片必须展示类型');
  assert.ok(drawer.includes('saveCurrentRecipe') && drawer.includes('createCreationTemplate('), '必须能把当前输入存为配方');

  // ── 首页：应用配方（模型/模式/参数/参考图/提示词全量恢复）──
  const home = read('app-uniapp/src/pages/home/home.vue');
  assert.ok(home.includes('@apply-template="applyLibraryTemplate"'), '首页必须接收配方应用事件');
  assert.ok(home.includes('applyLibraryTemplate(tpl)'), '必须实现配方应用');
  assert.ok(home.includes('applyTemplateModel(this.domain, modelKey)'), '配方必须恢复模型');
  assert.ok(home.includes('resolveTemplateDomain(tpl)'), '配方必须恢复模态域');
  assert.ok(home.includes('params.schemaParams'), '配方必须恢复 schema 参数');
  assert.ok(home.includes("this.refs = originRefs"), '配方必须恢复参考图');
  assert.ok(home.includes('mediaUrl(fid)'), '配方参考图必须按 fid 重新签名');
  assert.ok(home.includes('valueStillFits'), '旧配方的画幅/分辨率必须按字段契约校验');
  assert.ok(home.includes('this.inputPrompt = tpl.prompt'), '配方必须恢复提示词');

  // ── 首页：语音输入 ──
  assert.ok(home.includes('<VoiceInputButton :disabled="sending" @text="onVoiceText" />'), '输入栏必须挂语音按钮');
  assert.ok(home.includes('import VoiceInputButton'), '必须引入语音按钮组件');
  assert.ok(home.includes('onVoiceText(text)'), '必须把识别文本写回输入框');

  const voice = read('app-uniapp/src/components/VoiceInputButton.vue');
  assert.ok(voice.includes('getRecorderManager') && voice.includes('MediaRecorder'), 'App 与 H5 都必须支持录音');
  assert.ok(voice.includes('transcribeVoiceFile') && voice.includes('transcribeVoiceBlob'), '两条录音通道都必须转写');
  assert.ok(voice.includes('normalizeSpeechRefMentions'), '语音里的「图一/图1」必须归一为 @图N');
  assert.ok(voice.includes('MAX_SECONDS = 60') && voice.includes('duration: MAX_SECONDS * 1000'), '录音必须有 60 秒上限');
  assert.ok(voice.includes('@longpress="onLongPress"'), '长按必须能取消本次录音');
  assert.ok(voice.includes('transcribeReady === false'), '转写服务未就绪必须给出提示');

  const icons = read('app-uniapp/src/components/iconData.js');
  assert.ok(icons.includes('mic:') && icons.includes('stop:'), '必须补充麦克风/停止图标');

  // ── 详情页：六项图片快捷工具必须可达 ──
  const detail = read('app-uniapp/src/pages/detail/detail.vue');
  assert.ok(detail.includes('openQuickTools'), '详情必须有图片工具入口');
  assert.ok(detail.includes('图片工具'), '详情操作区必须有图片工具按钮');
  for (const page of ['enhance', 'expand', 'insert', 'remove', 'replace', 'watermark']) {
    assert.ok(detail.includes(`'${page}'`), `图片工具必须包含 ${page}`);
  }
  assert.ok(detail.includes('/pages/quick/${page}?fid='), '图片工具必须带上资产与画幅参数');

  const pagesJson = read('app-uniapp/src/pages.json');
  for (const page of ['enhance', 'expand', 'insert', 'remove', 'replace', 'watermark']) {
    assert.ok(pagesJson.includes(`"path": "pages/quick/${page}"`), `pages.json 必须注册 ${page}`);
  }

  // ── 3D 朝向页：舞台可拖拽旋转模型本体 ──
  const yaw = read('app-uniapp/src/static/model-yaw.html');
  assert.ok(yaw.includes('id="dragHot"'), '必须提供拖拽热区');
  assert.ok(yaw.includes("addEventListener('pointerdown'"), '必须支持指针拖拽');
  assert.ok(yaw.includes('YAW_PER_PX') && yaw.includes('PITCH_PER_PX'), '横纵拖动必须分别映射方位/俯仰');
  assert.ok(yaw.includes('yawInput.value = String(normalizeYaw('), '拖拽必须回写滑杆值');
  assert.ok(yaw.includes('touch-action: none'), '拖拽热区必须禁用浏览器滚动/缩放');

  // ── 生成任务队列的安全顺序：先鉴权/落库，再中断执行 ──
  const cancelAuthAt = api.indexOf('cancelGenJob(db, jobId, sessionUser.id)');
  const abortAt = api.indexOf('abortJob(jobId)');
  assert.ok(cancelAuthAt > -1 && abortAt > cancelAuthAt,
    '取消接口必须先 cancelGenJob 鉴权，再 abortJob，禁止越权抢先打断他人任务');
  const enqueue = api.slice(api.indexOf("pathname === '/gen/jobs' && req.method === 'POST'"));
  const enqueueOwnedAt = enqueue.indexOf('chatSessionOwned(b.sessionId)');
  const enqueueAt = enqueue.indexOf('enqueueGenJob(db, payload)');
  assert.ok(enqueueOwnedAt > -1 && enqueueOwnedAt < enqueueAt,
    '入队必须校验会话归属，防止往他人会话注入 assistant 消息');

  // ── 生图报错：429/超时要有专门建议，旧消息里的调试 JSON 不能误触发「改画幅」──
  const chatStudio = read('web-pro/src/views/studio/ChatStudio.vue');
  assert.ok(chatStudio.includes('HTTP 429|service is busy'), '429 繁忙必须有专门处置建议');
  assert.ok(chatStudio.includes('aborted due to timeout'), '本地等待超时必须有专门处置建议');
  assert.ok(chatStudio.includes('实际请求参数'), '必须清理旧错误消息尾部的调试参数');
  const genIndex = read('src/gen/index.js');
  assert.ok(genIndex.includes('MAX_ATTEMPTS = 3'), '429 限流应做有限次退避重试');
  assert.ok(genIndex.includes('Math.max(timeoutMs, 300000)'), '高画质 VIP 出图等待上限应放宽到 5 分钟');
  assert.ok(genIndex.includes('vipFailureInfo('), '上游错误应转成结构化文案');

  // ── 后台生成不阻塞其它会话：发送按钮/进度提示只看当前会话 ──
  assert.ok(chatStudio.includes('const currentGenerating = computed('),
    '必须按当前会话派生生成中状态，不能用全局 generating 单例');
  assert.ok(chatStudio.includes(':disabled="currentGenerating"'),
    '立即生成/发送按钮不能被其它会话的后台任务置灰');
  assert.ok(chatStudio.includes('v-if="currentGenerating && !hasGeneratingPlaceholder"'),
    '生成进度提示只看当前会话');
  assert.ok(!chatStudio.includes(':disabled="generating"'),
    '模板里不能再有全局 generating 的 disabled 绑定');

  console.log('✔ P3 创作配方/语音/图片工具/3D 拖拽/会话级生成状态验收通过');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
