<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />

    <!-- 顶栏：抽屉汉堡 | 4大模式分段器 (对话/图片/视频/音乐) | 创作库与清空 -->
    <view class="topbar">
      <!-- 左侧：会话抽屉入口 -->
      <view class="icon-btn" @click="drawerOpen = true" hover-class="icon-btn-hover" title="会话管理">
        <AppIcon name="menu" :size="20" color="#1E293B" />
      </view>

      <!-- 中间：原生 Segmented Control (对话/图片/视频/音乐) -->
      <view class="segment-wrap">
        <view
          v-for="d in visibleDomains"
          :key="d.id"
          class="segment-item"
          :class="{ active: domain === d.id }"
          @click="switchDomain(d.id)"
          hover-class="segment-hover"
        >
          <text class="segment-t">{{ d.label }}</text>
        </view>
      </view>

      <!-- 右侧：创作库入口 & 清空 -->
      <view class="topbar-right">
        <view class="top-lib-btn" @click="libraryOpen = true" hover-class="top-lib-hover" title="打开创作库">
          <AppIcon name="sparkle" :size="14" color="#007AFF" />
          <text class="top-lib-t">创作库</text>
        </view>
        <view v-if="chatList.length" class="icon-btn clear" @click="confirmClearChat" hover-class="icon-btn-hover">
          <text class="topbar-clear">清空</text>
        </view>
      </view>
    </view>

    <!-- 次级模式胶囊（图片：标准生图/人像；音乐：纯音乐/文生歌） -->
    <view v-if="domain === 'image'" class="sub-mode-bar">
      <view class="sub-chip" :class="{ active: imageSub === 'standard' }" @click="setImageSub('standard')">
        <text class="sub-chip-t">标准生图</text>
      </view>
      <view class="sub-chip" :class="{ active: imageSub === 'portrait' }" @click="setImageSub('portrait')">
        <text class="sub-chip-t">人像写真</text>
      </view>
    </view>
    <view v-else-if="domain === 'music'" class="sub-mode-bar">
      <view class="sub-chip" :class="{ active: musicMode === 'text_to_bgm' }" @click="setMusicMode('text_to_bgm')">
        <text class="sub-chip-t">纯音乐</text>
      </view>
      <view class="sub-chip" :class="{ active: musicMode === 'text_to_song' }" @click="setMusicMode('text_to_song')">
        <text class="sub-chip-t">文生歌</text>
      </view>
    </view>

    <!-- 精准编辑交接横幅（可退出） -->
    <view v-if="pendingEdit" class="edit-banner">
      <image v-if="pendingEdit.sourceFid" class="edit-banner-img" :src="media(pendingEdit.sourceFid)" mode="aspectFill" />
      <view class="edit-banner-meta">
        <text class="edit-banner-title">精准编辑 · {{ pendingEditLabel }}</text>
        <text class="edit-banner-sub" number-of-lines="1">{{ pendingEditDetail }}</text>
      </view>
      <view class="edit-banner-close" @click="clearPendingEdit" hover-class="edit-banner-close-hover"><text class="edit-banner-close-t">✕</text></view>
    </view>

    <!-- 家具参考 · 3D 朝向 -->
    <view v-if="needs3dModel" class="model3d-card">
      <view class="model3d-head">
        <text class="model3d-title">家具参考 · 3D 朝向</text>
        <text class="model3d-status" :class="{ ok: !!modelSnapshotUrl }">{{ modelSnapshotUrl ? '已截图' : '待截图' }}</text>
      </view>
      <view v-if="!selectedProduct" class="model3d-empty">
        <text class="model3d-empty-t">{{ pendingEdit.op === 'add' ? '新增物体需要先选一个带 3D 模型的家具单品' : '替换物体需要先选一个带 3D 模型的家具单品' }}</text>
        <view class="model3d-pick" @click="openProductPicker" hover-class="model3d-pick-hover">
          <text class="model3d-pick-t">选择家具单品</text>
        </view>
      </view>
      <view v-else class="model3d-body">
        <image
          v-if="modelSnapshotUrl"
          :src="modelSnapshotUrl"
          class="model3d-thumb"
          mode="aspectFit"
          @click="openRefLightboxByUrl(modelSnapshotUrl, '3D 朝向截图')"
        />
        <image v-else :src="selectedProductPreview" class="model3d-thumb" mode="aspectFill" />
        <view class="model3d-meta">
          <text class="model3d-name" number-of-lines="1">{{ selectedProduct.name }}</text>
          <text class="model3d-sub">左右 {{ modelYaw }}° · 上下 {{ modelPitch }}°</text>
          <view class="model3d-actions">
            <view class="model3d-btn" @click="openModel3d" hover-class="model3d-btn-hover">
              <text class="model3d-btn-t">{{ modelSnapshotUrl ? '重新调整朝向' : '调整朝向并截图' }}</text>
            </view>
            <view class="model3d-btn ghost" @click="openProductPicker" hover-class="model3d-btn-hover">
              <text class="model3d-btn-t">换单品</text>
            </view>
          </view>
          <text v-if="modelSnapshotError" class="model3d-error">{{ modelSnapshotError }} · 未完成截图前不能发送</text>
          <text v-else-if="!modelSnapshotUrl" class="model3d-warn">未完成 3D 朝向截图前不能发送</text>
        </view>
      </view>
    </view>

    <!-- ========================================================================= -->
    <!-- 创作主工作区：参考图大图工作台 (默认展开) VS 过程记录 -->
    <!-- ========================================================================= -->
    <view class="workspace">
      <!-- 模式 A：默认大图工作台 (敲关键字时可以看到参考大图，沉浸创作) -->
      <view v-if="bigImageMode" class="big-stage-container">
        <!-- 切换收缩胶囊 -->
        <view class="stage-toggle-bar">
          <view class="session-crumb" @click="drawerOpen = true">
            <text class="session-crumb-t" number-of-lines="1">{{ sessionTitle }}</text>
            <AppIcon name="chevron-down" :size="10" color="#94A3B8" />
          </view>
          <view class="stage-toggle-btn" @click="bigImageMode = false" hover-class="stage-toggle-hover">
            <AppIcon name="history" :size="12" color="#64748B" />
            <text class="stage-toggle-t">查看历史记录 ({{ chatList.length }})</text>
          </view>
        </view>

        <!-- 1. 无参考图且无最新视觉产物：居中优雅大卡片 (参考图 0，支持素材库与相册双板块) -->
        <view v-if="!refs.length && !canvasVisualResult && !canvasRunning" class="big-empty-wrap">
          <view class="big-stage-card">
            <!-- 上半区：导入主触控区 -->
            <view class="big-stage-hero" @click="chooseLocalImage" hover-class="big-stage-hero-hover">
              <view class="big-stage-plus-circle">
                <AppIcon name="plus" :size="30" color="#0F172A" />
              </view>
              <text class="big-stage-label">{{ domain === 'video' ? '导入参考画面' : '导入图片' }}</text>
              <text class="big-stage-hint">轻触选图 · 即刻开展 AI 创作</text>
            </view>

            <!-- 下半区：两个核心导入板块 -->
            <view class="big-stage-plates">
              <!-- 板块 1：素材库内素材 -->
              <view class="stage-plate-item" @click.stop="openPicker" hover-class="stage-plate-hover">
                <view class="stage-plate-icon blue">
                  <AppIcon name="folder" :size="16" color="#007AFF" />
                </view>
                <view class="stage-plate-texts">
                  <text class="stage-plate-title">素材库素材</text>
                  <text class="stage-plate-sub">选用云端资产</text>
                </view>
                <AppIcon name="chevron-right" :size="11" color="#94A3B8" />
              </view>

              <view class="stage-plate-divider" />

              <!-- 板块 2：相册内素材 -->
              <view class="stage-plate-item" @click.stop="chooseLocalImage" hover-class="stage-plate-hover">
                <view class="stage-plate-icon green">
                  <AppIcon name="album" :size="16" color="#10B981" />
                </view>
                <view class="stage-plate-texts">
                  <text class="stage-plate-title">相册内素材</text>
                  <text class="stage-plate-sub">本地照片/拍照</text>
                </view>
                <AppIcon name="chevron-right" :size="11" color="#94A3B8" />
              </view>
            </view>
          </view>
        </view>

        <!-- 2. 有参考图时：横向大卡片流 (参考图 1) -->
        <view v-else-if="refs.length" class="big-refs-section">
          <scroll-view scroll-x class="big-refs-scroll" :show-scrollbar="false">
            <view class="big-refs-row">
              <view
                v-for="(r, i) in refs"
                :key="r.id || i"
                class="big-ref-card"
                @click="openRefLightbox(i)"
              >
                <image :src="r.url" class="big-ref-img" mode="aspectFill" />
                <view class="big-ref-close" @click.stop="removeRef(i)" hover-class="big-ref-close-hover">
                  <AppIcon name="close" :size="11" color="#FFFFFF" />
                </view>
                <view class="big-ref-tag">
                  <text class="big-ref-tag-t">图{{ i + 1 }}</text>
                </view>
              </view>
              <!-- 尾随 + 小卡片继续追加 -->
              <view v-if="canAddRef" class="big-ref-add-card" @click="openRefAddOptions" hover-class="big-ref-add-hover">
                <AppIcon name="plus" :size="22" color="#64748B" />
                <text class="big-ref-add-t">添加</text>
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 3. 最新生成产物或正在生成态展示 -->
        <view v-if="canvasRunning || canvasVisualResult || canvasFailed" class="big-result-card">
          <!-- 生成中状态：原地脉冲进度条，非阻塞 -->
          <view v-if="canvasRunning" class="result-running">
            <view class="result-pulse-ring" />
            <text class="result-running-t">{{ canvasRunning.engineTitle || 'AI 正在全力构思中…' }}</text>
            <view class="result-prog-bar">
              <view class="result-prog-fill" :style="{ width: (canvasRunning.progress || 24) + '%' }" />
            </view>
            <text class="result-running-sub" number-of-lines="2">{{ canvasRunning.prompt }}</text>
          </view>

          <!-- 失败状态 -->
          <view v-else-if="canvasFailed" class="result-failed">
            <text class="result-failed-t">{{ canvasFailed.error || '生成失败' }}</text>
            <view class="canvas-mini-btn" @click="retryMessage(canvasFailed)">
              <text class="canvas-mini-btn-t">重新尝试</text>
            </view>
          </view>

          <!-- 成功结果展示 -->
          <block v-else-if="canvasVisualResult">
            <view class="result-media-wrap">
              <image
                v-if="canvasVisualResult.kind === 'image' || canvasVisualResult.kind === 'portrait'"
                class="result-media-img"
                :src="canvasVisualResult.url"
                mode="aspectFit"
                :show-menu-by-longpress="true"
                @click="openLightbox(canvasVisualResult.url, 'image', canvasVisualResult.label || '生成结果')"
              />
              <video
                v-else-if="canvasVisualResult.kind === 'video'"
                class="result-media-video"
                :src="canvasVisualResult.url"
                controls
                object-fit="contain"
              />
              <audio
                v-else-if="canvasVisualResult.kind === 'audio'"
                class="canvas-audio"
                :src="canvasVisualResult.url"
                controls
                :name="canvasVisualResult.label || '音频'"
              />
            </view>

            <!-- 产物快捷动作条 -->
            <view class="result-actions">
              <view class="result-act" @click="copyMessage(canvasMsg)" hover-class="result-act-hover">
                <AppIcon name="copy" :size="13" color="#0F172A" />
                <text class="result-act-t">复制词</text>
              </view>
              <view v-if="isImageResult(canvasMsg)" class="result-act" @click="mountResultAsRef(canvasMsg, 'image_to_image')" hover-class="result-act-hover">
                <AppIcon name="image" :size="13" color="#0F172A" />
                <text class="result-act-t">以此图生图</text>
              </view>
              <view v-if="isImageResult(canvasMsg)" class="result-act" @click="mountResultAsRef(canvasMsg, 'image_to_video')" hover-class="result-act-hover">
                <AppIcon name="video" :size="13" color="#0F172A" />
                <text class="result-act-t">转生视频</text>
              </view>
              <view v-if="canvasVisualResult.url" class="result-act accent" @click="saveResultToAlbum(canvasMsg)" hover-class="result-act-hover">
                <AppIcon name="download" :size="13" color="#007AFF" />
                <text class="result-act-t">存相册</text>
              </view>
            </view>
          </block>
        </view>
      </view>

      <!-- 模式 B：过程记录模式 (收缩大图，展示完整对话流) -->
      <view v-else class="compact-history-container">
        <!-- 顶部收缩参考图指示条：点击即可随时展开回大图 -->
        <view class="compact-top-bar" @click="bigImageMode = true" hover-class="compact-top-hover">
          <view class="compact-top-left">
            <AppIcon name="expand" :size="14" color="#007AFF" />
            <text class="compact-top-t">点击展开参考大图</text>
          </view>
          <view v-if="refs.length" class="compact-refs-strip">
            <image v-for="(r, i) in refs" :key="r.id || i" :src="r.url" class="compact-thumb" mode="aspectFill" />
          </view>
        </view>

        <!-- 历史滚动列表 -->
        <scroll-view
          scroll-y
          class="history-scroll"
          :scroll-into-view="scrollIntoId"
          :scroll-with-animation="true"
          :enhanced="true"
          :bounces="false"
        >
          <view v-if="!chatList.length" class="history-empty">
            <AppIcon name="chat" :size="32" color="#CBD5E1" />
            <text class="history-empty-t">还没有创作记录，在下方输入你的画面构想</text>
          </view>
          <view
            v-for="(msg, idx) in chatList"
            :key="msg.id || idx"
            :id="'msg-' + (msg.id || idx)"
            class="h-row"
            :class="msg.role === 'user' ? 'h-user' : 'h-ai'"
          >
            <block v-if="msg.role === 'user'">
              <view class="h-user-bubble">
                <text class="h-user-t">{{ msg.prompt }}</text>
                <view v-if="msg.images && msg.images.length" class="h-user-refs">
                  <text class="h-user-refs-t">参考图 {{ msg.images.length }} 张</text>
                </view>
              </view>
            </block>
            <block v-else>
              <view class="h-ai-row" @click="focusHistoryMessage(msg)">
                <view class="h-ai-thumb" :class="'kind-' + ((msg.result && msg.result.kind) || 'text')">
                  <image v-if="itemThumb(msg)" :src="itemThumb(msg)" class="h-ai-thumb-img" mode="aspectFill" />
                  <AppIcon v-else :name="itemKindIconName(msg)" :size="16" color="#007AFF" />
                </view>
                <view class="h-ai-main">
                  <view class="h-ai-meta">
                    <text class="h-ai-model" number-of-lines="1">{{ msg.modelName || '创作助手' }}</text>
                    <text class="h-ai-status" :class="'st-' + (msg.status || 'done')">{{ historyStatusText(msg) }}</text>
                  </view>
                  <text class="h-ai-text" number-of-lines="2">{{ historySummary(msg) }}</text>
                </view>
              </view>
            </block>
          </view>
          <view class="msg-tail" />
        </scroll-view>
      </view>
    </view>

    <!-- ========================================================================= -->
    <!-- 底部输入坞 (严格按照规格重排：首位模型 -> 画幅/清晰度 -> 高级配置 -> 发送) -->
    <!-- ========================================================================= -->
    <view class="composer-card">
      <!-- 上半部分：多行文本输入框 -->
      <view class="composer-input-row">
        <textarea
          class="composer-textarea"
          v-model="inputPrompt"
          :auto-height="true"
          :maxlength="-1"
          :show-confirm-bar="false"
          :adjust-position="true"
          :placeholder="placeholderText"
          placeholder-class="composer-ph"
          @focus="isEditingPrompt = true"
          @blur="onPromptBlur"
          @input="onPromptInput"
          confirm-type="send"
          @confirm="sendMessage"
        />
      </view>

      <!-- 规则警告 / 限制提示 -->
      <view v-if="ruleWarnings.length || refError" class="composer-warnings">
        <text v-for="(w, wi) in ruleWarnings" :key="'warn-' + wi" class="composer-warn-t">{{ w }}</text>
        <text v-if="refError" class="composer-warn-t">{{ refError }}</text>
      </view>

      <!-- 下半部分：常用参数排布与操作按钮 -->
      <view class="composer-controls-row">
        <scroll-view scroll-x class="composer-pills-scroll" :show-scrollbar="false">
          <view class="composer-pills-left">
            <!-- 1. 模型选择胶囊 (必放首位) -->
            <view class="capsule-pill model-pill" @click="sheetMode = 'model'" hover-class="capsule-hover">
              <AppIcon name="model" :size="12" color="#475569" />
              <text class="capsule-t strong">{{ currentModelInfo.name || '模型选择' }}</text>
              <AppIcon name="chevron-down" :size="9" color="#64748B" />
            </view>

            <!-- 2. 常用核心参数 (生图优先展示画幅与清晰度；生视频优先展示画幅与时长) -->
            <view
              v-for="f in primaryParams"
              :key="'param-' + f.key"
              class="capsule-pill"
              :class="{ locked: isFieldLocked(f.key) }"
              @click="onParamPill(f)"
              hover-class="capsule-hover"
            >
              <AppIcon :name="paramFieldIcon(f)" :size="11" color="#64748B" />
              <text class="capsule-t">
                <text class="capsule-prefix">{{ paramPrefix(f) }}</text>
                <text class="capsule-sep">·</text>
                <text class="capsule-val">{{ paramDisplay(f) }}</text>
              </text>
              <AppIcon name="chevron-down" :size="9" color="#64748B" />
            </view>

            <!-- 3. 高级配置胶囊 (图层拆分/水印/步数/种子统统收纳进此处) -->
            <view class="capsule-pill more-pill" @click="openMoreParams" hover-class="capsule-hover">
              <AppIcon name="settings" :size="12" color="#64748B" />
              <text class="capsule-t">高级配置</text>
              <text v-if="advancedCustomCount" class="capsule-badge">{{ advancedCustomCount }}</text>
            </view>
          </view>
        </scroll-view>

        <!-- 右侧：灵感优化 & 纯圆发送按钮 -->
        <view class="composer-actions-right">
          <!-- 智能优化 ✨ -->
          <view
            :class="['composer-opt-btn', { disabled: optimizingPrompt || !inputPrompt.trim() }]"
            @click="optimizePromptAction"
            hover-class="opt-hover"
            title="AI 润色提示词"
          >
            <AppIcon name="sparkles" :size="16" :color="inputPrompt.trim() ? '#007AFF' : '#94A3B8'" />
          </view>

          <!-- 发送按钮 ↑ -->
          <view
            :class="['composer-send-btn', { active: canSend && !sending }]"
            @click="sendMessage"
            hover-class="send-hover"
            title="发送"
          >
            <AppIcon name="arrow-up" :size="16" color="#FFFFFF" :strokeWidth="2.6" />
          </view>
        </view>
      </view>

      <!-- 底部微字提示 -->
      <view class="composer-foot-note">
        <text class="foot-note-t">内容由 AI 生成，请核实</text>
      </view>
    </view>

    <!-- @ 联想浮层 -->
    <view v-if="showAtPicker && refs.length" class="at-popup">
      <view class="at-list">
        <view v-for="(r, i) in refs" :key="r.id" class="at-item" @click="insertAtRef(i)">
          <image :src="r.url" class="at-thumb" mode="aspectFill" />
          <view class="at-meta"><text class="at-name">@图{{ i + 1 }}</text><text class="at-sub">{{ r.label }}</text></view>
        </view>
      </view>
    </view>

    <!-- 参数配置底 Sheet -->
    <view v-if="sheetMode" class="sheet-mask" @click="sheetMode = ''">
      <view class="sheet" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">{{ sheetTitle }}</text>
          <view class="sheet-close" @click="sheetMode = ''">
            <AppIcon name="close" :size="16" color="#64748B" />
          </view>
        </view>

        <scroll-view scroll-y class="sheet-body">
          <!-- 模型选择列表 -->
          <template v-if="sheetMode === 'model'">
            <view
              v-for="m in domainModels"
              :key="m.id"
              :class="['model-item', { active: m.id === currentModelId }]"
              @click="selectModel(m)"
              hover-class="model-hover"
            >
              <view class="model-item-main">
                <text class="model-name">{{ m.name }}</text>
                <text class="model-desc" number-of-lines="2">{{ m.desc || m.providerName || '' }}</text>
              </view>
              <AppIcon v-if="m.id === currentModelId" name="check" :size="16" color="#007AFF" />
            </view>
            <view style="height: 16px" />
          </template>

          <!-- 单个参数选项调节 -->
          <template v-else-if="sheetMode === 'param'">
            <view v-if="paramSheetField" class="param-detail">
              <view class="param-detail-head">
                <text class="param-detail-title">{{ paramSheetField.label || paramSheetField.key }}</text>
                <text v-if="isFieldLocked(paramSheetField.key)" class="param-detail-lock">已锁定 · {{ lockReasonOf(paramSheetField.key) }}</text>
                <text v-else-if="paramRangeHint(paramSheetField)" class="param-detail-range">{{ paramRangeHint(paramSheetField) }}</text>
              </view>

              <view v-if="paramSheetField.type === 'enum'" class="option-grid">
                <view
                  v-for="opt in paramOptionsOf(paramSheetField)"
                  :key="String(opt)"
                  :class="['option', { active: sameValue(paramValueOf(paramSheetField), opt), disabled: isFieldLocked(paramSheetField.key) }]"
                  @click="setSchemaParam(paramSheetField.key, opt)"
                >
                  <text class="option-t">{{ optionText(paramSheetField, opt) }}</text>
                </view>
              </view>

              <view v-else-if="paramSheetField.type === 'bool'" class="param-detail-switch">
                <text class="param-detail-switch-t">{{ paramValueOf(paramSheetField) ? '已开启' : '已关闭' }}</text>
                <switch
                  :checked="!!paramValueOf(paramSheetField)"
                  :disabled="isFieldLocked(paramSheetField.key)"
                  color="#007AFF"
                  @change="setSchemaParam(paramSheetField.key, $event.detail.value)"
                />
              </view>

              <view v-else-if="['number', 'range', 'duration'].includes(paramSheetField.type)" class="param-detail-range-wrap">
                <view class="param-detail-value">
                  <text class="param-detail-value-t">{{ paramValueOf(paramSheetField) }}{{ paramUnit(paramSheetField) }}</text>
                  <view
                    v-if="hasSmartStop(paramSheetField)"
                    class="param-smart-chip"
                    :class="{ active: Number(paramValueOf(paramSheetField)) === -1 }"
                    @click="setSchemaParam(paramSheetField.key, -1)"
                  >
                    <text class="param-smart-t">智能</text>
                  </view>
                </view>
                <slider
                  v-if="Number(paramValueOf(paramSheetField)) !== -1 || !hasSmartStop(paramSheetField)"
                  class="param-slider"
                  :min="Number(paramSheetField.min != null ? paramSheetField.min : 0)"
                  :max="Number(paramSheetField.max != null ? paramSheetField.max : 100)"
                  :step="numericStepOf(paramSheetField)"
                  :value="Number(paramValueOf(paramSheetField)) || Number(paramSheetField.min || 0)"
                  :disabled="isFieldLocked(paramSheetField.key)"
                  activeColor="#007AFF"
                  backgroundColor="#E2E8F0"
                  block-size="20"
                  @change="setSchemaParam(paramSheetField.key, $event.detail.value)"
                />
                <view class="param-stepper-row">
                  <view class="param-step-btn" @click="stepParam(paramSheetField, -1)"><text class="param-step-t">－</text></view>
                  <text class="param-step-hint">{{ paramRangeHint(paramSheetField) }}</text>
                  <view class="param-step-btn" @click="stepParam(paramSheetField, 1)"><text class="param-step-t">＋</text></view>
                </view>
              </view>

              <view v-else class="param-detail-switch">
                <input
                  class="param-text-input"
                  :value="paramValueOf(paramSheetField) || ''"
                  :disabled="isFieldLocked(paramSheetField.key)"
                  placeholder="按模型契约填写"
                  placeholder-class="input-ph"
                  @blur="setSchemaParam(paramSheetField.key, $event.detail.value)"
                />
              </view>
            </view>
            <view style="height: 16px" />
          </template>

          <!-- 高级配置总览 (次要参数收纳 + 最底部预览请求) -->
          <template v-else-if="sheetMode === 'more'">
            <view v-if="schemaParamSections.length">
              <view v-for="sec in schemaParamSections" :key="'sec-' + sec.key" class="param-section">
                <text class="param-section-title">{{ sec.title }}</text>
                <view v-for="f in sec.fields" :key="'pf-' + f.key" class="param-field">
                  <view class="param-field-label">
                    <text class="param-field-t">{{ f.label || f.key }}</text>
                    <text v-if="isFieldLocked(f.key)" class="param-field-lock">🔒 {{ lockReasonOf(f.key) }}</text>
                    <text v-else-if="paramRangeHint(f)" class="param-field-hint">{{ paramRangeHint(f) }}</text>
                  </view>
                  <switch
                    v-if="f.type === 'bool'"
                    :checked="!!paramValueOf(f)"
                    :disabled="isFieldLocked(f.key)"
                    color="#007AFF"
                    @change="setSchemaParam(f.key, $event.detail.value)"
                  />
                  <view v-else-if="f.type === 'enum'" class="param-field-enum">
                    <scroll-view scroll-x class="param-enum-scroll" :show-scrollbar="false">
                      <view class="param-enum-row">
                        <view
                          v-for="opt in paramOptionsOf(f)"
                          :key="String(opt)"
                          class="param-enum-chip"
                          :class="{ active: sameValue(paramValueOf(f), opt), disabled: isFieldLocked(f.key) }"
                          @click="setSchemaParam(f.key, opt)"
                        >
                          <text class="param-enum-t">{{ optionText(f, opt) }}</text>
                        </view>
                      </view>
                    </scroll-view>
                  </view>
                  <view v-else-if="['number', 'range', 'duration'].includes(f.type)" class="param-field-num">
                    <view class="param-step-btn small" @click="stepParam(f, -1)"><text class="param-step-t">－</text></view>
                    <input
                      class="param-num-input"
                      type="number"
                      :value="String(paramValueOf(f))"
                      :disabled="isFieldLocked(f.key)"
                      @blur="setSchemaParam(f.key, $event.detail.value)"
                    />
                    <text class="param-num-unit">{{ paramUnit(f) }}</text>
                    <view class="param-step-btn small" @click="stepParam(f, 1)"><text class="param-step-t">＋</text></view>
                  </view>
                  <input
                    v-else
                    class="param-text-input"
                    :value="paramValueOf(f) || ''"
                    :disabled="isFieldLocked(f.key)"
                    placeholder="按模型契约填写"
                    placeholder-class="input-ph"
                    @blur="setSchemaParam(f.key, $event.detail.value)"
                  />
                </view>
              </view>

              <!-- 隐藏到更深处的“预览请求”入口 (极客调试) -->
              <view class="sheet-preview-wrap">
                <view class="sheet-preview-btn" @click="openRequestPreview" hover-class="sheet-preview-hover">
                  <AppIcon name="eye" :size="14" color="#64748B" />
                  <text class="sheet-preview-t">调试 · 查看并核验 API 请求报文</text>
                </view>
              </view>
            </view>
            <view v-else class="more-note"><text class="more-t">当前模型没有可调参数</text></view>
            <view style="height: 20px" />
          </template>
        </scroll-view>
      </view>
    </view>

    <!-- 素材选择器（从云端素材库/本地相册选取） -->
    <view v-if="pickerVisible" class="sheet-mask" @click="pickerVisible = false">
      <view class="sheet picker" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">选参考图</text>
          <view class="sheet-close" @click="pickerVisible = false">
            <AppIcon name="close" :size="16" color="#64748B" />
          </view>
        </view>
        <view class="picker-search">
          <input class="picker-input" v-model="pickerKeyword" placeholder-class="input-ph" placeholder="搜索素材（文件名 / 标签）" confirm-type="search" @confirm="reloadPicker" />
          <view class="picker-btn" @click="reloadPicker"><text class="picker-btn-t">搜索</text></view>
        </view>
        <scroll-view scroll-y class="picker-grid" :enhanced="true">
          <view class="picker-grid-inner">
            <view v-for="item in pickerItems" :key="item.fid" class="picker-card" @click="mountLibraryRef(item)" hover-class="picker-card-hover">
              <image :src="grid(item.fid)" class="picker-img" mode="aspectFill" lazy-load />
              <text class="picker-name" number-of-lines="1">{{ item.fileName || item.fid }}</text>
            </view>
            <view v-if="pickerLoading" class="picker-status"><text class="picker-status-t">加载中…</text></view>
            <view v-else-if="!pickerItems.length" class="picker-status"><text class="picker-status-t">没有找到素材</text></view>
            <view v-else-if="pickerHasMore" class="picker-more" @click="loadMorePicker"><text class="picker-more-t">加载更多</text></view>
          </view>
        </scroll-view>
        <view class="picker-foot">
          <view class="picker-action" @click="chooseLocalImage"><text class="picker-action-t">从手机相册上传</text></view>
          <view class="picker-action ghost" @click="pickerVisible = false"><text class="picker-action-t">完成</text></view>
        </view>
      </view>
    </view>

    <!-- 家具单品选择（3D 朝向参考） -->
    <view v-if="productPickerVisible" class="sheet-mask" @click="productPickerVisible = false">
      <view class="sheet picker" @click.stop>
        <view class="sheet-head">
          <text class="sheet-title">选择带 3D 的家具单品</text>
          <view class="sheet-close" @click="productPickerVisible = false">
            <AppIcon name="close" :size="16" color="#64748B" />
          </view>
        </view>
        <scroll-view scroll-y class="product-list" :enhanced="true">
          <view
            v-for="p in products3d"
            :key="p.id"
            class="product-row"
            :class="{ active: selectedProduct && selectedProduct.id === p.id }"
            @click="selectProduct(p)"
            hover-class="product-row-hover"
          >
            <image :src="productPreview(p)" class="product-img" mode="aspectFill" />
            <view class="product-meta">
              <text class="product-name" number-of-lines="1">{{ p.name }}</text>
              <text v-if="p.tags && p.tags.length" class="product-tags" number-of-lines="1">{{ p.tags.join(' · ') }}</text>
              <text class="product-3d">含 GLB · 可调朝向</text>
            </view>
            <AppIcon v-if="selectedProduct && selectedProduct.id === p.id" name="check" :size="16" color="#007AFF" />
          </view>
          <view v-if="products3dLoading" class="picker-status"><text class="picker-status-t">加载单品中…</text></view>
          <view v-else-if="!products3d.length" class="picker-status"><text class="picker-status-t">没有可用的 3D 单品</text></view>
        </scroll-view>
        <view class="picker-foot">
          <view class="picker-action ghost" @click="productPickerVisible = false"><text class="picker-action-t">取消</text></view>
        </view>
      </view>
    </view>

    <!-- 历史会话抽屉 (与 Web 端 100% 互通) -->
    <SessionDrawer
      :show="drawerOpen"
      :sessions="sessions"
      :current-id="currentSessionId"
      :loading="sessionsLoading"
      :default-filter="domain"
      @close="drawerOpen = false"
      @select="onSelectSession"
      @new="newSession"
      @delete="onDeleteSession"
    />

    <!-- 右上角创作库抽屉 (复用过去作品与创作配方) -->
    <CreationLibraryDrawer
      :show="libraryOpen"
      :history-items="historyCreations"
      @close="libraryOpen = false"
      @reuse-prompt="onReusePrompt"
      @use-as-ref="onUseAsRefFromLibrary"
      @preview="onPreviewLibraryItem"
    />

    <!-- 请求预览抽屉 -->
    <RequestPreviewSheet
      :show="previewVisible"
      :kind="previewKind"
      :payload="previewPayload"
      :extra-notes="previewExtraNotes"
      @close="previewVisible = false"
      @confirm="confirmAndSend"
    />

    <!-- 参考图全屏 -->
    <RefLightbox
      :show="refLightbox.show"
      :url="refLightbox.url"
      :kind="refLightbox.kind"
      :label="refLightbox.label"
      @close="refLightbox.show = false"
      @download="saveLightboxToAlbum"
    />

    <!-- AI 任务浮窗 -->
    <AiTaskPill />
  </view>
</template>

<script>
import RefLightbox from '../../components/RefLightbox.vue'
import RequestPreviewSheet from '../../components/RequestPreviewSheet.vue'
import SessionDrawer from '../../components/SessionDrawer.vue'
import AiTaskPill from '../../components/AiTaskPill.vue'
import CreationLibraryDrawer from '../../components/CreationLibraryDrawer.vue'
import AppIcon from '../../components/AppIcon.vue'
import {
  fetchLabCapabilities,
  fetchAssets,
  fetchChatSessions,
  createChatSession,
  deleteChatSession,
  fetchChatMessages,
  saveChatMessage,
  clearChatMessages,
  uploadRefImages,
  optimizePrompt,
  aiEdit,
  fetchProductPresets,
  mediaUrl,
  gridUrl,
  downloadAndSaveToAlbum,
  saveBase64ImageToAlbum,
  postGenRoute,
} from '../../service/ViewerApi'
import { store } from '../../service/SyncStateStore'
import { aiTaskManager } from '../../service/AiTaskManager'
import { consumeTabParams } from '../../common/nav'
import { schemaFor, optionLabel, slotLimit } from '../../service/ModelSchemas'
import {
  evaluateClientModelRules,
  schemaDefaults,
  fieldByKey,
  clampParamsToSchema,
  resolveSchemaMode,
} from '../../service/ModelProtocol'
import MODEL_CATALOG, { mergeStudioCatalog } from '../../service/ModelCatalog'

const RATIO_FALLBACK = ['1:1', '3:4', '4:3', '9:16', '16:9']

function absMediaUrl(file, result) {
  const rel = (file && file.previewUrl) || (result && result.previewUrl) || ''
  if (!rel) return (result && result.url) || ''
  if (/^https?:\/\//i.test(rel)) return rel
  return store.getServerUrl() + rel
}

function isImageKindOf(kind) {
  const k = String(kind || '')
  return k === 'image' || k === 'portrait'
}

let seedId = 0
const newId = (prefix) => `${prefix}_${Date.now()}_${++seedId}`

export default {
  name: 'Home',
  components: { RefLightbox, RequestPreviewSheet, SessionDrawer, CreationLibraryDrawer, AiTaskPill, AppIcon },
  data() {
    return {
      statusBarHeight: 20,
      sessions: [],
      sessionsLoading: false,
      currentSessionId: '',
      chatList: [],
      scrollIntoId: '',
      drawerOpen: false,
      libraryOpen: false,
      bigImageMode: true,
      domain: 'image',
      imageSub: 'standard',
      musicMode: 'text_to_bgm',
      capabilities: null,
      studioCatalog: null,
      currentChatModelId: '',
      currentImageModelId: '',
      currentVideoModelId: '',
      currentMusicModelId: '',
      currentPortraitModelId: '',
      capabilitiesLoaded: false,
      // 动态参数：唯一真相源是当前模型 schema，客户端不再写死 ratio/duration
      schemaParams: {},
      activeParamKey: '',
      refsOpen: true,
      historyOpen: true,
      canvasPinnedId: '',
      refs: [],
      refLightbox: { show: false, url: '', kind: 'image', label: '' },
      pickerVisible: false,
      pickerItems: [],
      pickerLoading: false,
      pickerKeyword: '',
      pickerPage: 1,
      pickerHasMore: true,
      pickerPageSize: 24,
      inputPrompt: '',
      isEditingPrompt: false,
      optimizingPrompt: false,
      promptBeforeOptimize: '',
      lastSentPrompt: '',
      showAtPicker: false,
      sending: false,
      pendingEdit: null,
      // 3D 朝向截图（替换 / 新增）：没有截图前禁止发送
      products3d: [],
      products3dLoading: false,
      productPickerVisible: false,
      selectedProduct: null,
      modelYaw: 0,
      modelPitch: 0,
      modelSnapshotUrl: '',
      modelSnapshotError: '',
      previewVisible: false,
      previewKind: 'gen',
      previewPayload: {},
      previewExtraNotes: [],
      sheetMode: '',
      chatHistorySynced: false,
    }
  },
  computed: {
    visibleDomains() {
      return [
        { id: 'chat', label: '对话' },
        { id: 'image', label: '图片' },
        { id: 'video', label: '视频' },
        { id: 'music', label: '音乐' },
      ]
    },
    hasMusicDomain() {
      return true
    },
    domainModels() {
      const cat = this.studioCatalog || {}
      if (this.domain === 'image') {
        return this.imageSub === 'portrait' ? (cat.portrait?.models || []) : (cat.image?.models || [])
      }
      if (this.domain === 'video') return cat.video?.models || []
      if (this.domain === 'music') return cat.music?.models || []
      return cat.chat?.models || []
    },
    currentModelId() {
      if (this.domain === 'image') return this.imageSub === 'portrait' ? this.currentPortraitModelId : this.currentImageModelId
      if (this.domain === 'video') return this.currentVideoModelId
      if (this.domain === 'music') return this.currentMusicModelId
      return this.currentChatModelId
    },
    currentModelInfo() {
      const list = this.domainModels
      const hit = list.find((m) => m.id === this.currentModelId)
      return hit || list[0] || { id: this.currentModelId || '', name: '默认', providerName: '' }
    },
    currentSchema() {
      return schemaFor(this.currentModelInfo)
    },
    currentMode() {
      if (this.domain === 'image') return this.imageSub === 'portrait' ? (this.refs.length ? 'image_to_portrait' : 'text_to_portrait') : (this.refs.length ? 'image_to_image' : 'text_to_image')
      if (this.domain === 'video') return this.refs.length ? 'image_to_video' : 'text_to_video'
      if (this.domain === 'music') return this.musicMode
      return 'chat'
    },
    refCounts() {
      const out = { images: 0, videos: 0, audios: 0 }
      for (const r of this.refs || []) {
        const kind = (r && r.kind) || 'image'
        if (kind === 'image') out.images += 1
        else if (kind === 'video') out.videos += 1
        else if (kind === 'audio') out.audios += 1
      }
      return out
    },
    effectiveParams() {
      const schema = this.currentSchema
      if (!schema) return { ...(this.schemaParams || {}) }
      return clampParamsToSchema(schema, { ...schemaDefaults(schema), ...(this.schemaParams || {}) })
    },
    ruleEval() {
      return evaluateClientModelRules(this.currentSchema, this.activeMode, this.effectiveParams, this.refCounts)
    },
    ruleWarnings() {
      return Array.isArray(this.ruleEval.warnings) ? this.ruleEval.warnings : []
    },
    lockedKeysSet() {
      return new Set(this.ruleEval.lockedKeys || [])
    },
    activeMode() {
      return resolveSchemaMode(this.currentSchema, this.currentMode, this.refCounts)
    },
    activeModeLabel() {
      const modes = (this.currentSchema && this.currentSchema.modes) || []
      const hit = modes.find((m) => m.id === this.activeMode)
      if (hit && hit.label) return hit.label
      const map = {
        chat: '对话', text_to_image: '文生图', image_to_image: '图生图',
        image_reference: '图片参考', image_edit: '图片编辑', text_to_video: '文生视频',
        image_to_video: '图生视频', omni_reference: '全能参考', first_last_frame: '首尾帧',
        video_edit: '视频编辑', video_extend: '视频延长', text_to_bgm: '文生音乐', text_to_song: '文生歌',
      }
      return map[this.activeMode] || this.currentModeBadge
    },
    modeSummary() {
      return (this.currentModeBadge || '创作') + ' · ' + ((this.currentModelInfo && this.currentModelInfo.name) || '默认模型')
    },
    currentModeBadge() {
      if (this.domain === 'image') return this.imageSub === 'portrait' ? '人像' : '图片'
      if (this.domain === 'video') return '视频'
      if (this.domain === 'music') return '音频'
      return '对话'
    },
    primaryParams() {
      const schema = this.currentSchema
      if (!schema) return []
      const suppressed = new Set(this.ruleEval.suppressedKeys || [])
      const all = [...(schema.common || [])].filter((f) => {
        if (!f || !f.key) return false
        if (suppressed.has(f.key)) return false
        if (f.key === 'mode') return false
        if (f.location === 'none') return false
        if (f.visibility && f.visibility !== 'public') return false
        return true
      })
      // 常用参数排布：生图优先放画幅比(ratio/aspect_ratio)与分辨率/清晰度(resolution/size/dimension)
      // 视频优先放画幅比与时长(duration)
      const ratioField = all.find((f) => ['aspect_ratio', 'ratio', 'ar'].includes(f.key))
      const secondaryField = all.find((f) => ['resolution', 'size', 'dimension', 'duration', 'quality', 'scale'].includes(f.key) && f !== ratioField)
      const res = []
      if (ratioField) res.push(ratioField)
      if (secondaryField) res.push(secondaryField)
      if (res.length) return res
      return all.slice(0, 2)
    },
    advancedCustomCount() {
      // 统计高级参数里有非默认值的个数
      const adv = this.schemaParamSections.find((s) => s.key === 'advanced')
      if (!adv || !adv.fields) return 0
      let count = 0
      for (const f of adv.fields) {
        const val = this.schemaParams[f.key]
        if (val !== undefined && val !== null && val !== '' && val !== f.default) {
          count++
        }
      }
      return count
    },
    historyCreations() {
      const out = []
      const seen = new Set()
      const msgs = this.chatList || []
      for (const m of msgs) {
        if (m && m.role === 'assistant' && m.result && m.result.url) {
          const u = m.result.url
          if (!seen.has(u)) {
            seen.add(u)
            out.push({
              id: m.id || String(m.createdAt),
              url: u,
              kind: m.result.kind || (this.domain === 'video' ? 'video' : 'image'),
              kindLabel: m.result.label || (m.result.kind === 'video' ? '视频' : '图片'),
              prompt: m.prompt || (m.outbound && m.outbound.prompt) || '',
              createdAt: m.createdAt || Date.now()
            })
          }
        }
      }
      try {
        const saved = uni.getStorageSync('chat_library_creations') || []
        if (Array.isArray(saved)) {
          for (const s of saved) {
            if (s && s.url && !seen.has(s.url)) {
              seen.add(s.url)
              out.push(s)
            }
          }
        }
      } catch (e) {}
      return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    },
    composerParams() {
      const schema = this.currentSchema
      if (!schema) return []
      const suppressed = new Set(this.ruleEval.suppressedKeys || [])
      const list = (schema.common || []).filter((f) => {
        if (!f || !f.key) return false
        if (suppressed.has(f.key)) return false
        if (f.key === 'mode') return false
        if (f.location === 'none') return false
        if (f.visibility && f.visibility !== 'public') return false
        return true
      })
      return list.slice(0, 4)
    },
    schemaParamSections() {
      const schema = this.currentSchema
      if (!schema) return []
      const suppressed = new Set(this.ruleEval.suppressedKeys || [])
      const pick = (list) => (list || []).filter((f) => {
        if (!f || !f.key) return false
        if (suppressed.has(f.key)) return false
        if (f.key === 'mode') return false
        if (f.location === 'none') return false
        return true
      })
      const sections = []
      const common = pick(schema.common)
      const advanced = pick(schema.advanced)
      if (common.length) sections.push({ key: 'common', title: '基础参数', fields: common })
      if (advanced.length) sections.push({ key: 'advanced', title: '高级参数', fields: advanced })
      return sections
    },
    advancedCount() {
      const advanced = this.schemaParamSections.find((s) => s.key === 'advanced')
      return advanced ? advanced.fields.length : 0
    },
    paramSheetField() {
      return fieldByKey(this.currentSchema, this.activeParamKey)
    },
    refCap() {
      const schema = this.currentSchema
      if (!schema || !schema.slots) return null
      const audios = Number(schema.slots.audios || 0)
      const images = Number(schema.slots.images || 0)
      if (audios > 0 && images === 0) return audios
      return slotLimit(schema, 'images', this.activeMode)
    },
    refCapText() {
      return this.refCap != null ? ' / ' + this.refCap : ''
    },
    canAddRef() {
      if (this.refCap == null) return true
      return this.refs.length < this.refCap
    },
    refError() {
      const schema = this.currentSchema
      if (!schema || !schema.slots) return ''
      const audios = Number(schema.slots.audios || 0)
      const images = Number(schema.slots.images || 0)
      if (audios > 0 && images === 0) {
        if (this.refCounts.audios < 1) return '这个模型需要至少一段参考音频'
        if (this.refCounts.audios > audios) return '参考音频最多 ' + audios + ' 段'
        return ''
      }
      const cap = this.refCap
      const count = this.refs.length
      if (cap != null && count > cap) return '当前模型最多 ' + cap + ' 张参考图'
      const mode = this.activeMode
      if (mode === 'first_last_frame' && count !== 2) return '首尾帧需要两张图：第一张首帧，第二张尾帧'
      if (mode === 'expand_fill' && count !== 1) return '扩边填白需要一张底图'
      if (mode === 'image_edit' && count < 1) return '局部编辑需要至少一张底图'
      if (['image_to_image', 'image_reference', 'image_to_video', 'omni_reference'].includes(mode) && count < 1) {
        return '这个模式需要至少一张参考图'
      }
      return ''
    },
    canvasMessage() {
      const list = (this.chatList || []).filter((m) => m && m.role === 'assistant')
      if (this.canvasPinnedId) {
        const hit = list.find((m) => m.id === this.canvasPinnedId)
        if (hit) return hit
      }
      return list.length ? list[list.length - 1] : null
    },
    canvasMsg() {
      return this.canvasMessage
    },
    canvasRunning() {
      const msg = this.canvasMessage
      return msg && msg.status === 'running' ? msg : null
    },
    canvasFailed() {
      const msg = this.canvasMessage
      return msg && msg.status === 'failed' ? msg : null
    },
    canvasResult() {
      const msg = this.canvasMessage
      return msg && msg.status !== 'running' && msg.result ? msg.result : null
    },
    canvasVisualResult() {
      const msg = this.canvasMessage
      // 必须有媒体文件 URL (图片、视频、音频) 才是视觉产物！纯文本问答不属于视觉产物，不遮挡视觉工作台
      if (msg && msg.status !== 'running' && msg.result && msg.result.url) {
        return msg.result
      }
      return null
    },
    canvasItems() {
      return (this.chatList || []).filter((m) => m && m.role === 'assistant' && m.result && (m.result.url || m.result.text))
    },
    canvasStateText() {
      if (this.canvasRunning) return '生成中'
      if (this.canvasFailed) return '失败'
      if (this.canvasResult) return '已完成'
      if (this.refs.length) return '参考图'
      return '待创作'
    },
    canvasStateClass() {
      if (this.canvasRunning) return 'is-running'
      if (this.canvasFailed) return 'is-failed'
      if (this.canvasResult) return 'is-done'
      if (this.refs.length) return 'is-ref'
      return 'is-idle'
    },
    sessionTitle() {
      const cur = this.sessions.find((s) => s.sessionId === this.currentSessionId)
      return (cur && cur.title) || '新对话'
    },
    emptySub() {
      if (this.pendingEdit) return '精准编辑已就位：写一句编辑要求，或点「预览请求」看清将发送的内容'
      return '支持对话、图片、视频' + (this.hasMusicDomain ? '、音频' : '') + '生成；从素材详情 / 精准编辑带入内容，均可作为参考'
    },
    currentPresets() {
      if (this.domain === 'image') {
        return this.imageSub === 'portrait'
          ? ['自然光下的空间人像，坐姿，看向窗外', '商务精英站在落地窗前，侧光轮廓']
          : ['现代轻奢极简客厅，全景落地窗，柔和自然采光', '法式奶油风主卧，弧形吊顶与隐形灯带', '日式侘寂茶室，微水泥墙面，庭院竹影']
      }
      if (this.domain === 'video') {
        return ['镜头缓慢向前推进，光影自然位移，晨间微尘丁达尔效应', '一镜到底运镜，从玄关缓缓推到客厅中央']
      }
      if (this.domain === 'music') {
        return ['安静的室内空间背景配乐，钢琴与轻微弦乐', '轻快明亮的产品展示配乐']
      }
      return ['帮我看看适合做封面的素材该怎么选', '给这套空间写一段短视频分镜', '帮我分析这张照片的构图与光影']
    },
    needs3dModel() {
      const p = this.pendingEdit
      if (!p || p.kind === 'global') return false
      return p.op === 'replace' || p.op === 'add'
    },
    selectedProductPreview() {
      const p = this.selectedProduct
      if (!p) return ''
      const u = p.preview_url || ''
      if (!u) return ''
      if (/^https?:\/\//i.test(u)) return u
      return store.getServerUrl() + (u.startsWith('/') ? u : '/' + u)
    },
    canSend() {
      if (this.sending || !this.inputPrompt.trim()) return false
      if (this.needs3dModel && !this.modelSnapshotUrl) return false
      if (this.refError) return false
      return true
    },
    sheetTitle() {
      if (this.sheetMode === 'model') return '选择模型'
      if (this.sheetMode === 'param') {
        const f = this.paramSheetField
        return (f && (f.label || f.key)) || '参数'
      }
      if (this.sheetMode === 'more') return '全部参数'
      return ''
    },
    pendingEditLabel() {
      const op = (this.pendingEdit && this.pendingEdit.op) || ''
      const map = {
        replace: '替换', add: '增加', insert: '安装', install: '安装',
        space: '留白', remove: '去除', expand: '扩图',
        style_transfer: '风格转换', clarity: '画质超清', watermark: '去水印',
      }
      return map[op] || op || '编辑'
    },
    pendingEditDetail() {
      const p = this.pendingEdit || {}
      if (p.productName) return `对象：${p.productName}`
      if (p.recipeHint) return p.recipeHint
      if (p.sourceName) return `来源：${p.sourceName}`
      return '以原图为底，框选区域将被修改'
    },
    placeholderText() {
      if (this.pendingEdit) return '写一句编辑要求，例如：把图1替换为图2的沙发'
      if (this.domain === 'image') return this.imageSub === 'portrait' ? '描述你想要的人像…' : '描述你想要生成的图片…'
      if (this.domain === 'video') return '描述你想要创作的视频…'
      if (this.domain === 'music') return '描述你想要的配乐氛围…'
      return '发消息，或输入创作想法…'
    },
  },

  onLoad() {
    this.statusBarHeight = (uni.getSystemInfoSync && uni.getSystemInfoSync().statusBarHeight) || 20
  },
  onShow() {
    // 消费编辑页交接的一次性 payload（switchTabTo 中转）
    const payload = consumeTabParams('/pages/home/home')
    if (payload) this.applyPendingPayload(payload)
    // 消费 3D 朝向页回传的截图
    this.applyModel3dResult()
    this.ensureSessionAndHistory()
    this.loadCapabilities(false)
  },
  methods: {
    // ─────────── 初始化 ───────────
    async ensureSessionAndHistory() {
      if (this._booting) return
      this._booting = true
      await this.loadChatSessions()
      this.bindSession(false)
      await this.loadChatHistory()
      this._booting = false
    },
    async loadCapabilities(showTip) {
      try {
        const data = await fetchLabCapabilities()
        this.capabilities = data
        this.studioCatalog = mergeStudioCatalog(data && data.studio, JSON.parse(JSON.stringify(MODEL_CATALOG)))
        this.applyDefaultModels()
        this.resetParamsForModel()
        if (showTip) uni.showToast({ title: '能力已刷新', icon: 'none' })
      } catch (e) {
        this.studioCatalog = mergeStudioCatalog(null, JSON.parse(JSON.stringify(MODEL_CATALOG)))
        this.applyDefaultModels()
        this.resetParamsForModel()
        if (showTip) uni.showToast({ title: '已就绪内置能力矩阵', icon: 'none' })
      }
    },
    applyDefaultModels() {
      const cat = this.studioCatalog || {}
      const pick = (list, setter, currentId, defaultId) => {
        if (!list || !list.length) return
        if (currentId && list.some((m) => m.id === currentId)) return
        const def = (defaultId && list.find((m) => m.id === defaultId)) || list.find((m) => m.default) || list[0]
        setter(def.id)
      }
      pick(cat.image?.models, (id) => (this.currentImageModelId = id), this.currentImageModelId, cat.image?.defaultModel)
      pick(cat.video?.models, (id) => (this.currentVideoModelId = id), this.currentVideoModelId, cat.video?.defaultModel)
      pick(cat.music?.models, (id) => (this.currentMusicModelId = id), this.currentMusicModelId, cat.music?.defaultModel)
      pick(cat.portrait?.models, (id) => (this.currentPortraitModelId = id), this.currentPortraitModelId, cat.portrait?.defaultModel)
      pick(cat.chat?.models, (id) => (this.currentChatModelId = id), this.currentChatModelId, cat.chat?.defaultModel)
    },
    resetParamsForModel() {
      const sch = this.currentSchema
      if (!sch) {
        this.schemaParams = {}
        return
      }
      const mode = resolveSchemaMode(sch, this.currentMode, this.refCounts)
      const evaluated = evaluateClientModelRules(sch, mode, schemaDefaults(sch), this.refCounts)
      this.schemaParams = clampParamsToSchema(sch, evaluated.params)
      this.activeParamKey = ''
      this.sheetMode = this.sheetMode === 'param' ? '' : this.sheetMode
    },

    // ─────────── 编辑交接（精准编辑 → 对话创作） ───────────
    applyPendingPayload(payload) {
      // 浏览页批量：带若干 fid 进入创作作为参考图
      if (payload && Array.isArray(payload.fids) && payload.fids.length) {
        this.pendingEdit = null
        this.domain = payload.domain === 'video' ? 'video' : 'image'
        this.canvasPinnedId = ''
        this.mountLibraryFids(payload.fids)
        this.resetParamsForModel()
        if (payload.recipe) {
          this.inputPrompt = payload.recipe
          this.lastSentPrompt = payload.recipe
        }
        return
      }
      // 精准编辑：op + region + 主图 fid
      this.pendingEdit = payload || null
      if (!payload) return
      this.resetModel3d()
      this.domain = 'image'
      this.imageSub = payload.op === 'replace' || payload.op === 'add' ? 'standard' : this.imageSub
      const refs = []
      if (payload.sourceFid) {
        refs.push({
          id: newId('ref'),
          url: mediaUrl(payload.sourceFid),
          fid: payload.sourceFid,
          label: payload.sourceName || '原图',
          source: 'stage',
          kind: 'image',
        })
      }
      const extraRefs = Array.isArray(payload.refs) ? payload.refs : []
      for (const r of extraRefs) {
        if (!r || !r.url) continue
        refs.push({
          id: newId('ref'),
          url: r.url,
          label: r.name || r.label || '参考图',
          source: r.source || 'ref',
          kind: r.kind || 'image',
        })
      }
      this.refs = refs
      this.canvasPinnedId = ''
      this.resetParamsForModel()
      if (payload.recipe) {
        this.inputPrompt = payload.recipe
        this.lastSentPrompt = payload.recipe
      } else {
        this.inputPrompt = ''
      }
      this.drawerOpen = false
      this.scrollToBottom()
      uni.showToast({ title: '已带入精准编辑内容', icon: 'none' })
    },

    async mountLibraryFids(fids) {
      const refs = fids.slice(0, 8).map((fid) => ({
        id: newId('ref'),
        url: gridUrl(fid),
        fid,
        label: String(fid).slice(0, 12),
        source: 'stage',
        kind: 'image',
      }))
      this.refs = refs
      this.domain = this.domain || 'image'
      this.drawerOpen = false
      uni.showToast({ title: `已挂上 ${refs.length} 张参考图`, icon: 'none' })
    },

    // ─────────── 会话 ───────────
    getSessionModality(s) {
      if (!s) return 'image'
      const m = String(s.last_mode || s.lastMode || s.type || '').toLowerCase()
      if (m === 'chat') return 'chat'
      if (m.includes('video')) return 'video'
      if (m.includes('music') || m.includes('audio') || m.includes('song') || m.includes('bgm')) return 'music'
      if (m.includes('portrait')) return 'image'
      if (m.includes('image')) return 'image'
      const title = String(s.title || '').toLowerCase()
      if (title.includes('视频') || title.includes('运镜') || title.includes('动画')) return 'video'
      if (title.includes('音乐') || title.includes('音频') || title.includes('歌')) return 'music'
      if (title.includes('生图') || title.includes('图') || title.includes('画') || title.includes('扩图') || title.includes('精修') || title.includes('人像')) return 'image'
      return 'chat'
    },
    async loadChatSessions() {
      this.sessionsLoading = true
      let remote = []
      try {
        const data = await fetchChatSessions()
        remote = Array.isArray(data) ? data : (data && data.sessions) || []
      } catch (e) {
        remote = []
      }
      let local = []
      try {
        const raw = uni.getStorageSync('chat_session_list')
        if (Array.isArray(raw)) local = raw
      } catch (e) {}
      this.sessions = this.dedupeSessions([...remote, ...local])
      this.persistSessionsLocal()
      this.sessionsLoading = false
    },
    typeFromMode(mode) {
      return this.getSessionModality({ last_mode: mode })
    },
    dedupeSessions(list) {
      const seen = {}
      const out = []
      ;(list || []).forEach((s) => {
        if (!s) return
        const id = s.id || s.sessionId
        if (!id || seen[id]) return
        seen[id] = true
        out.push({
          sessionId: id,
          id,
          type: this.getSessionModality(s),
          title: s.title || '',
          productCount: s.product_count || s.productCount || 0,
          updatedAt: s.updated_at || s.updatedAt || s.created_at || s.createdAt || Date.now(),
          preview: s.preview || '',
        })
      })
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      return out
    },
    persistSessionsLocal() {
      try {
        uni.setStorageSync('chat_session_list', this.sessions)
      } catch (e) {}
    },
    sessionTypeOfDomain() {
      return this.domain
    },
    defaultTitle(type) {
      const map = { chat: '对话会话', image: '生图会话', video: '视频会话', music: '音乐会话' }
      return map[type] || '创作会话'
    },
    bindSession(forceNew) {
      const type = this.sessionTypeOfDomain()
      const inMemory = this.sessions.find((s) => s.sessionId === this.currentSessionId)
      if (!forceNew && inMemory && inMemory.type === type) return
      if (!forceNew) {
        const existing = this.sessions.find((s) => s.type === type)
        if (existing) {
          this.currentSessionId = existing.sessionId
          return
        }
      }
      // 草稿会话
      this.currentSessionId = `session_${type}_${Date.now()}`
      this.chatList = []
      this._sessionPersisted = false
    },
    persistCurrentSession(title) {
      if (!this.currentSessionId) return
      const type = this.sessionTypeOfDomain()
      const meta = {
        sessionId: this.currentSessionId,
        type,
        title: (title || this.defaultTitle(type)).slice(0, 50),
        updatedAt: Date.now(),
      }
      this.sessions = this.dedupeSessions([meta, ...this.sessions.filter((s) => s.sessionId !== meta.sessionId)])
      this.persistSessionsLocal()
      if (this._sessionPersisted) {
        createChatSession({ id: meta.sessionId, title: meta.title }).catch(() => {})
        return
      }
      this._sessionPersisted = true
      createChatSession({ id: meta.sessionId, title: meta.title }).catch(() => {})
    },
    formatNow() {
      const d = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    },
    async loadChatHistory() {
      if (!this.currentSessionId) return
      try {
        const local = uni.getStorageSync('chat_messages_' + this.currentSessionId)
        if (Array.isArray(local) && local.length) {
          this.chatList = local
          this.scrollToBottom()
        }
      } catch (e) {}
      try {
        const remote = await fetchChatMessages(this.currentSessionId, 80)
        if (Array.isArray(remote) && remote.length) {
          this.chatList = remote
          uni.setStorageSync('chat_messages_' + this.currentSessionId, remote)
          this.scrollToBottom()
        }
      } catch (e) {}
    },
    async onSelectSession(s) {
      if (!s || !s.sessionId) return
      this.currentSessionId = s.sessionId
      const t = s.type || 'chat'
      if (t === 'chat') this.domain = 'chat'
      else if (t === 'image') { this.domain = 'image'; this.imageSub = 'standard' }
      else if (t === 'portrait') { this.domain = 'image'; this.imageSub = 'portrait' }
      else if (t === 'video') this.domain = 'video'
      else if (t === 'music') this.domain = 'music'
      this.drawerOpen = false
      this.pendingEdit = null
      this.canvasPinnedId = ''
      this.resetParamsForModel()
      await this.loadChatHistory()
    },
    async newSession() {
      this.drawerOpen = false
      this.chatList = []
      this.refs = []
      this.pendingEdit = null
      this.canvasPinnedId = ''
      this.bigImageMode = true
      this.resetParamsForModel()
      this.bindSession(true)
    },
    paramDisplayShort(f) {
      const v = this.paramValueOf(f)
      if (v === undefined || v === null || v === '') return f.label || f.key
      const raw = String(this.paramDisplay(f))
      return raw.includes('·') ? raw.split('·')[1].trim() : raw
    },
    paramPrefix(f) {
      if (!f) return ''
      const key = (f.key || '').toLowerCase()
      if (['aspect_ratio', 'ratio', 'ar'].includes(key)) return '画幅'
      if (['resolution', 'size', 'dimension', 'quality', 'scale'].includes(key)) return '画质'
      if (['duration'].includes(key)) return '时长'
      if (['style'].includes(key)) return '风格'
      if (f.label) {
        const l = f.label.replace(/[:：]/g, '').trim()
        return l.length > 3 ? l.slice(0, 3) : l
      }
      return key
    },
    paramFieldIcon(f) {
      if (!f) return 'sliders'
      const key = (f.key || '').toLowerCase()
      if (['aspect_ratio', 'ratio', 'ar'].includes(key)) return 'ratio'
      if (['resolution', 'size', 'dimension', 'quality'].includes(key)) return 'hd'
      if (['duration'].includes(key)) return 'history'
      return 'sliders'
    },
    openRefAddOptions() {
      uni.showActionSheet({
        itemList: ['从素材库选择素材', '从手机相册/拍照上传'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.openPicker()
          } else if (res.tapIndex === 1) {
            this.chooseLocalImage()
          }
        }
      })
    },
    itemKindIconName(msg) {
      const k = (msg.result && msg.result.kind) || 'chat'
      if (k === 'video') return 'video'
      if (k === 'audio') return 'audio'
      if (k === 'portrait') return 'portrait'
      if (k === 'image') return 'image'
      return 'chat'
    },
    onReusePrompt(prompt) {
      if (!prompt) return
      this.inputPrompt = prompt
      this.libraryOpen = false
      uni.showToast({ title: '已填入配方提示词', icon: 'none' })
    },
    onUseAsRefFromLibrary(item) {
      if (!item || !item.url) return
      this.addRef({
        url: item.url,
        label: (item.prompt || '创作产物').slice(0, 10),
        source: 'library',
        kind: item.kind || 'image'
      })
      this.libraryOpen = false
      this.bigImageMode = true
      uni.showToast({ title: '已挂载为参考图', icon: 'none' })
    },
    onPreviewLibraryItem(item) {
      if (!item || !item.url) return
      this.openLightbox(item.url, item.kind || 'image', item.prompt || '创作作品')
    },
    async onDeleteSession(s) {
      if (!s || !s.sessionId) return
      try {
        await deleteChatSession(s.sessionId)
      } catch (e) {}
      this.sessions = this.sessions.filter((x) => x.sessionId !== s.sessionId)
      this.persistSessionsLocal()
      try { uni.removeStorageSync('chat_messages_' + s.sessionId) } catch (e) {}
      if (this.currentSessionId === s.sessionId) {
        this.chatList = []
        this.currentSessionId = ''
        this.bindSession(true)
      }
      uni.showToast({ title: '已删除', icon: 'none' })
    },
    confirmClearChat() {
      if (!this.chatList.length) return
      uni.showModal({
        title: '清空会话',
        content: '清空当前会话的消息记录？',
        confirmColor: '#DC2626',
        success: async (res) => {
          if (!res.confirm) return
          this.chatList = []
          try { uni.removeStorageSync('chat_messages_' + this.currentSessionId) } catch (e) {}
          try { await clearChatMessages(this.currentSessionId) } catch (e) {}
          uni.showToast({ title: '已清空', icon: 'none' })
        },
      })
    },
    scrollToBottom() {
      this.$nextTick(() => {
        if (this.chatList.length) {
          const last = this.chatList[this.chatList.length - 1]
          this.scrollIntoId = 'msg-' + (last.id || this.chatList.length - 1)
        }
      })
    },

    // ─────────── 域 / 子模式 ───────────
    async switchDomain(id) {
      if (this.domain === id) return
      this.domain = id
      this.showAtPicker = false
      this.canvasPinnedId = ''
      this.historyOpen = true
      this.refsOpen = true
      this.bigImageMode = true
      // 默认模态继承：图→图生图；视频→文生视频；切换音频时给一个默认
      if (id === 'image' && !this.currentImageModelId && !this.currentPortraitModelId) this.applyDefaultModels()
      this.resetParamsForModel()
      this.bindSession(false)
      await this.loadChatHistory()
    },
    setImageSub(sub) {
      if (this.imageSub === sub) return
      this.imageSub = sub
      this.canvasPinnedId = ''
      this.resetParamsForModel()
      this.bindSession(false)
      this.loadChatHistory()
    },
    setMusicMode(mode) {
      if (this.musicMode === mode) return
      this.musicMode = mode
      this.canvasPinnedId = ''
      this.resetParamsForModel()
    },

    // ─────────── 参考图管理 ───────────
    addRef(ref) {
      if (!ref || !ref.url) return
      this.refs = [...this.refs, { id: newId('ref'), ...ref }]
    },
    removeRef(i) {
      const list = [...this.refs]
      const removed = list.splice(i, 1)[0]
      this.refs = list
      // 提示词里的 @图N 顺序前移（保留用户文字本意）
      const removedNo = i + 1
      if (this.inputPrompt) {
        let text = this.inputPrompt
        text = text.replace(new RegExp('@图' + removedNo + '(?!\\d)', 'g'), '')
        text = text.replace(/@图(\d+)/g, (m, d) => {
          const n = Number(d)
          return n > removedNo ? `@图${n - 1}` : m
        })
        this.inputPrompt = text
      }
      if (removed) uni.showToast({ title: `已移除 ${removed.label || '参考图'}`, icon: 'none' })
    },
    openRefLightbox(i) {
      const r = this.refs[i]
      if (!r) return
      this.refLightbox = { show: true, url: r.url, kind: r.kind || 'image', label: `图${i + 1} · ${r.label || ''}` }
    },
    async saveLightboxToAlbum() {
      const u = this.refLightbox.url
      if (!u) return
      try {
        await downloadAndSaveToAlbum({ url: u, fileName: 'ML_REF_' + Date.now() + '.jpg', isVideo: this.refLightbox.kind === 'video' })
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      }
    },
    openRefLightboxByUrl(url, label) {
      if (!url) return
      this.refLightbox = { show: true, url, kind: 'image', label: label || '参考图' }
    },

    // ─────────── 3D 朝向截图（替换 / 新增） ───────────
    resetModel3d() {
      this.products3d = []
      this.products3dLoading = false
      this.productPickerVisible = false
      this.selectedProduct = null
      this.modelYaw = 0
      this.modelPitch = 0
      this.modelSnapshotUrl = ''
      this.modelSnapshotError = ''
      try { uni.removeStorageSync('model3d_result') } catch (e) {}
    },
    productPreview(p) {
      if (!p) return ''
      const u = p.preview_url || ''
      if (!u) return ''
      if (/^https?:\/\//i.test(u)) return u
      return store.getServerUrl() + (u.startsWith('/') ? u : '/' + u)
    },
    async openProductPicker() {
      this.productPickerVisible = true
      if (this.products3d.length || this.products3dLoading) return
      this.products3dLoading = true
      try {
        const data = await fetchProductPresets()
        const list = Array.isArray(data) ? data : (data && (data.data || data.items)) || []
        this.products3d = list.filter((p) => p && p.model_url)
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '单品加载失败', icon: 'none' })
      } finally {
        this.products3dLoading = false
      }
    },
    selectProduct(p) {
      if (!p || !p.model_url) {
        uni.showToast({ title: '该单品没有 3D 模型', icon: 'none' })
        return
      }
      if (!this.selectedProduct || this.selectedProduct.id !== p.id) {
        this.modelSnapshotUrl = ''
        this.modelSnapshotError = ''
        this.modelYaw = Number(p.facing) || 0
        this.modelPitch = 0
      }
      this.selectedProduct = p
      this.productPickerVisible = false
    },
    openModel3d() {
      const p = this.selectedProduct
      if (!p || !p.model_url) {
        this.openProductPicker()
        return
      }
      const raw = p.model_url
      const abs = /^https?:\/\//i.test(raw) ? raw : store.getServerUrl() + (raw.startsWith('/') ? raw : '/' + raw)
      const q = [
        'src=' + encodeURIComponent(abs),
        'name=' + encodeURIComponent(p.name || ''),
        'id=' + encodeURIComponent(p.id || ''),
        'yaw=' + encodeURIComponent(String(this.modelYaw || 0)),
        'pitch=' + encodeURIComponent(String(this.modelPitch || 0)),
      ]
      uni.navigateTo({ url: '/pages/model3d/model3d?' + q.join('&') })
    },
    applyModel3dResult() {
      let res = null
      try {
        res = uni.getStorageSync('model3d_result')
        if (res) uni.removeStorageSync('model3d_result')
      } catch (e) {}
      if (!res || !res.dataUrl) return
      const cur = this.selectedProduct
      if (cur && res.productId && cur.id && res.productId !== cur.id) return
      if (!cur && res.productId) {
        const hit = this.products3d.find((p) => p && p.id === res.productId)
        if (hit) this.selectedProduct = hit
      }
      this.modelSnapshotUrl = res.dataUrl
      this.modelYaw = Number(res.yaw) || 0
      this.modelPitch = Number(res.pitch) || 0
      this.modelSnapshotError = ''
      this.ensureOrientationClause()
      const idx = this.refs.findIndex((r) => r.source === '3d_snapshot')
      const ref = {
        id: newId('ref'),
        url: res.dataUrl,
        label: (res.productName || (this.selectedProduct && this.selectedProduct.name) || '家具') + ' · 3D 朝向',
        source: '3d_snapshot',
        kind: 'image',
      }
      if (idx >= 0) {
        const list = [...this.refs]
        list.splice(idx, 1, ref)
        this.refs = list
      } else {
        this.addRef(ref)
      }
      uni.showToast({ title: '3D 朝向已就位', icon: 'none' })
    },
    ensureOrientationClause() {
      if (!this.needs3dModel) return
      if (!this.inputPrompt || !this.inputPrompt.trim()) return
      const yaw = Number(this.modelYaw) || 0
      const pitch = Number(this.modelPitch) || 0
      const clause = `朝向与家具参考图一致，左右${yaw}度，上下${pitch}度。`
      const re = /朝向与家具参考图一致，左右\s*-?\d+度，上下\s*-?\d+度。/
      let text = this.inputPrompt.trim()
      text = re.test(text) ? text.replace(re, clause) : text + ' ' + clause
      this.inputPrompt = text
    },

    openPicker() {
      this.pickerVisible = true
      if (!this.pickerItems.length) this.reloadPicker()
    },
    async reloadPicker() {
      this.pickerPage = 1
      this.pickerHasMore = true
      this.pickerItems = []
      await this.loadPicker(true)
    },
    async loadMorePicker() {
      if (!this.pickerHasMore || this.pickerLoading) return
      this.pickerPage += 1
      await this.loadPicker(false)
    },
    async loadPicker(reset) {
      this.pickerLoading = true
      try {
        const data = await fetchAssets({ page: this.pickerPage, pageSize: this.pickerPageSize, keyword: this.pickerKeyword, tab: 'image' })
        const items = (data && data.items) || []
        this.pickerItems = reset ? items : [...this.pickerItems, ...items]
        this.pickerHasMore = items.length >= this.pickerPageSize
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '素材加载失败', icon: 'none' })
      } finally {
        this.pickerLoading = false
      }
    },
    mountLibraryRef(item) {
      const fid = item && item.fid
      if (!fid) return
      this.addRef({
        url: gridUrl(fid),
        fid,
        label: item.fileName || String(fid).slice(0, 12),
        source: 'stage',
        kind: 'image',
      })
    },
    async chooseLocalImage() {
      try {
        const res = await new Promise((resolve, reject) => {
          uni.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail: reject,
          })
        })
        const path = res && res.tempFilePaths && res.tempFilePaths[0]
        if (!path) return
        uni.showLoading({ title: '上传中…', mask: true })
        try {
          const uploaded = await uploadRefImages([path])
          const u = uploaded && uploaded[0]
          if (u && u.url) {
            this.addRef({ url: u.url, label: '本地上传', source: 'stage', kind: 'image' })
            this.pickerVisible = false
          } else {
            throw new Error('上传未返回地址')
          }
        } finally {
          uni.hideLoading()
        }
      } catch (e) {
        uni.hideLoading()
        const msg = (e && e.errMsg) || (e && e.message) || '选择失败'
        if (!/cancel/i.test(msg)) uni.showToast({ title: msg, icon: 'none' })
      }
    },

    // ─────────── @ 联想 ───────────
    toggleAtPicker() {
      if (!this.refs.length) {
        uni.showToast({ title: '先挂图，再用 @ 引用它', icon: 'none' })
        return
      }
      this.showAtPicker = !this.showAtPicker
    },
    onPromptInput(e) {
      const val = String((e && e.detail && e.detail.value) || this.inputPrompt || '')
      this.inputPrompt = val
      if (/@$|@$/.test(val)) {
        this.showAtPicker = this.refs.length > 0
      } else if (this.showAtPicker && !val.includes('@')) {
        this.showAtPicker = false
      }
    },
    onPromptBlur() {
      setTimeout(() => { this.showAtPicker = false }, 200)
    },
    insertAtRef(i) {
      const tag = `@图${i + 1} `
      const text = this.inputPrompt || ''
      const idx = text.lastIndexOf('@')
      this.inputPrompt = idx >= 0 ? text.slice(0, idx) + tag : text + tag
      this.showAtPicker = false
    },

    // ─────────── 提示词优化 ───────────
    async optimizePromptAction() {
      const raw = this.inputPrompt.trim()
      if (!raw || this.optimizingPrompt) return
      this.optimizingPrompt = true
      this.promptBeforeOptimize = raw
      try {
        const data = await optimizePrompt({ prompt: raw, modelId: this.currentModelInfo.model_code || this.currentModelInfo.id, mode: this.currentMode })
        const out = (data && (data.optimized_prompt || data.optimizedPrompt || data.prompt || data.result)) || ''
        if (out) this.inputPrompt = String(out).trim()
        else uni.showToast({ title: '未返回优化结果', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '优化失败', icon: 'none' })
        this.inputPrompt = raw
      } finally {
        this.optimizingPrompt = false
      }
    },

    // ─────────── 预览 / 发送 ───────────
    /** 当前生效参数：schema 默认值 + 用户改动 + 规则引擎约束，去掉空值。 */
    resolvedParams() {
      const raw = this.ruleEval && this.ruleEval.params ? { ...this.ruleEval.params } : { ...(this.schemaParams || {}) }
      Object.keys(raw).forEach((k) => {
        if (raw[k] === undefined || raw[k] === null || raw[k] === '') delete raw[k]
      })
      return raw
    },
    buildGenBody() {
      const recipe = this.inputPrompt.trim()
      const imageUrls = this.refs.filter((r) => (r.kind || 'image') === 'image').map((r) => r.url).filter(Boolean)
      const videoUrls = this.refs.filter((r) => r.kind === 'video').map((r) => r.url).filter(Boolean)
      const audioUrls = this.refs.filter((r) => r.kind === 'audio').map((r) => r.url).filter(Boolean)
      const params = this.resolvedParams()
      const extras = { ...params, mode: this.activeMode, genMode: this.activeMode }
      const base = {
        prompt: recipe,
        model: this.currentModelInfo.model_code || this.currentModelInfo.id || undefined,
        genMode: this.activeMode,
        mode: this.activeMode,
        params,
        extras,
      }
      // 兼容旧顶层字段：仍以契约参数为准，不再写死任何默认
      if (params.ratio != null) base.ratio = params.ratio
      if (params.size != null) base.size = params.size
      if (params.duration != null) base.duration = Number(params.duration)
      if (params.aspect_ratio != null) base.aspect_ratio = params.aspect_ratio
      if (imageUrls.length) base.imageUrls = imageUrls
      if (videoUrls.length) base.videoUrls = videoUrls
      if (audioUrls.length) base.audioUrls = audioUrls
      const p = this.pendingEdit
      if (p && p.kind === 'global') {
        base.globalOp = p.op
        if (p.style) base.style = p.style
        if (p.scale) base.scale = Number(p.scale)
        if (p.intensity != null) base.strengthLevel = p.intensity
        if (p.globalParams && typeof p.globalParams === 'object') Object.assign(base, p.globalParams)
      }
      return base
    },
    genRoute() {
      if (this.domain === 'chat') return '/gen/chat'
      if (this.domain === 'image') return '/gen/images'
      if (this.domain === 'video') return '/gen/videos'
      return '/gen/audio'
    },
    buildEditBody() {
      const p = this.pendingEdit || {}
      const params = this.resolvedParams()
      const body = {
        op: p.op,
        region: p.region,
        prompt: this.inputPrompt.trim(),
        productName: p.productName,
        model: p.model || (this.currentModelInfo && this.currentModelInfo.model_code) || undefined,
        assetFid: p.sourceFid || undefined,
        params,
        extras: { ...params },
      }
      // 精修链只认这些出图参数；其余 schema 参数随 extras 一起上车，避免客户端另写一份
      if (params.ratio != null) body.ratio = params.ratio
      if (params.size != null) body.size = params.size
      if (params.light_mode != null) body.light_mode = params.light_mode
      if (params.kelvin != null) body.kelvin = Number(params.kelvin)
      if (params.target_style != null) body.targetStyle = params.target_style
      if (params.clarity != null) body.targetClarity = params.clarity
      if (params.remove_watermark != null) body.removeWatermark = !!params.remove_watermark
      if (p.op === 'insert' && p.productImageUrl) body.productImage = p.productImageUrl
      if (p.op === 'replace' || p.op === 'add') {
        const refImage = this.modelSnapshotUrl || p.refImageUrl
        if (refImage) body.refImage = refImage
        if (this.selectedProduct) body.productName = this.selectedProduct.name
      }
      if (p.op === 'expand') {
        if (p.expandRatios) body.expandRatios = p.expandRatios
        if (p.expandRatio) body.expandRatio = p.expandRatio
      }
      if (this.needs3dModel && this.selectedProduct) {
        const raw = this.selectedProduct.model_url || ''
        const abs = /^https?:\/\//i.test(raw) ? raw : store.getServerUrl() + (raw.startsWith('/') ? raw : '/' + raw)
        body.glb = { yaw: this.modelYaw, pitch: this.modelPitch, modelUrl: abs }
      } else if (typeof p.yaw === 'number') {
        body.glb = { yaw: p.yaw, pitch: p.pitch || 0 }
      }
      if (p.gapPct != null) body.gapPct = p.gapPct
      if (p.intensity != null) body.strengthLevel = p.intensity
      if (p.style) body.style = p.style
      if (p.targetClarity) body.targetClarity = p.targetClarity
      return body
    },
    openRequestPreview() {
      if (!this.inputPrompt.trim()) {
        uni.showToast({ title: '请先写一句话', icon: 'none' })
        return
      }
      if (this.refError) {
        uni.showToast({ title: this.refError, icon: 'none' })
        return
      }
      if (this.needs3dModel && !this.modelSnapshotUrl) {
        uni.showToast({ title: '请先选择家具单品并完成 3D 朝向截图', icon: 'none' })
        return
      }
      this.ensureOrientationClause()
      if (this.pendingEdit && this.pendingEdit.kind !== 'global') {
        this.previewKind = 'edit'
        this.previewPayload = this.buildEditBody()
        this.previewExtraNotes = this.refs.map((r, i) => `图${i + 1} · ${r.label}（来源：${this.refSourceLabel(r.source)}）`)
      } else {
        this.previewKind = this.domain === 'chat' ? 'chat' : 'gen'
        this.previewPayload = this.buildGenBody()
        if (this.domain === 'chat') this.previewPayload.modality = 'chat'
        else if (this.domain === 'music') this.previewPayload.modality = 'audio'
        else this.previewPayload.modality = this.domain
        this.previewExtraNotes = this.refs.map((r, i) => `图${i + 1} · ${r.label}（来源：${this.refSourceLabel(r.source)}）`)
      }
      this.previewVisible = true
    },
    refSourceLabel(source) {
      if (source === 'stage') return '参考图收纳条'
      if (source === '3d_snapshot') return '3D 朝向截图'
      if (source === 'product') return '产品参考图'
      return '参考图'
    },
    async confirmAndSend() {
      this.previewVisible = false
      await this.sendMessage({ force: true })
    },
    async sendMessage(opts) {
      if (this.sending) return
      const recipe = this.inputPrompt.trim()
      if (!recipe) {
        uni.showToast({ title: '请先描述你的创作想法', icon: 'none' })
        return
      }
      if (this.needs3dModel && !this.modelSnapshotUrl) {
        uni.showToast({ title: '请先选择家具单品并完成 3D 朝向截图', icon: 'none' })
        return
      }
      this.ensureOrientationClause()
      const isPreciseEdit = !!(this.pendingEdit && this.pendingEdit.kind !== 'global')
      this.sending = true
      try {
        if (isPreciseEdit) {
          await this.sendEditRun(recipe)
        } else {
          await this.sendGen(recipe)
        }
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '发送失败', icon: 'none' })
      } finally {
        this.sending = false
      }
    },
    buildUserMsg(recipe) {
      const modelInfo = this.currentModelInfo
      return {
        id: newId('user'),
        role: 'user',
        prompt: recipe,
        mode: this.currentMode,
        modelName: modelInfo.name || '',
        images: this.refs.map((r) => ({ url: r.url, label: r.label, source: r.source, kind: r.kind })),
        createdAt: Date.now(),
      }
    },
    buildAiMsg(recipe) {
      const precise = !!(this.pendingEdit && this.pendingEdit.kind !== 'global')
      return {
        id: newId('ai'),
        role: 'assistant',
        status: 'running',
        progress: 12,
        engineTitle: precise ? '精准编辑生成中…' : `${(this.currentModelInfo && this.currentModelInfo.name) || '模型'} 生成中…`,
        prompt: '',
        modelName: this.currentModelInfo.name || '',
        createdAt: Date.now(),
      }
    },
    persistMessage(msg) {
      const slim = { ...msg }
      delete slim.__b64
      saveChatMessage(slim).catch(() => {})
      try {
        const cached = uni.getStorageSync('chat_messages_' + this.currentSessionId) || []
        const arr = Array.isArray(cached) ? cached : []
        uni.setStorageSync('chat_messages_' + this.currentSessionId, [...arr, slim].slice(-80))
      } catch (e) {}
    },

    taskTitle(kind) {
      if (kind === 'edit') return '精准编辑生成'
      if (kind === 'global') return '全局编辑生成'
      if (this.domain === 'video') return '视频生成'
      if (this.domain === 'music') return '音频生成'
      if (this.domain === 'image') return this.imageSub === 'portrait' ? '人像生成' : '图片生成'
      return '对话生成'
    },
    trackGeneration(kind) {
      try {
        return aiTaskManager.trackTask({
          title: this.taskTitle(kind),
          type: kind || this.domain,
          sessionId: this.currentSessionId,
        })
      } catch (e) {
        return null
      }
    },
    async sendGen(recipe) {
      const body = this.buildGenBody()
      const task = this.trackGeneration('gen')
      this.persistCurrentSession(recipe.slice(0, 24))
      const userMsg = { ...this.buildUserMsg(recipe), outbound: body }
      const aiMsg = this.buildAiMsg(recipe)
      this.chatList.push(userMsg)
      this.chatList.push(aiMsg)
      this.inputPrompt = ''
      this.lastSentPrompt = recipe
      this.scrollToBottom()
      this.persistMessage(userMsg)

      const route = this.genRoute()
      // 音频：按 musicMode 传递
      if (this.domain === 'music') body.mode = this.musicMode
      const t0 = Date.now()
      try {
        const payload = await postGenRoute(route, body, this.domain === 'video' ? 600000 : 180000)
        const kind = this.domain === 'music' ? 'audio' : this.domain === 'video' ? 'video' : (this.domain === 'image' ? (this.imageSub === 'portrait' ? 'portrait' : 'image') : 'text')
        const out = this.unwrapGenResult(payload, kind)
        aiMsg.status = 'done'
        aiMsg.progress = 100
        aiMsg.result = out
        aiMsg.outbound = body
        if (out.fid) aiMsg.derivativeFid = null
        this.lastSentPrompt = recipe
        if (task) aiTaskManager.finishTask(task.taskId, { outputFid: out.fid || null, outputKind: kind })
        if (out && out.url) {
          try {
            const saved = uni.getStorageSync('chat_library_creations') || []
            const item = {
              id: aiMsg.id,
              url: out.url,
              kind: kind,
              kindLabel: out.label || (kind === 'video' ? '视频' : '图片'),
              prompt: recipe,
              createdAt: Date.now()
            }
            uni.setStorageSync('chat_library_creations', [item, ...(Array.isArray(saved) ? saved : [])].slice(0, 60))
          } catch (e) {}
        }
      } catch (e) {
        aiMsg.status = 'failed'
        aiMsg.error = (e && e.message) || '生成失败'
        if (task) aiTaskManager.failTask(task.taskId, aiMsg.error)
      }
      this.chatList = [...this.chatList]
      this.persistMessage(aiMsg)
      this.scrollToBottom()
    },
    unwrapGenResult(payload, kind) {
      const p = payload || {}
      if (kind === 'text') {
        const data = (p && p.data) || p
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.text || data.content || data.reply || ''
        return { kind: 'text', text: String(text || '（空回复）').trim() }
      }
      const files = Array.isArray(p.files) ? p.files : (Array.isArray(p.data && p.data.files) ? p.data.files : [])
      const file = files[0]
      const url = file ? (file.previewUrl ? absMediaUrl(file, null) : (file.url || file.path || '')) : ''
      return {
        kind,
        url,
        width: file && file.width,
        height: file && file.height,
        mime: file && file.mime,
        label: kind === 'video' ? '生成视频' : kind === 'audio' ? '生成音频' : kind === 'portrait' ? '生成人像' : '生成图片',
      }
    },

    async sendEditRun(recipe) {
      const body = this.buildEditBody()
      const task = this.trackGeneration(this.pendingEdit && this.pendingEdit.kind === 'global' ? 'global' : 'edit')
      this.persistCurrentSession(recipe.slice(0, 24))
      const userMsg = { ...this.buildUserMsg(recipe), outbound: { kind: 'edit', ...body } }
      const aiMsg = this.buildAiMsg(recipe)
      this.chatList.push(userMsg)
      this.chatList.push(aiMsg)
      this.inputPrompt = ''
      this.lastSentPrompt = recipe
      this.scrollToBottom()
      this.persistMessage(userMsg)
      try {
        const res = await aiEdit(body)
        const b64 = res && res.image && res.image.b64
        const dataUrl = b64 ? `data:image/jpeg;base64,${b64}` : (res && res.url) || ''
        aiMsg.status = 'done'
        aiMsg.progress = 100
        aiMsg.result = {
          kind: 'image',
          url: dataUrl,
          label: '编辑结果',
          width: res && res.outSize && res.outSize.outW,
          height: res && res.outSize && res.outSize.outH,
        }
        aiMsg.outbound = { kind: 'edit', ...body }
        aiMsg.derivativeFid = (res && res.derivativeId) || null
        if (res && res.regionNote) aiMsg.regionNote = res.regionNote
        this.pendingEdit = { ...this.pendingEdit } // 保留交接现场
        if (task) aiTaskManager.finishTask(task.taskId, { outputKind: 'image' })
      } catch (e) {
        aiMsg.status = 'failed'
        aiMsg.error = (e && e.message) || '编辑失败'
        if (task) aiTaskManager.failTask(task.taskId, aiMsg.error)
      }
      this.chatList = [...this.chatList]
      this.persistMessage(aiMsg)
      this.scrollToBottom()
    },

    // ─────────── 消息操作 ───────────
    isImageResult(msg) {
      return !!(msg.result && isImageKindOf(msg.result.kind) && msg.result.url)
    },
    canRegen(msg) {
      return !!(msg.result && msg.result.url) || (msg.result && msg.result.kind === 'text')
    },
    async retryMessage(msg) {
      // 简化：把该 AI 消息对应的上一条用户消息重放
      const idx = this.chatList.findIndex((m) => m.id === msg.id)
      if (idx <= 0) return
      const userMsg = [...this.chatList].slice(0, idx).reverse().find((m) => m.role === 'user')
      if (!userMsg) return
      this.inputPrompt = userMsg.prompt || ''
      await this.sendMessage({ force: true })
    },
    async copyMessage(msg) {
      const text = (msg.result && (msg.result.text || msg.result.url)) || msg.prompt || ''
      uni.setClipboardData({ data: String(text), success: () => uni.showToast({ title: '已复制', icon: 'none' }) })
    },
    async mountResultAsRef(msg, targetMode) {
      const url = msg.result && msg.result.url
      if (!url) return
      const wantVideo = targetMode === 'image_to_video'
      this.domain = wantVideo ? 'video' : 'image'
      if (!wantVideo) this.imageSub = 'standard'
      this.canvasPinnedId = ''
      this.addRef({ url, fid: '', label: '生成结果', source: 'stage', kind: 'image' })
      this.resetParamsForModel()
      await this.bindSession(false)
      uni.showToast({ title: wantVideo ? '已挂上转视频参考图' : '已挂上图生图参考图', icon: 'none' })
    },
    openResultDetail(msg) {
      if (msg.derivativeFid) {
        // derivativeFid 是 derivatives.id；详情页按 derivative= 定位主衍生图
        const fid = this.pendingEdit && this.pendingEdit.sourceFid
        if (fid) uni.navigateTo({ url: `/pages/detail/detail?fid=${encodeURIComponent(fid)}&derivId=${msg.derivativeFid}` })
        return
      }
      uni.showToast({ title: '暂无详情入口', icon: 'none' })
    },
    async saveResultToAlbum(msg) {
      const r = msg.result
      if (!r || !r.url) return
      try {
        if (r.url.startsWith('data:image')) {
          const b64 = String(r.url).split(',')[1] || ''
          await saveBase64ImageToAlbum(b64, `ML_GEN_${Date.now()}.jpg`)
          return
        }
        await downloadAndSaveToAlbum({
          url: r.url,
          fileName: `ML_GEN_${Date.now()}${r.kind === 'video' ? '.mp4' : '.jpg'}`,
          isVideo: r.kind === 'video',
          isAudio: r.kind === 'audio',
        })
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
      }
    },
    openOutbound(msg) {
      const o = msg.outbound || {}
      this.previewKind = o.kind === 'edit' ? 'edit' : (o.modality === 'chat' || this.domain === 'chat' ? 'chat' : 'gen')
      this.previewPayload = { ...o }
      if (this.previewKind === 'gen') this.previewPayload.modality = this.previewPayload.modality || this.domain
      if (this.previewKind === 'chat') this.previewPayload.modality = 'chat'
      this.previewExtraNotes = msg.regionNote ? [`选区说明：${msg.regionNote}`] : []
      this.previewVisible = true
    },
    openLightbox(url, kind, label) {
      this.refLightbox = { show: true, url, kind: kind || 'image', label: label || '查看大图' }
    },

    // ─────────── 提示词片段（@图N 高亮） ───────────
    promptSegments(prompt, images) {
      const text = String(prompt || '')
      if (!text) return []
      const imgByTag = {}
      ;(images || []).forEach((im, i) => {
        const url = im && (im.url || im)
        const label = (im && im.label) || `图${i + 1}`
        imgByTag['@' + label] = url
        imgByTag['@图' + (i + 1)] = url
      })
      const re = /@(图\d+|图片\d+|视频\d+|首帧|尾帧)/g
      const segs = []
      let last = 0
      let m = re.exec(text)
      while (m) {
        if (m.index > last) segs.push({ type: 'text', value: text.slice(last, m.index) })
        const tag = m[0]
        segs.push({ type: 'ref', tag, label: tag.slice(1), img: imgByTag[tag] || '' })
        last = m.index + tag.length
        m = re.exec(text)
      }
      if (last < text.length) segs.push({ type: 'text', value: text.slice(last) })
      return segs.length ? segs : [{ type: 'text', value: text }]
    },

    applyPreset(p) {
      this.inputPrompt = p
      this.isEditingPrompt = true
    },

    // ─────────── 动态参数（全部由当前模型 schema 驱动） ───────────
    setSchemaParam(key, value) {
      if (!key) return
      if (this.isFieldLocked(key)) return
      const field = fieldByKey(this.currentSchema, key)
      let next = value
      if (field && ['number', 'range', 'duration'].includes(field.type)) {
        const n = Number(value)
        next = Number.isFinite(n) ? n : field.default
        if (next !== -1) {
          if (field.min != null) next = Math.max(Number(field.min), next)
          if (field.max != null) next = Math.min(Number(field.max), next)
        }
      } else if (field && field.type === 'bool') {
        next = !!value
      }
      this.schemaParams = { ...(this.schemaParams || {}), [key]: next }
    },
    paramValueOf(field) {
      if (!field || !field.key) return undefined
      const params = (this.ruleEval && this.ruleEval.params) || {}
      if (params[field.key] !== undefined) return params[field.key]
      if ((this.schemaParams || {})[field.key] !== undefined) return this.schemaParams[field.key]
      return field.default
    },
    paramOptionsOf(field) {
      if (!field || field.type !== 'enum') return []
      const override = this.ruleEval && this.ruleEval.fieldOverrides && this.ruleEval.fieldOverrides[field.key]
      const options = (override && override.options) || field.options || []
      return Array.isArray(options) ? options : []
    },
    optionText(field, opt) {
      return optionLabel(field, opt)
    },
    paramUnit(field) {
      if (!field) return ''
      const t = field.type
      if (t === 'duration') return ' s'
      if (field.unit) return ' ' + field.unit
      return ''
    },
    numericStepOf(field) {
      const n = field && field.step != null ? Number(field.step) : 1
      return Number.isFinite(n) && n > 0 ? n : 1
    },
    hasSmartStop(field) {
      if (!field) return false
      if (field.type === 'duration') return true
      return field.allow_smart === true || !!field.smart
    },
    paramRangeHint(field) {
      if (!field) return ''
      if (['number', 'range', 'duration'].includes(field.type)) {
        const unit = this.paramUnit(field)
        const min = field.min != null ? field.min : 0
        const max = field.max != null ? field.max : '—'
        return `范围 ${min}–${max}${unit}`
      }
      return ''
    },
    isFieldLocked(key) {
      if (!key) return false
      const locked = this.ruleEval && this.ruleEval.lockedKeys
      return Array.isArray(locked) && locked.includes(key)
    },
    lockReasonOf(key) {
      const reasons = (this.ruleEval && this.ruleEval.lockReasons) || {}
      return reasons[key] || '已由模型契约锁定'
    },
    sameValue(a, b) {
      return String(a) === String(b)
    },
    paramDisplay(field) {
      if (!field) return ''
      const value = this.paramValueOf(field)
      if (field.type === 'enum') return this.optionText(field, value)
      if (field.type === 'bool') return value ? '开启' : '关闭'
      if (['number', 'range', 'duration'].includes(field.type)) {
        if (value === -1 || value === '-1') return '智能'
        return `${value}${this.paramUnit(field)}`
      }
      return String(value == null ? '' : value)
    },
    stepParam(field, dir) {
      if (!field || this.isFieldLocked(field.key)) return
      if (!['number', 'range', 'duration'].includes(field.type)) return
      const step = this.numericStepOf(field)
      const current = Number(this.paramValueOf(field))
      const baseVal = Number.isFinite(current) && current !== -1
        ? current
        : Number(field.min != null ? field.min : 0)
      let next = baseVal + step * dir
      if (field.min != null) next = Math.max(Number(field.min), next)
      if (field.max != null) next = Math.min(Number(field.max), next)
      this.setSchemaParam(field.key, next)
    },
    onParamPill(field) {
      if (!field || !field.key) return
      this.activeParamKey = field.key
      this.sheetMode = 'param'
    },
    openMoreParams() {
      this.activeParamKey = ''
      this.sheetMode = 'more'
    },
    selectModel(m) {
      if (!m || !m.id) return
      if (this.domain === 'image') {
        if (this.imageSub === 'portrait') this.currentPortraitModelId = m.id
        else this.currentImageModelId = m.id
      } else if (this.domain === 'video') this.currentVideoModelId = m.id
      else if (this.domain === 'music') this.currentMusicModelId = m.id
      else this.currentChatModelId = m.id
      this.sheetMode = ''
      this.canvasPinnedId = ''
      this.resetParamsForModel()
      uni.showToast({ title: `已选: ${m.name}`, icon: 'none' })
    },

    // ─────────── 画布 / 历史列表辅助 ───────────
    focusCanvasItem(msg) {
      if (!msg) return
      this.canvasPinnedId = msg.id || ''
    },
    focusHistoryMessage(msg) {
      if (!msg) return
      this.canvasPinnedId = msg.id || ''
      // 历史列表里点 AI 结果：结果直接接管画布，无需滚动画布区
    },
    itemThumb(msg) {
      if (!msg || !msg.result) return ''
      const r = msg.result
      if (r.kind === 'video') return r.posterUrl || r.coverUrl || ''
      if (r.kind === 'audio') return ''
      if (r.url) return r.url
      return ''
    },
    itemLabel(msg) {
      if (!msg || !msg.result) return '记录'
      const r = msg.result
      if (r.kind === 'text') return (r.text || '文字').slice(0, 12)
      return r.label || (r.kind === 'video' ? '视频' : r.kind === 'audio' ? '音频' : '图片')
    },
    itemKindIcon(msg) {
      const k = msg && msg.result && msg.result.kind
      if (k === 'video') return '🎬'
      if (k === 'audio') return '🎵'
      if (k === 'text') return '💬'
      return '🖼'
    },
    historySummary(msg) {
      if (!msg) return ''
      if (msg.status === 'running') return msg.prompt || '正在生成…'
      if (msg.status === 'failed') return msg.error || '生成失败'
      if (msg.result && msg.result.kind === 'text') return msg.result.text || ''
      if (msg.result && msg.result.label) return msg.result.label
      return msg.prompt || '已完成'
    },
    historyStatusText(msg) {
      const s = (msg && msg.status) || 'done'
      if (s === 'running') return '生成中'
      if (s === 'failed') return '失败'
      return '完成'
    },
    mediaKindOf(mode) {
      const m = String(mode || '')
      if (m === 'text_to_song' || m === 'text_to_bgm' || m.includes('music')) return 'audio'
      if (m.includes('video') || m === 'first_last_frame') return 'video'
      return 'image'
    },
    media(fid) {
      return mediaUrl(fid)
    },
    grid(fid) {
      return gridUrl(fid)
    },
    clearPendingEdit() {
      this.pendingEdit = null
      this.inputPrompt = ''
      this.resetModel3d()
      this.refs = this.refs.filter((r) => r.source !== '3d_snapshot')
      uni.showToast({ title: '已退出精准编辑模式', icon: 'none' })
    },
  },
}
</script>


<style scoped>
/* ── 全局页面基础 ─────────────────────── */
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #F6F7F9;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Segoe UI", sans-serif;
}

.status-bar {
  background: #F6F7F9;
}

/* ── 顶栏与 4 模式 Segmented Control ── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: #F6F7F9;
  gap: 10px;
  z-index: 20;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.icon-btn-hover {
  background: #E5E7EB;
}

.icon-btn.clear {
  width: auto;
  padding: 0 10px;
}

.topbar-clear {
  font-size: 12px;
  color: #64748B;
  font-weight: 500;
}

/* 苹果原生 Segmented Control (分段胶囊) */
.segment-wrap {
  display: flex;
  background: #E8EBF0;
  padding: 3px;
  border-radius: 999px;
  gap: 2px;
}

.segment-item {
  padding: 5px 14px;
  border-radius: 999px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.segment-hover {
  opacity: 0.8;
}

.segment-item.active {
  background: #FFFFFF;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.segment-t {
  font-size: 13px;
  font-weight: 500;
  color: #64748B;
}

.segment-item.active .segment-t {
  font-weight: 700;
  color: #0F172A;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 右上角创作库入口 */
.top-lib-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #FFFFFF;
  border: 1px solid rgba(0, 122, 255, 0.15);
  box-shadow: 0 1px 4px rgba(0, 122, 255, 0.06);
  padding: 6px 11px;
  border-radius: 999px;
}

.top-lib-hover {
  background: #EFF6FF;
}

.top-lib-t {
  font-size: 12px;
  font-weight: 600;
  color: #007AFF;
}

/* 次级分类条 (标准生图/人像；纯音乐/文生歌) */
.sub-mode-bar {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 2px 14px 6px;
  background: #F6F7F9;
}

.sub-chip {
  padding: 4px 14px;
  border-radius: 999px;
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.sub-chip.active {
  background: #007AFF;
  border-color: #007AFF;
}

.sub-chip-t {
  font-size: 11px;
  font-weight: 500;
  color: #64748B;
}

.sub-chip.active .sub-chip-t {
  color: #FFFFFF;
  font-weight: 600;
}

/* ── 精准编辑横幅 ─────────────────── */
.edit-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 14px 0;
  padding: 8px 12px;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 14px;
}

.edit-banner-img {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #DBEAFE;
  flex-shrink: 0;
}

.edit-banner-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.edit-banner-title {
  font-size: 12px;
  font-weight: 700;
  color: #1D4ED8;
}

.edit-banner-sub {
  font-size: 11px;
  color: #64748B;
}

.edit-banner-close {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 122, 255, 0.1);
}

.edit-banner-close-hover {
  background: rgba(0, 122, 255, 0.2);
}

.edit-banner-close-t {
  font-size: 13px;
  color: #1D4ED8;
}

/* ── 家具参考 · 3D 朝向 ─────────────── */
.model3d-card {
  margin: 6px 14px 0;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
}

.model3d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.model3d-title {
  font-size: 12px;
  font-weight: 700;
  color: #0F172A;
}

.model3d-status {
  font-size: 10px;
  font-weight: 700;
  color: #B45309;
  background: #FEF3C7;
  padding: 2px 8px;
  border-radius: 999px;
}

.model3d-status.ok {
  color: #15803D;
  background: #DCFCE7;
}

.model3d-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.model3d-empty-t {
  font-size: 11px;
  color: #64748B;
  line-height: 1.5;
}

.model3d-pick {
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: 999px;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
}

.model3d-pick-hover {
  background: #DBEAFE;
}

.model3d-pick-t {
  font-size: 11px;
  font-weight: 700;
  color: #007AFF;
}

.model3d-body {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.model3d-thumb {
  width: 60px;
  height: 60px;
  border-radius: 10px;
  background: #F1F5F9;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.model3d-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.model3d-name {
  font-size: 12px;
  font-weight: 700;
  color: #0F172A;
}

.model3d-sub {
  font-size: 10px;
  color: #64748B;
}

.model3d-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.model3d-btn {
  padding: 5px 10px;
  border-radius: 999px;
  background: #007AFF;
}

.model3d-btn.ghost {
  background: #F1F5F9;
}

.model3d-btn-hover {
  opacity: 0.85;
}

.model3d-btn-t {
  font-size: 10px;
  font-weight: 700;
  color: #FFFFFF;
}

.model3d-btn.ghost .model3d-btn-t {
  color: #475569;
}

.model3d-warn {
  font-size: 10px;
  color: #B45309;
}

.model3d-error {
  font-size: 10px;
  color: #EF4444;
}

/* ========================================================================= */
/* 创作主工作区：参考大图工作台 (默认展开，参考图 0 / 图 1) VS 历史记录 */
/* ========================================================================= */
.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 14px 4px;
}

/* 模式 A：大图工作台容器 */
.big-stage-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}

.stage-toggle-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 4px;
}

.session-crumb {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.04);
  padding: 3px 10px;
  border-radius: 999px;
  max-width: 60%;
}

.session-crumb-t {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
}

.stage-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 8px;
}

.stage-toggle-hover {
  background: rgba(0, 0, 0, 0.05);
}

.stage-toggle-t {
  font-size: 11px;
  color: #64748B;
  font-weight: 500;
}

/* 无参考图时的居中优雅大卡片 (参考图 0，支持素材库与相册双板块) */
.big-empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px 20px;
}

.big-stage-card {
  width: 100%;
  max-width: 320px;
  background: #FFFFFF;
  border-radius: 24px;
  box-shadow: 0 16px 36px -12px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.big-stage-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px 24px;
  gap: 12px;
  background: linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%);
  transition: transform 0.16s ease;
}

.big-stage-hero-hover {
  background: #F1F5F9;
}

.big-stage-plus-circle {
  width: 56px;
  height: 56px;
  border-radius: 28px;
  background: #FFFFFF;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}

.big-stage-label {
  font-size: 17px;
  font-weight: 700;
  color: #0F172A;
  letter-spacing: -0.3px;
}

.big-stage-hint {
  font-size: 12px;
  color: #94A3B8;
  font-weight: 400;
}

/* 两个核心导入板块 */
.big-stage-plates {
  display: flex;
  flex-direction: column;
  background: #FFFFFF;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
}

.stage-plate-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  transition: background 0.16s ease;
}

.stage-plate-hover {
  background: #F8FAFC;
}

.stage-plate-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stage-plate-icon.blue {
  background: rgba(0, 122, 255, 0.08);
}

.stage-plate-icon.green {
  background: rgba(16, 185, 129, 0.1);
}

.stage-plate-texts {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage-plate-title {
  font-size: 13px;
  font-weight: 600;
  color: #1E293B;
}

.stage-plate-sub {
  font-size: 11px;
  color: #94A3B8;
}

.stage-plate-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.04);
  margin: 0 16px;
}

/* 有参考图时的横向大卡片流 (参考图 1) */
.big-refs-section {
  flex-shrink: 0;
  width: 100%;
}

.big-refs-scroll {
  width: 100%;
  white-space: nowrap;
}

.big-refs-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 2px 8px;
}

.big-ref-card {
  position: relative;
  width: 200px;
  height: 260px;
  border-radius: 20px;
  overflow: hidden;
  flex-shrink: 0;
  background: #FFFFFF;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.04);
}

.big-ref-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.big-ref-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.big-ref-close-hover {
  background: rgba(0, 0, 0, 0.8);
}

.big-ref-tag {
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.big-ref-tag-t {
  font-size: 10px;
  font-weight: 700;
  color: #FFFFFF;
}

/* 尾随的添加小卡片 */
.big-ref-add-card {
  width: 64px;
  height: 260px;
  border-radius: 20px;
  background: #FFFFFF;
  border: 1.5px dashed rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
}

.big-ref-add-hover {
  background: #EFF6FF;
  border-color: #007AFF;
}

.big-ref-add-t {
  font-size: 11px;
  color: #64748B;
  font-weight: 500;
}

/* 最新产物展示区 (卡片化) */
.big-result-card {
  flex: 1;
  background: #FFFFFF;
  border-radius: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.result-running {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 12px;
}

.result-pulse-ring {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  border: 3px solid #BFDBFE;
  border-top-color: #007AFF;
  animation: ml-spin 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.result-running-t {
  font-size: 13px;
  font-weight: 700;
  color: #007AFF;
}

.result-prog-bar {
  width: 68%;
  height: 5px;
  border-radius: 999px;
  background: #E2E8F0;
  overflow: hidden;
}

.result-prog-fill {
  height: 100%;
  background: #007AFF;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.result-running-sub {
  font-size: 11px;
  color: #94A3B8;
  text-align: center;
  max-width: 80%;
}

.result-failed {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 10px;
}

.result-failed-t {
  font-size: 12px;
  color: #EF4444;
}

.canvas-mini-btn {
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: 999px;
  padding: 6px 14px;
}

.canvas-mini-btn-t {
  font-size: 11px;
  color: #EF4444;
  font-weight: 600;
}

.result-media-wrap {
  flex: 1;
  min-height: 180px;
  background: #0F172A;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-media-img {
  width: 100%;
  height: 100%;
}

.result-media-video {
  width: 100%;
  height: 100%;
}

.result-text-box {
  flex: 1;
  padding: 14px;
  box-sizing: border-box;
}

.result-text-content {
  font-size: 13px;
  color: #0F172A;
  line-height: 1.7;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: #FFFFFF;
  border-top: 1px solid rgba(0, 0, 0, 0.04);
}

.result-act {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #F8FAFC;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  padding: 5px 9px;
}

.result-act.accent {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.result-act-hover {
  background: #E2E8F0;
}

.result-act-t {
  font-size: 11px;
  font-weight: 500;
  color: #0F172A;
}

.result-act.accent .result-act-t {
  color: #007AFF;
  font-weight: 600;
}

/* 模式 B：过程记录模式容器 */
.compact-history-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #FFFFFF;
  border-radius: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.compact-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #F8FAFC;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.compact-top-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compact-top-t {
  font-size: 12px;
  font-weight: 600;
  color: #007AFF;
}

.compact-refs-strip {
  display: flex;
  gap: 4px;
}

.compact-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
}

.history-scroll {
  flex: 1;
  min-height: 0;
  padding: 12px 14px;
  box-sizing: border-box;
}

.history-empty {
  padding: 48px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.history-empty-t {
  font-size: 12px;
  color: #94A3B8;
}

.h-row {
  margin-bottom: 12px;
}

.h-user {
  display: flex;
  justify-content: flex-end;
}

.h-user-bubble {
  max-width: 82%;
  background: #007AFF;
  border-radius: 18px 18px 4px 18px;
  padding: 10px 14px;
  color: #FFFFFF;
}

.h-user-t {
  font-size: 13px;
  line-height: 1.5;
  color: #FFFFFF;
}

.h-user-refs {
  margin-top: 4px;
}

.h-user-refs-t {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.8);
}

.h-ai-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.h-ai-thumb {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: #EFF6FF;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.h-ai-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.h-ai-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.h-ai-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.h-ai-model {
  font-size: 11px;
  font-weight: 700;
  color: #475569;
}

.h-ai-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #F1F5F9;
  color: #64748B;
}

.h-ai-status.st-running {
  background: #EFF6FF;
  color: #007AFF;
}

.h-ai-status.st-done {
  background: #DCFCE7;
  color: #15803D;
}

.h-ai-text {
  font-size: 12px;
  color: #334155;
  line-height: 1.55;
}

.msg-tail {
  height: 12px;
}

/* ========================================================================= */
/* 底部输入坞：极简苹果卡片式 (参考图 0 / 图 1) */
/* ========================================================================= */
.composer-card {
  margin: 0 14px calc(6px + env(safe-area-inset-bottom));
  background: #FFFFFF;
  border-radius: 22px;
  box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
  border: 1px solid rgba(0, 0, 0, 0.05);
  padding: 12px 14px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 30;
}

.composer-input-row {
  width: 100%;
}

.composer-textarea {
  width: 100%;
  min-height: 38px;
  max-height: 120px;
  font-size: 14px;
  line-height: 1.5;
  color: #0F172A;
}

.composer-ph {
  color: #94A3B8;
  font-size: 14px;
}

.composer-warnings {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.composer-warn-t {
  font-size: 11px;
  color: #D97706;
}

.composer-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.composer-pills-scroll {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.composer-pills-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
}

.composer-pills-left::-webkit-scrollbar {
  display: none;
}

/* 常用配置胶囊排布 */
.capsule-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #F1F5F9;
  border-radius: 12px;
  padding: 6px 9px;
  flex-shrink: 0;
  transition: all 0.16s ease;
}

.capsule-hover {
  background: #E2E8F0;
}

.capsule-pill.model-pill {
  background: #F1F5F9;
}

.capsule-pill.more-pill {
  background: #F8FAFC;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.capsule-t {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
}

.capsule-prefix {
  font-size: 11px;
  color: #64748B;
  font-weight: 400;
}

.capsule-sep {
  font-size: 10px;
  color: #94A3B8;
  margin: 0 1px;
}

.capsule-val {
  font-size: 12px;
  font-weight: 600;
  color: #0F172A;
}

.capsule-t.strong {
  font-weight: 600;
  color: #0F172A;
}

.capsule-badge {
  font-size: 9px;
  background: #007AFF;
  color: #FFFFFF;
  border-radius: 999px;
  padding: 0 4px;
  font-weight: 700;
}

.composer-actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.composer-opt-btn {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  background: #F8FAFC;
  display: flex;
  align-items: center;
  justify-content: center;
}

.composer-opt-btn.disabled {
  opacity: 0.35;
}

.opt-hover {
  background: #EFF6FF;
}

/* 圆形发送按钮 */
.composer-send-btn {
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: #CBD5E1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.composer-send-btn.active {
  background: #007AFF;
  box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
}

.send-hover {
  transform: scale(0.92);
}

.composer-foot-note {
  text-align: center;
  padding-top: 2px;
}

.foot-note-t {
  font-size: 10px;
  color: #94A3B8;
  letter-spacing: 0.02em;
}

/* ── @ 联想 ─────────────────────────── */
.at-popup {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 160px;
  z-index: 50;
  background: #FFFFFF;
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  overflow: hidden;
}

.at-list {
  max-height: 200px;
}

.at-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}

.at-thumb {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #F1F5F9;
}

.at-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.at-name {
  font-size: 12px;
  font-weight: 700;
  color: #007AFF;
}

.at-sub {
  font-size: 10px;
  color: #64748B;
}

/* ── 参数 Sheet ──────────────────────── */
.sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 990;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.sheet {
  background: #FFFFFF;
  border-radius: 24px 24px 0 0;
  max-height: 76vh;
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.08);
  animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.sheet-title {
  font-size: 15px;
  font-weight: 700;
  color: #0F172A;
}

.sheet-close {
  width: 28px;
  height: 28px;
  border-radius: 14px;
  background: #F1F5F9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sheet-body {
  padding: 14px 18px;
  box-sizing: border-box;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.04);
  margin-bottom: 8px;
  background: #FFFFFF;
}

.model-item.active {
  background: #EFF6FF;
  border-color: #BFDBFE;
}

.model-hover {
  background: #F8FAFC;
}

.model-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.model-name {
  font-size: 13px;
  font-weight: 700;
  color: #0F172A;
}

.model-desc {
  font-size: 11px;
  color: #64748B;
  line-height: 1.45;
}

.option-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 12px;
}

.option {
  width: calc(33.33% - 6px);
  height: 44px;
  border-radius: 12px;
  border: 1px solid #E2E8F0;
  align-items: center;
  justify-content: center;
  display: flex;
  background: #FFFFFF;
}

.option.active {
  background: #007AFF;
  border-color: #007AFF;
}

.option-t {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.option.active .option-t {
  color: #FFFFFF;
}

.param-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.param-field-t {
  font-size: 13px;
  color: #0F172A;
  font-weight: 500;
}

.sheet-preview-wrap {
  margin-top: 16px;
  padding: 8px 0;
  display: flex;
  justify-content: center;
}

.sheet-preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  background: #F8FAFC;
  border: 1px solid rgba(0, 0, 0, 0.06);
}

.sheet-preview-hover {
  background: #F1F5F9;
}

.sheet-preview-t {
  font-size: 12px;
  color: #64748B;
  font-weight: 500;
}

/* ── 素材选择器 ─────────────────────── */
.sheet.picker {
  max-height: 82vh;
}

.picker-search {
  display: flex;
  gap: 8px;
  padding: 12px 16px 4px;
}

.picker-input {
  flex: 1;
  height: 38px;
  background: #F1F5F9;
  border-radius: 10px;
  padding: 0 12px;
  font-size: 13px;
}

.picker-btn {
  background: #007AFF;
  border-radius: 10px;
  padding: 0 14px;
  display: flex;
  align-items: center;
}

.picker-btn-t {
  color: #FFFFFF;
  font-size: 12px;
  font-weight: 600;
}

.picker-grid {
  max-height: 52vh;
  padding: 8px 12px;
}

.picker-grid-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.picker-card {
  width: calc(33.33% - 6px);
}

.picker-img {
  width: 100%;
  height: 104px;
  border-radius: 12px;
  background: #EFF4FA;
}

.picker-name {
  font-size: 10px;
  color: #64748B;
  margin-top: 3px;
}

.picker-status {
  width: 100%;
  padding: 20px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.picker-status-t {
  font-size: 12px;
  color: #94A3B8;
}

.picker-more {
  width: 100%;
  padding: 12px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.picker-more-t {
  font-size: 12px;
  color: #007AFF;
  font-weight: 600;
}

.picker-foot {
  display: flex;
  gap: 8px;
  padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

.picker-action {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  background: #007AFF;
  display: flex;
  align-items: center;
  justify-content: center;
}

.picker-action.ghost {
  background: #F1F5F9;
}

.picker-action-t {
  font-size: 13px;
  font-weight: 600;
  color: #FFFFFF;
}

.picker-action.ghost .picker-action-t {
  color: #64748B;
}

@keyframes ml-spin {
  to { transform: rotate(360deg); }
}
</style>
