<template>
  <view class="page">
    <view class="status-bar" :style="{ paddingTop: statusBarHeight + 'px' }" />

    <!-- 顶栏：抽屉 | 素材库·操作 | 动作 -->
    <view class="nav-bar">
      <!-- 创作工作台下显示返回和模式标题 -->
      <template v-if="mainView === 'operate' && inStudioDesk">
        <view class="nav-left desk-back" @click="exitStudioDesk">
          <text class="desk-back-arrow">‹</text>
        </view>
        <view class="desk-mode-header" @click="showDomainDropdown = !showDomainDropdown">
          <text class="desk-mode-title">{{ deskTitle }}</text>
          <text class="desk-mode-arrow">{{ showDomainDropdown ? '▴' : '▾' }}</text>
        </view>
        <view class="nav-right">
          <view class="icon-btn" @click="resetDeskState">
            <text class="action-icon">重置</text>
          </view>
        </view>
      </template>

      <!-- 默认主态顶栏 -->
      <template v-else>
        <view class="nav-left" @click="openDrawer">
          <view class="hamburger">
            <view class="ham-line" />
            <view class="ham-line" />
            <view class="ham-line short" />
          </view>
        </view>

        <view class="segment-pill">
          <view
            :class="['seg-item', { active: mainView === 'library' }]"
            @click="switchMain('library')"
          >
            <text class="seg-text">素材库</text>
          </view>
          <view
            :class="['seg-item', { active: mainView === 'operate' }]"
            @click="switchMain('operate')"
          >
            <text class="seg-text">操作</text>
          </view>
        </view>

        <view class="nav-right">
          <view v-if="mainView === 'operate' && chatList.length" class="icon-btn" @click="confirmClearChat">
            <text class="action-icon">清空</text>
          </view>
          <view v-else class="icon-btn placeholder" />
        </view>
      </template>
    </view>

    <!-- 沉浸工作台顶栏模态下拉菜单 -->
    <view v-if="mainView === 'operate' && inStudioDesk && showDomainDropdown" class="desk-menu-mask" @click="showDomainDropdown = false">
      <view class="desk-menu-popover" @click.stop>
        <view
          v-for="d in deskModes"
          :key="d.id"
          :class="['desk-menu-item', { active: domain === d.id }]"
          @click="switchDeskDomain(d.id)"
        >
          <text class="desk-menu-icon">{{ d.icon }}</text>
          <text class="desk-menu-label">{{ d.label }}</text>
          <text v-if="domain === d.id" class="desk-menu-check">✓</text>
        </view>
      </view>
    </view>

    <!-- 素材库 -->
    <home-library v-show="mainView === 'library'" :active="mainView === 'library'" />

    <!-- 操作页 -->
    <view v-show="mainView === 'operate'" class="operate" :style="{ background: inStudioDesk ? '#F8FAFC' : domainSoftBg }">
      <!-- 态一：工坊首页 / 纯对话态（图 6 风格） -->
      <view v-if="!inStudioDesk" class="home-desk-view">
        <scroll-view
          scroll-y
          class="chat-scroll"
          :scroll-into-view="scrollIntoId"
          :scroll-with-animation="true"
        >
          <view v-if="!chatList.length" class="welcome">
            <view class="welcome-badge">✨ AI 工坊</view>
            <text class="welcome-title">开始创作 ~</text>
            <text class="welcome-desc">探索室内光影与空间魔法，支持生图、生视频、配乐与精修</text>

            <view class="studio-feature-cards">
              <view class="feature-card banner" @click="enterDesk('video')">
                <view class="feat-badge">Wan 3.0</view>
                <view class="feat-info">
                  <text class="feat-title">Wan 3.0 视频生成全新上线</text>
                  <text class="feat-sub">多图全能参考 · 电影质感光影位移</text>
                </view>
                <text class="feat-go">立即体验 ›</text>
              </view>
              <view class="feature-card" @click="enterDesk('image')">
                <view class="feat-badge img">Agnes 2.5</view>
                <view class="feat-info">
                  <text class="feat-title">空间效果图与全能生图</text>
                  <text class="feat-sub">现代轻奢/奶油风效果图一键生成</text>
                </view>
                <text class="feat-go">开始作图 ›</text>
              </view>
            </view>

            <view class="preset-list">
              <view
                v-for="p in chatPresets"
                :key="p"
                class="preset-pill"
                @click="applyPreset(p)"
              >
                <text class="preset-t">{{ p }}</text>
              </view>
            </view>
          </view>

          <!-- 聊天流水记录 -->
          <view
            v-for="(msg, idx) in chatList"
            :key="msg.id || idx"
            :id="'msg-' + (msg.id || idx)"
            class="chat-group"
          >
            <view v-if="msg.role === 'user'" class="bubble-row user">
              <view class="bubble user">
                <view class="user-meta">
                  <text class="mode-tag">{{ domainLabelOf(msg.mode) }}</text>
                  <text v-if="msg.params && msg.params.ratio" class="param-tag">{{ msg.params.ratio }}</text>
                  <text v-if="msg.params && msg.params.duration" class="param-tag">{{ msg.params.duration }}s</text>
                  <text v-if="msg.params && msg.params.clarity" class="param-tag">{{ msg.params.clarity === 'hd' ? '高清' : '标清' }}</text>
                </view>
                <view class="user-prompt-rich">
                  <template v-for="(seg, sI) in promptSegments(msg.prompt, msg.images)">
                    <text v-if="seg.type === 'text'" :key="'t' + sI" class="user-prompt">{{ seg.value }}</text>
                    <view v-else :key="'r' + sI" class="inline-ref-chip">
                      <image v-if="seg.img" :src="seg.img" class="inline-ref-thumb" mode="aspectFill" />
                      <text class="inline-ref-label">{{ seg.label }}</text>
                    </view>
                  </template>
                </view>
                <view v-if="msg.images && msg.images.length" class="ref-tray">
                  <view
                    v-for="(im, iIdx) in msg.images"
                    :key="iIdx"
                    class="ref-thumb"
                  >
                    <image :src="im.url || im" class="ref-img" mode="aspectFill" />
                    <text v-if="im.label" class="ref-label">{{ im.label }}</text>
                  </view>
                </view>
              </view>
            </view>

            <view v-else class="bubble-row ai">
              <view class="ai-avatar">🤖</view>
              <view class="bubble ai">
                <view v-if="msg.status === 'running'" class="status-running">
                  <view class="spinner" />
                  <view class="run-info">
                    <text class="run-title">{{ msg.engineTitle || '生成中…' }}</text>
                    <text class="run-sub">{{ msg.progress ? `已完成 ${msg.progress}%` : '正在处理' }}</text>
                  </view>
                </view>
                <view v-else-if="msg.status === 'failed'" class="status-failed">
                  <text class="failed-t">{{ msg.error || '生成失败，请重试' }}</text>
                </view>
                <view v-else-if="msg.kind === 'text' || (msg.result && msg.result.kind === 'text')" class="text-result">
                  <text class="text-body">{{ msg.result && (msg.result.text || msg.result.url) }}</text>
                </view>
                <view v-else class="result-card">
                  <video
                    v-if="msg.result && msg.result.kind === 'video' && msg.result.url"
                    :src="msg.result.url"
                    class="result-video"
                    controls
                    :autoplay="false"
                    :loop="false"
                  />
                  <audio
                    v-else-if="msg.result && msg.result.kind === 'audio' && msg.result.url"
                    :src="msg.result.url"
                    class="result-audio"
                    controls
                  />
                  <image
                    v-else-if="msg.result && msg.result.url"
                    :src="msg.result.url"
                    class="result-image"
                    mode="widthFix"
                    @click="previewMedia(msg.result.url)"
                  />
                  <view v-if="msg.result && msg.result.url" class="result-actions">
                    <view
                      v-if="msg.result.kind === 'image'"
                      class="act-btn"
                      @click="copyToDomain('video', msg.result.url)"
                    >
                      <text class="act-t">转生视频</text>
                    </view>
                    <view
                      v-if="msg.result.kind === 'image'"
                      class="act-btn"
                      @click="copyToDomain('image', msg.result.url)"
                    >
                      <text class="act-t">以此图生图</text>
                    </view>
                    <view
                      v-if="msg.result.kind === 'image'"
                      class="act-btn"
                      @click="previewMedia(msg.result.url)"
                    >
                      <text class="act-t">放大</text>
                    </view>
                  </view>
                </view>
              </view>
            </view>
          </view>
          <view class="chat-pad" />
        </scroll-view>

        <!-- 态一底部：快捷胶囊 + 输入框（图 6 规范） -->
        <view class="home-composer">
          <view class="quick-pill-row">
            <view class="quick-desk-pill video" @click="enterDesk('video')">
              <text class="q-icon">🎬</text>
              <text class="q-label">AI 生视频</text>
            </view>
            <view class="quick-desk-pill image" @click="enterDesk('image')">
              <text class="q-icon">🖼️</text>
              <text class="q-label">AI 生图</text>
            </view>
            <view class="quick-desk-pill music" @click="enterDesk('music')">
              <text class="q-icon">🎵</text>
              <text class="q-label">AI 生音乐</text>
            </view>
            <view class="quick-desk-pill portrait" @click="enterDesk('portrait')">
              <text class="q-icon">👤</text>
              <text class="q-label">AI 生人像</text>
            </view>
          </view>

          <view v-if="slotImages.length && domain === 'chat'" class="home-ref-row">
            <view
              v-for="(img, sIdx) in slotImages"
              :key="'home_ref_' + sIdx"
              class="desk-ref-chip"
              @click="onRefChipClick(sIdx)"
            >
              <text class="chip-at">@</text>
              <text class="chip-name">{{ getSlotTagLabel(sIdx) }}</text>
              <text class="chip-plus" @click.stop="removeSlotImage(sIdx)">✕</text>
            </view>
          </view>
          <view class="home-input-bar">
            <view class="home-attach" @click="chooseChatMedia">
              <text class="home-attach-t">＋</text>
            </view>
            <view class="home-input-wrap">
              <textarea
                v-model="inputPrompt"
                class="home-main-input"
                placeholder="发消息，可 @图片1 / @视频1 引用素材…"
                :maxlength="1000"
                :auto-height="true"
                :show-confirm-bar="false"
              />
            </view>
            <button class="home-send-btn" :disabled="!canSend || sending" @click="handleSend">
              <text class="home-send-t">{{ sending ? '…' : '↑' }}</text>
            </button>
          </view>
          <view class="safe-bottom" />
        </view>
      </view>

      <!-- 态二：沉浸式创作工作台（图 7~10 规范） -->
      <view v-else class="studio-desk-view">
        <scroll-view scroll-y class="desk-scroll">
          <view class="desk-canvas-stage">
            <view v-if="isLibraryMode" class="portrait-lib">
              <text class="stage-title">虚拟人像库</text>
              <text class="stage-desc">只收录虚拟形象。全身竖图和正面无表情特写放在同一角色组里。入库完成后才能在视频里当参考图。</text>
              <view v-if="!portraitConsented" class="portrait-consent">
                <text class="portrait-warn">上传前需确认：你合法拥有该素材并有完整使用权；形象不与任何自然人雷同，也不抄袭盗用；内容不违法、不违背公序良俗。</text>
                <view class="opt-btn" @click="confirmPortraitConsent">
                  <text class="opt-btn-t">我确认并继续</text>
                </view>
              </view>
              <view v-else>
                <view class="portrait-new-row">
                  <input class="portrait-name-input" v-model="portraitGroupName" placeholder="角色名称" />
                  <view class="opt-btn" @click="createPortraitGroupLocal">
                    <text class="opt-btn-t">新建角色组</text>
                  </view>
                </view>
                <view v-if="!portraitLibraryGroups.length" class="stage-desc">还没有角色组</view>
                <view v-for="g in portraitLibraryGroups" :key="'pg_' + g.id" class="portrait-group">
                  <view class="portrait-group-head">
                    <text class="portrait-group-name">{{ g.name }}</text>
                    <text class="portrait-link" @click="removePortraitGroup(g)">删除组</text>
                  </view>
                  <view class="portrait-asset-row">
                    <view v-for="a in g.assets" :key="'pa_' + a.id" class="portrait-asset">
                      <text class="portrait-asset-name">{{ a.name || '图片' }}</text>
                      <text :class="['portrait-status', a.status]">{{ portraitStatusText(a.status) }}</text>
                      <text v-if="a.error" class="portrait-err">{{ a.error }}</text>
                      <text class="portrait-link" @click="removePortraitAsset(a)">删除</text>
                    </view>
                    <view class="opt-btn" @click="pickPortraitFile(g)">
                      <text class="opt-btn-t">上传图片</text>
                    </view>
                  </view>
                </view>
              </view>
            </view>

            <!-- 纯文生模式态（文生人像、文生图、文生视频等）：展示轻量纯文创作台，不挂图片卡片 -->
            <view v-else-if="isTextOnlyMode" class="desk-text-stage">
              <view class="text-stage-card">
                <view class="stage-icon-box">
                  <text class="stage-icon">✍️</text>
                </view>
                <text class="stage-title">纯文本自由创作</text>
                <text class="stage-desc">当前为【{{ currentModeLabel }}】模式，无需输入参考素材，直接在下方描述提示词即可生成</text>
                <view class="stage-switch-btn" @click="switchToImageMode">
                  <text class="stage-btn-t">+ 切换为参考素材生成</text>
                </view>
              </view>
            </view>

            <!-- 图生模式态：未选素材时的大虚线卡片（图 7 风格） -->
            <view v-else-if="!slotImages.length" class="desk-big-slot" @click="chooseSlotMedia">
              <view class="big-plus-box">
                <text class="big-plus-icon">+</text>
              </view>
              <text class="big-slot-hint">添加图片 / 视频 / 音频作为参考</text>
              <text class="big-slot-sub">支持相册导入与素材库直接调取</text>
            </view>

            <!-- 已选素材时：横向大卡片轮播（图 9、10 风格） -->
            <scroll-view v-else scroll-x class="desk-slider" :show-scrollbar="false">
              <view class="slider-track">
                <view
                  v-for="(img, sIdx) in slotImages"
                  :key="'desk_slot_' + sIdx"
                  class="desk-card"
                >
                  <image :src="img" class="desk-card-img" mode="aspectFill" />
                  <view class="desk-card-tag">
                    <text class="desk-card-tag-t">{{ currentMode === 'first_last_frame' ? (sIdx === 0 ? '首帧' : '尾帧') : '图片' + (sIdx + 1) }}</text>
                  </view>
                  <view class="desk-card-del" @click.stop="removeSlotImage(sIdx)">
                    <text class="del-x">✕</text>
                  </view>
                </view>

                <!-- 末尾追加卡片 (+) 按钮（图 10 规范） -->
                <view v-if="slotImages.length < slotMaxImages" class="desk-card-add" @click="chooseSlotMedia">
                  <view class="add-circle">
                    <text class="add-plus">+</text>
                  </view>
                  <text class="add-t">添加更多</text>
                </view>
              </view>
            </scroll-view>
          </view>

          <!-- 生成中与成果展示（在当前创作工作台内直接呈现） -->
          <view v-if="currentDeskRun" class="desk-result-tray">
            <view v-if="currentDeskRun.status === 'running'" class="desk-run-card">
              <view class="desk-spinner" />
              <view class="run-text-col">
                <text class="run-h1">{{ deskTitle }} 正在全力生成中…</text>
                <text class="run-h2">{{ deskRunProgressText }}</text>
              </view>
            </view>
            <view v-else-if="currentDeskRun.status === 'failed'" class="desk-fail-card">
              <text class="fail-t">生成失败：{{ currentDeskRun.error || '服务器处理超时，请重试' }}</text>
              <view class="retry-pill" @click="handleRetry">
                <text class="retry-t">重试生成</text>
              </view>
            </view>
            <view v-else-if="currentDeskRun.result && currentDeskRun.result.url" class="desk-success-card">
              <video
                v-if="currentDeskRun.result.kind === 'video'"
                :src="currentDeskRun.result.url"
                class="desk-result-video"
                controls
              />
              <audio
                v-else-if="currentDeskRun.result.kind === 'audio'"
                :src="currentDeskRun.result.url"
                class="desk-result-audio"
                controls
              />
              <image
                v-else
                :src="currentDeskRun.result.url"
                class="desk-result-image"
                mode="widthFix"
                @click="previewMedia(currentDeskRun.result.url)"
              />
              <view class="desk-actions-bar">
                <view
                  v-if="currentDeskRun.result.kind === 'image'"
                  class="desk-act-btn"
                  @click="copyToDomain('video', currentDeskRun.result.url)"
                >
                  <text class="act-btn-t">🎬 转生视频</text>
                </view>
                <view
                  v-if="currentDeskRun.result.kind === 'image'"
                  class="desk-act-btn"
                  @click="copyToDomain('image', currentDeskRun.result.url)"
                >
                  <text class="act-btn-t">🔄 以此图生图</text>
                </view>
                <view class="desk-act-btn" @click="previewMedia(currentDeskRun.result.url)">
                  <text class="act-btn-t">🔍 放大查看</text>
                </view>
              </view>
            </view>
          </view>
          <view class="desk-scroll-pad" />
        </scroll-view>

        <!-- 底部一体化输入坞 -->
        <view v-if="!isLibraryMode" class="desk-composer">
          <view v-if="domain === 'video' && activePortraitAssets.length" class="portrait-pick">
            <text class="portrait-pick-label">虚拟人像参考</text>
            <view class="portrait-pick-row">
              <view
                v-for="a in activePortraitAssets"
                :key="'vp_' + a.id"
                :class="['portrait-chip', { on: isPortraitSelected(a.id) }]"
                @click="togglePortraitChip(a)"
              >
                <text class="portrait-chip-t">{{ portraitChipLabel(a) }}</text>
              </view>
            </view>
            <text v-if="portraitCaption" class="portrait-caption">{{ portraitCaption }}</text>
          </view>
          <view v-if="domain === 'music' && musicMode === 'text_to_song'" class="portrait-pick-row">
            <view :class="['portrait-chip', { on: songInputKind === 'prompt' }]" @click="songInputKind = 'prompt'">
              <text class="portrait-chip-t">提示词</text>
            </view>
            <view :class="['portrait-chip', { on: songInputKind === 'lyrics' }]" @click="songInputKind = 'lyrics'">
              <text class="portrait-chip-t">歌词</text>
            </view>
          </view>
          <!-- 当输入中键入 @ 时的浮动联想补全气泡 -->
          <view v-if="showAtPicker && !isTextOnlyMode && slotImages.length" class="at-suggest-popup">
            <view class="at-suggest-head">
              <text class="at-suggest-title">选择要引用的素材：</text>
              <text class="at-suggest-close" @click="showAtPicker = false">✕</text>
            </view>
            <view class="at-suggest-list">
              <view
                v-for="(img, sIdx) in slotImages"
                :key="'at_sug_' + sIdx"
                class="at-suggest-item"
                @click="completeAtReference(sIdx)"
              >
                <image :src="img" class="at-suggest-thumb" mode="aspectFill" />
                <text class="at-suggest-name">@{{ getSlotTagLabel(sIdx) }}</text>
              </view>
            </view>
          </view>

          <!-- 提示词功能条：@素材、优化、撤回、完成编辑、3/4屏全屏查看 -->
          <view class="opt-row">
            <view class="opt-left-btns">
              <view
                v-if="!isTextOnlyMode && slotImages.length"
                class="opt-btn at-btn"
                @click="toggleAtPicker"
              >
                <text class="opt-btn-t">@ 素材</text>
              </view>
              <view :class="['opt-btn', { busy: optimizingPrompt }]" @click="handleOptimizePrompt">
                <text class="opt-btn-t">{{ optimizingPrompt ? '优化中…' : '优化提示词' }}</text>
              </view>
              <view v-if="promptBeforeOptimize" class="opt-btn undo" @click="undoOptimize">
                <text class="opt-btn-t">撤回</text>
              </view>
              <view v-if="isEditingPrompt && inputPrompt" class="opt-btn done-edit" @click="isEditingPrompt = false">
                <text class="opt-btn-t">完成编辑</text>
              </view>
            </view>
            <view class="expand-trigger" @click="promptDrawerOpen = true">
              <text class="expand-trigger-icon">⤢</text>
              <text class="expand-trigger-t">全屏查看</text>
            </view>
          </view>

          <!-- 提示词输入区（正文行内流式混排，彻底移除顶部提炼栏） -->
          <view class="desk-input-box" @click="startEditPrompt">
            <!-- 展示态：文字与行内微缩图胶囊融为一行 -->
            <view
              v-if="!isEditingPrompt && inputPrompt"
              class="composer-inline-flow"
            >
              <template v-for="(seg, sI) in currentPromptSegments" :key="'cf_' + sI">
                <text v-if="seg.type === 'text'" class="flow-text">{{ seg.value }}</text>
                <view v-else class="inline-ref-chip flow-chip" @click.stop>
                  <image
                    v-if="seg.img"
                    :src="seg.img"
                    class="inline-ref-thumb clickable"
                    mode="aspectFill"
                    @click.stop="previewMedia(seg.img)"
                  />
                  <text class="inline-ref-label">@{{ seg.label }}</text>
                  <text class="inline-ref-x" @click.stop="removeRefFromPrompt(seg.tag)">✕</text>
                </view>
              </template>
              <text class="flow-edit-hint">✎</text>
            </view>

            <!-- 编辑态：原生文本域，支持光标与打字 -->
            <textarea
              v-else
              v-model="inputPrompt"
              class="desk-input"
              :placeholder="deskPlaceholder"
              :maxlength="4000"
              :show-confirm-bar="false"
              :focus="isEditingPrompt"
              @input="onPromptInput"
              @blur="onPromptBlur"
            />
          </view>

          <!-- 底栏控制条：模型胶囊 + 模式胶囊 + 生成按钮 -->
          <view class="desk-bottom-row">
            <view class="desk-left-capsules">
              <view class="desk-capsule" @click="openParamSheet('model')">
                <text class="cap-name">{{ currentModelInfo.name || '默认模型' }}</text>
                <text class="cap-arrow">▾</text>
              </view>
              <view class="desk-capsule" @click="openParamSheet('mode')">
                <text class="cap-name">{{ currentModeLabel }}</text>
                <text class="cap-arrow">⊸</text>
              </view>
            </view>

            <view
              :class="['desk-send-btn', { active: canSend && !sending, disabled: !canSend || sending }]"
              @click="handleSend"
            >
              <text class="desk-send-t">{{ sending ? '生成中' : '生成' }}</text>
            </view>
          </view>
          <view class="safe-bottom" />
        </view>

        <!-- 底部参数配置半屏抽屉（对齐图 7、8 规范：模型卡片、模式、清晰度、比例） -->
        <view v-if="paramSheetOpen" class="param-sheet-mask" @click="paramSheetOpen = false">
          <view class="param-sheet" @click.stop>
            <view class="sheet-head">
              <text class="sheet-title">生成参数与模型配置</text>
              <text class="sheet-close-btn" @click="paramSheetOpen = false">完成</text>
            </view>
            <scroll-view scroll-y class="sheet-scroll">
              <!-- 模型选择：按提供商分组呈现（图 1、图 2 规范） -->
              <view class="sheet-sec">
                <text class="sec-label">模型提供商与可用模型</text>
                <view v-for="grp in domainModelsGrouped" :key="grp.name" class="provider-model-group">
                  <view class="provider-group-header">
                    <text class="provider-group-icon">{{ grp.icon }}</text>
                    <text class="provider-group-name">{{ grp.name }}</text>
                    <text class="provider-group-count">{{ grp.items.length }}款</text>
                  </view>
                  <view class="model-grid-2x2">
                    <view
                      v-for="m in grp.items"
                      :key="m.id"
                      :class="['model-card-item', { active: currentModelId === m.id }]"
                      @click="selectDomainModel(m)"
                    >
                      <view class="m-card-head">
                        <text class="m-card-name">{{ m.name }}</text>
                        <text v-if="m.badge" class="m-card-badge">{{ m.badge }}</text>
                      </view>
                      <text class="m-card-desc">{{ m.polishHint || m.description || m.providerName || '' }}</text>
                    </view>
                  </view>
                </view>
              </view>

              <view v-if="currentSchema && currentSchema.polishHint" class="sheet-sec polish-card">
                <text class="sec-label">提示词优化配方</text>
                <text class="polish-hint">{{ currentSchema.polishHint }}</text>
                <text class="polish-at">引用素材请写 @图片1 @视频1 @音频1，提交时自动转成该模型记号。</text>
              </view>

              <view v-if="domainSubModes.length" class="sheet-sec">
                <text class="sec-label">模式</text>
                <view class="mode-seg-row">
                  <view
                    v-for="sub in domainSubModes"
                    :key="sub.id"
                    :class="['mode-seg-item', { active: currentMode === sub.id }]"
                    @click="switchSubMode(sub.id)"
                  >
                    <text class="mode-seg-t">{{ sub.label }}</text>
                  </view>
                </view>
              </view>

              <view v-for="f in schemaCommonFields" :key="f.key" class="sheet-sec">
                <text class="sec-label">{{ f.label }}</text>
                <view v-if="f.type === 'enum'" class="chip-row">
                  <view
                    v-for="opt in f.options"
                    :key="String(opt)"
                    :class="['sheet-chip', { active: genParams[f.key] === opt, locked: isFieldLocked(f.key) }]"
                    @click="!isFieldLocked(f.key) && setGenParam(f.key, opt)"
                  >
                    <text class="chip-t">{{ optionLabel(f, opt) }}{{ f.key === 'duration' && opt !== -1 ? 's' : '' }}</text>
                  </view>
                </view>
                <view v-else-if="f.type === 'range'" class="range-row">
                  <view
                    v-if="f.extraStops && f.extraStops.indexOf(-1) >= 0"
                    :class="['sheet-chip', { active: genParams[f.key] === -1, locked: isFieldLocked(f.key) }]"
                    @click="!isFieldLocked(f.key) && setGenParam(f.key, -1)"
                  >
                    <text class="chip-t">{{ (f.labels && f.labels['-1']) || '智能' }}</text>
                  </view>
                  <slider
                    class="range-slider"
                    :min="f.min"
                    :max="f.max"
                    :step="f.step || 1"
                    :value="genParams[f.key] === -1 ? f.min : Number(genParams[f.key])"
                    :disabled="isFieldLocked(f.key) || genParams[f.key] === -1"
                    @change="onRangeChange(f, $event)"
                  />
                  <text class="range-val">{{ genParams[f.key] === -1 ? '智能' : genParams[f.key] }}</text>
                </view>
                <view v-else-if="f.type === 'bool'" class="chip-row">
                  <view :class="['sheet-chip', { active: !!genParams[f.key], locked: isFieldLocked(f.key) }]" @click="!isFieldLocked(f.key) && setGenParam(f.key, !genParams[f.key])">
                    <text class="chip-t">{{ genParams[f.key] ? '开' : '关' }}</text>
                  </view>
                </view>
                <input v-else-if="f.type === 'number'" class="adv-input" type="number" :value="genParams[f.key]" :disabled="isFieldLocked(f.key)" @input="setGenParam(f.key, $event.detail.value)" />
              </view>

              <view v-if="schemaAdvancedFields.length" class="sheet-sec advanced-sec">
                <view class="advanced-toggle" @click="showAdvancedParams = !showAdvancedParams">
                  <view class="adv-left">
                    <text class="adv-icon">⚙️</text>
                    <text class="sec-label adv-title">高级参数</text>
                  </view>
                  <text class="adv-arrow">{{ showAdvancedParams ? '收起 ▴' : '展开 ▾' }}</text>
                </view>
                <view v-if="showAdvancedParams" class="advanced-body">
                  <view v-for="f in schemaAdvancedFields" :key="'adv-' + f.key" class="adv-field">
                    <text class="adv-field-label">{{ f.label }}</text>
                    <view v-if="f.type === 'enum'" class="chip-row">
                      <view
                        v-for="opt in f.options"
                        :key="String(opt)"
                        :class="['sheet-chip', { active: genParams[f.key] === opt }]"
                        @click="setGenParam(f.key, opt)"
                      >
                        <text class="chip-t">{{ optionLabel(f, opt) }}</text>
                      </view>
                    </view>
                    <view v-else-if="f.type === 'bool'" class="chip-row">
                      <view :class="['sheet-chip', { active: !!genParams[f.key] }]" @click="setGenParam(f.key, !genParams[f.key])">
                        <text class="chip-t">{{ genParams[f.key] ? '开' : '关' }}</text>
                      </view>
                    </view>
                    <input v-else-if="f.type === 'text'" class="adv-input" type="text" :value="genParams[f.key] || ''" @input="setGenParam(f.key, $event.detail.value)" />
                    <input v-else class="adv-input" type="number" :value="genParams[f.key]" @input="setGenParam(f.key, $event.detail.value)" />
                  </view>
                </view>
              </view>

              <view class="sheet-pad" />
            </scroll-view>
          </view>
        </view>

      </view>
    </view>

    <!-- 左抽屉：豆包式竖向置顶结构 -->
    <view v-if="drawerOpen" class="drawer-mask" @click="drawerOpen = false">
      <view class="drawer" @click.stop>
        <view class="drawer-safe" :style="{ height: statusBarHeight + 'px' }" />

        <view class="drawer-sec quick-sec">
          <view class="drawer-sec-head">
            <text class="drawer-sec-title">快捷操作</text>
          </view>
          <view v-for="g in quickGroups" :key="g.id" class="quick-group">
            <view class="quick-cat-row" @click="toggleQuickGroup(g)">
              <view class="quick-ico-box" :style="{ background: g.tint }">
                <text class="quick-ico">{{ g.icon }}</text>
              </view>
              <view class="quick-text">
                <text class="quick-name">{{ g.title }}</text>
                <text class="quick-sub">{{ g.hint }}</text>
              </view>
              <text class="quick-arrow">{{ expandedQuickId === g.id ? '▴' : '›' }}</text>
            </view>
            <view v-if="expandedQuickId === g.id" class="quick-list">
              <view v-if="g.comingSoon" class="quick-coming">
                <text class="quick-coming-t">即将开放，后续可在此选择具体方式</text>
              </view>
              <view
                v-for="q in g.items"
                :key="q.id"
                class="quick-row-v nested"
                @click="launchQuick(q)"
              >
                <view class="quick-ico-box sm" :style="{ background: q.tint }">
                  <text class="quick-ico">{{ q.icon }}</text>
                </view>
                <view class="quick-text">
                  <text class="quick-name">{{ q.label }}</text>
                  <text class="quick-sub">{{ q.sub }}</text>
                </view>
                <text class="quick-arrow">›</text>
              </view>
            </view>
          </view>
        </view>

        <view class="drawer-divider" />

        <!-- 历史对话按时间优雅分组，且清洗过滤空壳会话 -->
        <view class="drawer-sec grow">
          <view class="drawer-sec-head">
            <view class="type-filter-trigger" @click="showSessionTypeMenu = !showSessionTypeMenu">
              <text class="type-filter-t">{{ sessionFilterLabel }}</text>
              <text class="type-filter-arrow">{{ showSessionTypeMenu ? '▴' : '▾' }}</text>
            </view>
            <view class="new-session" @click="newSession()">
              <text class="new-t">+ 新建</text>
            </view>
          </view>
          <view v-if="showSessionTypeMenu" class="type-menu">
            <view
              v-for="f in sessionFilters"
              :key="f.id"
              :class="['type-menu-item', { active: sessionFilter === f.id }]"
              @click="selectSessionFilter(f.id)"
            >
              <text class="type-menu-t">{{ f.label }}</text>
              <text v-if="sessionFilter === f.id" class="type-menu-check">✓</text>
            </view>
          </view>
          <scroll-view scroll-y class="session-scroll">
            <view v-if="!sessionGroups.length" class="session-empty">
              <text class="session-empty-t">暂无历史会话</text>
              <text class="session-empty-s">发送一条消息后会自动保存</text>
            </view>
            <view
              v-for="group in sessionGroups"
              :key="group.label"
              class="session-group-block"
            >
              <text class="group-header-label">{{ group.label }}</text>
              <view
                v-for="s in group.list"
                :key="s.sessionId"
                :class="['session-row', 'session-row-' + (s.type || 'chat'), { active: s.sessionId === currentSessionId }]"
                @click="openSession(s)"
              >
                <view class="session-icon-wrap" :style="{ background: typeTint(s.type) }">
                  <text class="session-icon">{{ typeIcon(s.type) }}</text>
                </view>
                <view class="session-main">
                  <text class="session-title">{{ s.title || defaultTitle(s) }}</text>
                  <text class="session-meta">{{ typeLabel(s.type) }} · {{ formatTime(s.updatedAt) }}</text>
                </view>
                <text class="session-del" @click.stop="confirmDeleteSession(s)">✕</text>
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 抽屉底部个人设置 -->
        <view class="drawer-footer" @click="openSettings">
          <view class="user-avatar">
            <text class="user-initial">{{ userInitial }}</text>
          </view>
          <view class="user-meta-col">
            <text class="user-name">{{ userName || '未登录' }}</text>
            <text class="user-sub">个人设置</text>
          </view>
          <text class="user-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- 快捷操作直达选图高视野弹层（88vh 多维筛选与素材库直通） -->
    <view v-if="quickPickerOpen" class="quick-picker-mask" @click="quickPickerOpen = false">
      <view class="quick-picker-sheet" @click.stop>
        <view class="picker-head">
          <view class="picker-head-left">
            <text class="picker-title">选择底图进行【{{ currentQuickItem ? currentQuickItem.label : '精修' }}】</text>
            <text class="picker-subtitle">从素材库即选即用，或通过本地相册直接拍摄导入</text>
          </view>
          <text class="picker-close" @click="quickPickerOpen = false">✕</text>
        </view>

        <!-- 顶部快捷导入条（相册/拍照） -->
        <view class="picker-actions-row">
          <view class="picker-btn album" @click="pickImageFromLocal('album')">
            <text class="p-btn-icon">🖼️</text>
            <text class="p-btn-text">手机相册选图</text>
          </view>
          <view class="picker-btn camera" @click="pickImageFromLocal('camera')">
            <text class="p-btn-icon">📷</text>
            <text class="p-btn-text">拍照拍摄导入</text>
          </view>
        </view>

        <!-- 素材库搜索与多维分类胶囊栏 -->
        <view class="picker-search-bar">
          <view class="p-search-box">
            <text class="p-search-icon">⌕</text>
            <input
              class="p-search-input"
              v-model="pickerSearchKeyword"
              placeholder="搜索空间、风格、材质或文件名…"
              confirm-type="search"
              @confirm="() => loadRecentLibraryImages(pickerActiveCategory, pickerSearchKeyword)"
            />
            <text v-if="pickerSearchKeyword" class="p-search-clear" @click="clearPickerSearch">✕</text>
          </view>
        </view>

        <!-- 分类快速切换胶囊条 -->
        <view class="picker-category-row">
          <view
            v-for="cat in pickerCategories"
            :key="cat.id"
            :class="['p-cat-chip', { active: pickerActiveCategory === cat.id }]"
            @click="switchPickerCategory(cat.id)"
          >
            <text class="p-cat-t">{{ cat.label }}</text>
          </view>
          <view class="picker-reload-pill" @click="() => loadRecentLibraryImages(pickerActiveCategory, pickerSearchKeyword)">
            <text class="p-reload-icon" :class="{ spinning: loadingRecentImages }">↻</text>
          </view>
        </view>

        <!-- 素材大图网格与瀑布流 -->
        <scroll-view scroll-y class="picker-images-scroll" :lower-threshold="150" @scrolltolower="onPickerScrollToLower">
          <view v-if="loadingRecentImages && !recentLibraryImages.length" class="picker-loading-box">
            <view class="loading-spinner" />
            <text class="p-empty-t">正在读取素材库图片资产…</text>
          </view>
          <view v-else-if="!recentLibraryImages.length" class="picker-empty">
            <text class="p-empty-ico">📂</text>
            <text class="p-empty-t">暂无匹配的图片素材</text>
            <text class="p-empty-sub">可尝试切换分类、清空关键词，或从上方相册直接导入</text>
          </view>
          <view v-else class="picker-grid">
            <view
              v-for="item in recentLibraryImages"
              :key="item.fid"
              class="picker-card"
              @click="confirmQuickWithAsset(item)"
            >
              <view class="picker-img-wrapper">
                <image :src="item.imgUrl" class="picker-thumb" mode="aspectFill" :lazy-load="true" />
                <text v-if="item.category" class="picker-cat-tag">{{ item.category }}</text>
              </view>
              <view class="picker-card-info">
                <text class="picker-card-name">{{ item.fileName }}</text>
                <text v-if="item.tagsText" class="picker-card-tag">{{ item.tagsText }}</text>
              </view>
            </view>
          </view>
          <view class="picker-scroll-pad" />
        </scroll-view>
      </view>
    </view>


    <!-- 3/4 屏提示词查看与编辑抽屉面板 -->
    <view v-if="promptDrawerOpen" class="prompt-drawer-mask" @click="promptDrawerOpen = false">
      <view class="prompt-drawer-sheet" @click.stop>
        <view class="prompt-drawer-head">
          <view class="prompt-drawer-title-col">
            <text class="prompt-drawer-title">完整提示词编辑与全屏查看</text>
            <text class="prompt-drawer-count">{{ (inputPrompt || '').length }} 字符</text>
          </view>
          <view class="prompt-drawer-actions">
            <view
              v-if="!isTextOnlyMode && slotImages.length"
              class="drawer-act-pill at-btn"
              @click="toggleAtPicker"
            >
              <text class="drawer-act-t">@ 素材</text>
            </view>
            <view class="drawer-act-pill" @click="copyInputPrompt">
              <text class="drawer-act-t">复制内容</text>
            </view>
            <view class="drawer-act-pill done" @click="promptDrawerOpen = false">
              <text class="drawer-act-t done">完成</text>
            </view>
          </view>
        </view>

        <!-- 抽屉内的 @ 浮动选择面板 -->
        <view v-if="showAtPicker && !isTextOnlyMode && slotImages.length" class="at-suggest-popup in-drawer">
          <view class="at-suggest-head">
            <text class="at-suggest-title">选择要插入的素材：</text>
            <text class="at-suggest-close" @click="showAtPicker = false">✕</text>
          </view>
          <view class="at-suggest-list">
            <view
              v-for="(img, sIdx) in slotImages"
              :key="'drawer_at_' + sIdx"
              class="at-suggest-item"
              @click="completeAtReference(sIdx)"
            >
              <image :src="img" class="at-suggest-thumb" mode="aspectFill" />
              <text class="at-suggest-name">@{{ getSlotTagLabel(sIdx) }}</text>
            </view>
          </view>
        </view>

        <!-- 抽屉内的行内图文混排呈现卡片 -->
        <view v-if="hasPromptReferences" class="drawer-flow-card">
          <view class="drawer-flow-header">
            <text class="drawer-flow-title">行内图文混排呈现：</text>
            <text class="drawer-flow-tip">（点击缩略图全屏放大，点击✕删除）</text>
          </view>
          <view class="composer-inline-flow drawer-flow-body">
            <template v-for="(seg, sI) in currentPromptSegments" :key="'df_' + sI">
              <text v-if="seg.type === 'text'" class="flow-text">{{ seg.value }}</text>
              <view v-else class="inline-ref-chip flow-chip" @click.stop>
                <image
                  v-if="seg.img"
                  :src="seg.img"
                  class="inline-ref-thumb clickable"
                  mode="aspectFill"
                  @click.stop="previewMedia(seg.img)"
                />
                <text class="inline-ref-label">@{{ seg.label }}</text>
                <text class="inline-ref-x" @click.stop="removeRefFromPrompt(seg.tag)">✕</text>
              </view>
            </template>
          </view>
        </view>

        <scroll-view scroll-y class="prompt-drawer-scroll">
          <textarea
            v-model="inputPrompt"
            class="prompt-drawer-textarea"
            placeholder="在宽阔视野中编辑提示词，支持输入 @ 关联素材…"
            :maxlength="4000"
            :show-confirm-bar="false"
            @input="onPromptInput"
          />
        </scroll-view>
      </view>
    </view>

    <ai-task-pill />
  </view>
</template>

<script>
import {
  fetchLabCapabilities,
  submitLabRun,
  pollLabRun,
  fetchChatSessions,
  createChatSession,
  deleteChatSession,
  fetchChatMessages,
  saveChatMessage,
  clearChatMessages,
  uploadRefImages,
  optimizePrompt,
  sessionValid,
  fetchAssets,
  mediaUrl,
  fetchPortraitLibrary,
  acceptPortraitConsent,
  createPortraitGroup,
  deletePortraitAsset,
  deletePortraitGroup,
  uploadPortraitAsset,
} from '../../service/ViewerApi'
import { store } from '../../service/SyncStateStore'
import HomeLibrary from '../../components/HomeLibrary.vue'
import AiTaskPill from '../../components/AiTaskPill.vue'
import MODEL_CATALOG, { assertAgnesFreeTier, mergeStudioCatalog } from '../../service/ModelCatalog'
import { convertAtRefs, refStyleFor } from '../../service/PromptStudio'
import { schemaFor, optionLabel, slotLimit, applyConstraints } from '../../service/ModelSchemas'

function goLogin() {
  uni.reLaunch({
    url: '/pages/login/login?tip=' + encodeURIComponent('请先登录服务器'),
  })
}

function mediaKindOf(mode) {
  const m = String(mode || '')
  if (m === 'text_to_song' || m === 'text_to_bgm' || m.indexOf('music') >= 0) return 'audio'
  if (m.indexOf('video') >= 0 || m === 'first_last_frame') return 'video'
  return 'image'
}

function absMediaUrl(file, result) {
  const rel = (file && file.previewUrl) || (result && result.previewUrl) || ''
  if (!rel) return (result && result.url) || ''
  if (/^https?:\/\//i.test(rel)) return rel
  return store.getServerUrl() + rel
}

export default {
  components: { HomeLibrary, AiTaskPill },
  data() {
    return {
      statusBarHeight: 20,
      mainView: 'library',
      drawerOpen: false,

      // 工作台状态（图 6~10 千问模式）
      inStudioDesk: false,
      showDomainDropdown: false,
      paramSheetOpen: false,
      quickPickerOpen: false,
      currentQuickItem: null,
      recentLibraryImages: [],
      loadingRecentImages: false,
      pickerActiveCategory: 'all',
      pickerSearchKeyword: '',
      pickerPage: 1,
      pickerHasMore: true,
      pickerCategories: [
        { id: 'all', label: '全部' },
        { id: 'space', label: '场景空间' },
        { id: 'furniture', label: '家具单品' },
        { id: 'portrait', label: '人物模特' },
      ],
      // 高级超参数控制
      showAdvancedParams: false,
      genParams: {},
      advancedParams: {
        cfgScale: 7.0,
        steps: 25,
        seed: -1,
        negativePrompt: '',
        thinking: 'minimal',
      },
      currentDeskRun: null,

      // 操作域
      domain: 'chat',
      domains: [
        { id: 'chat', label: '对话', icon: '💬', tint: '#64748B', soft: '#F1F5F9' },
        { id: 'image', label: '生图', icon: '🖼️', tint: '#2563EB', soft: '#EFF6FF' },
        { id: 'video', label: '生视频', icon: '🎬', tint: '#7C3AED', soft: '#F5F3FF' },
        { id: 'music', label: '生音乐', icon: '🎵', tint: '#0D9488', soft: '#F0FDFA' },
        { id: 'portrait', label: '生人像', icon: '👤', tint: '#DB2777', soft: '#FDF2F8' },
      ],
      sessionFilter: 'all',
      showSessionTypeMenu: false,
      sessionFilters: [
        { id: 'all', label: '全部类型' },
        { id: 'chat', label: '对话' },
        { id: 'image', label: '生图' },
        { id: 'video', label: '生视频' },
        { id: 'music', label: '生音乐' },
        { id: 'portrait', label: '生人像' },
      ],

      sessions: [],
      currentSessionId: '',
      _sessionPersisted: false,
      _sessionInited: false,
      chatList: [],
      scrollIntoId: '',
      inputPrompt: '',
      sending: false,
      expanded: false,

      // 生成模态（域内）——默认对齐千问/豆包：图=图生图，视频=全能参考
      imageMode: 'image_to_image',
      videoMode: 'omni_reference',
      musicMode: 'text_to_bgm',
      portraitMode: 'text_to_portrait',
      portraitLibraryGroups: [],
      portraitConsented: false,
      portraitGroupName: '',
      selectedPortraitAssets: [],
      songInputKind: 'prompt',

      slotImages: [],
      promptDrawerOpen: false,
      lastSentPrompt: '',
      selectedRatio: '9:16',
      selectedDuration: 5,
      selectedClarity: 'hd',
      selectedMood: 'calm',
      ratios: ['9:16', '16:9', '3:4', '1:1'],
      clarities: [
        { value: 'sd', label: '标清' },
        { value: 'hd', label: '高清' },
      ],
      moods: [
        { value: 'calm', label: '治愈' },
        { value: 'upbeat', label: '明快' },
        { value: 'epic', label: '史诗' },
        { value: 'warm', label: '温暖' },
        { value: 'dark', label: '暗调' },
      ],

      capabilities: null,
      studioCatalog: null,
      currentChatModelId: 'agnes-2.5-flash',
      currentImageModelId: '',
      currentVideoModelId: '',
      currentMusicModelId: '',
      currentPortraitModelId: '',

      chatPresets: [
        '帮我看看适合做封面的素材该怎么选',
        '如何用四点定位给客厅换一款沙发',
        '给这套空间写一段短视频分镜',
      ],
      imagePresets: [
        '现代轻奢极简客厅，全景落地窗，柔和自然采光',
        '法式奶油风主卧，弧形吊顶与隐形灯带',
        '日式侘寂茶室，微水泥墙面，庭院竹影',
      ],
      videoPresets: [
        '镜头缓慢向前推进，光影自然位移，晨间微尘丁达尔效应',
        '环绕空间漫游，从玄关到客厅一镜到底',
      ],
      musicPresets: [
        '安静的室内空间背景配乐，钢琴与轻微弦乐',
        '轻快明亮的产品展示配乐',
      ],
      portraitPresets: [
        '自然光下的空间人像，坐姿，看向窗外',
        '商务精英站在落地窗前，侧光轮廓',
      ],

      expandedQuickId: '',
      quickGroups: [
        {
          id: 'video',
          title: '视频制作',
          icon: '🎬',
          tint: '#F5F3FF',
          hint: '点选后选择成片方式',
          items: [
            { id: 'roam', label: '室内空间漫游', sub: '一镜到底空间成片', icon: '🎬', mode: 'roam', tint: '#F5F3FF' },
          ],
        },
        {
          id: 'image',
          title: '图片处理',
          icon: '🖼️',
          tint: '#EFF6FF',
          hint: '点选后选择精修方式',
          items: [
            { id: 'expand', label: '扩图', sub: '向外延展画幅', icon: '📐', mode: 'expand', tint: '#EFF6FF' },
            { id: 'watermark', label: '去水印', sub: '先选区再擦除水印', icon: '✨', mode: 'watermark', tint: '#FDF4FF' },
            { id: 'enhance', label: '清晰度', sub: '本地 4 倍或云端重绘', icon: '🔍', mode: 'enhance', tint: '#ECFEFF' },
            { id: 'insert', label: '精准操作 · 增', sub: '软装置入', icon: '🛋️', mode: 'insert', tint: '#ECFDF5' },
            { id: 'remove', label: '精准操作 · 删', sub: '消除瑕疵', icon: '🧹', mode: 'remove', tint: '#FEF2F2' },
            { id: 'replace', label: '精准操作 · 改', sub: '原位替换', icon: '🔄', mode: 'replace', tint: '#F5F3FF' },
          ],
        },
        {
          id: 'music',
          title: '音乐制作',
          icon: '🎵',
          tint: '#F0FDFA',
          hint: '点选后选择生成方式',
          items: [
            { id: 'music_song', label: '文生歌曲', sub: '豆包歌曲 v5', icon: '🎤', desk: 'music', mode: 'text_to_song', tint: '#F0FDFA' },
            { id: 'music_bgm', label: '文生纯音乐', sub: '豆包纯音乐 v5', icon: '🎵', desk: 'music', mode: 'text_to_bgm', tint: '#ECFDF5' },
          ],
        },
        {
          id: 'portrait',
          title: '人像制作',
          icon: '👤',
          tint: '#FDF2F8',
          hint: '点选后选择生成方式',
          items: [
            { id: 'portrait_text', label: '文生人像', sub: '描述人物生成人像', icon: '👤', desk: 'portrait', mode: 'text_to_portrait', tint: '#FDF2F8' },
            { id: 'portrait_img', label: '图生人像', sub: '参考图生成人像', icon: '🖼️', desk: 'portrait', mode: 'image_to_portrait', tint: '#FCE7F3' },
            { id: 'portrait_lib', label: '虚拟人像库', sub: '入库后给 Seedance 做参考', icon: '🗂️', desk: 'portrait', mode: 'virtual_library', tint: '#FDF2F8' },
          ],
        },
      ],
      quickActions: [],
      pendingQuickMode: '',
      showAtPicker: false,
      isEditingPrompt: false,
      promptCursorPos: 0,
      promptBeforeOptimize: '',
      optimizingPrompt: false,
    }
  },
  computed: {
    userName() {
      return store.getUsername ? store.getUsername() : ''
    },
    userInitial() {
      const n = this.userName || 'U'
      return n.slice(0, 1).toUpperCase()
    },
    welcomeTitle() {
      const map = {
        chat: '有什么我能帮你的？',
        image: '图片生成',
        video: '视频生成',
        music: '音乐生成',
        portrait: '人像生成',
      }
      return map[this.domain] || 'AI 工坊'
    },
    welcomeDesc() {
      const map = {
        chat: '通用助手：素材整理建议、创作灵感。选上方生成域可直接出图/出片。',
        image: '描述空间与光影生成效果图，支持图生图与参考合成。',
        video: '描述镜头运动生成漫游视频，支持图生视频与首尾帧。',
        music: '文生歌曲或文生纯音乐。歌曲可以写提示词，也可以直接给歌词。',
        portrait: '文生人像、图生人像，以及私域虚拟人像库。生成的人像不会自动入库。',
      }
      return map[this.domain] || ''
    },
    domainPresets() {
      if (this.domain === 'image') return this.imagePresets
      if (this.domain === 'video') return this.videoPresets
      if (this.domain === 'music') return this.musicPresets
      if (this.domain === 'portrait') return this.portraitPresets
      return this.chatPresets
    },
    currentSchema() {
      return schemaFor(this.currentModelInfo) || null
    },
    schemaCommonFields() {
      return (this.currentSchema && this.currentSchema.common) || []
    },
    schemaAdvancedFields() {
      return (this.currentSchema && this.currentSchema.advanced) || []
    },
    slotMaxImages() {
      const n = slotLimit(this.currentSchema, 'images')
      return n > 0 ? n : 5
    },
    fieldLocks() {
      const r = applyConstraints(this.currentSchema, this.currentMode, this.genParams)
      return r.lock || []
    },
    domainSubModes() {
      if (this.domain === 'music') {
        return [
          { id: 'text_to_song', label: '文生歌曲' },
          { id: 'text_to_bgm', label: '文生纯音乐' },
        ]
      }
      let modes = []
      if (this.currentSchema && this.currentSchema.modes && this.currentSchema.modes.length) {
        modes = this.currentSchema.modes.slice()
      } else {
        const map = {
          image: [
            { id: 'image_to_image', label: '图生图' },
            { id: 'text_to_image', label: '文生图' },
          ],
          video: [
            { id: 'text_to_video', label: '文生视频' },
            { id: 'image_to_video', label: '图生视频' },
          ],
          portrait: [
            { id: 'text_to_portrait', label: '文生人像' },
            { id: 'image_to_portrait', label: '图生人像' },
          ],
        }
        modes = map[this.domain] || []
      }
      if (this.domain === 'portrait' && !modes.some((m) => m.id === 'virtual_library')) {
        modes = modes.concat([{ id: 'virtual_library', label: '虚拟人像库' }])
      }
      return modes
    },
    deskTitle() {
      const map = {
        video: 'AI 生视频',
        image: 'AI 生图',
        music: 'AI 生音乐',
        portrait: 'AI 生人像',
      }
      return map[this.domain] || 'AI 创作'
    },
    deskModes() {
      return [
        { id: 'video', label: 'AI 生视频', icon: '🎬' },
        { id: 'image', label: 'AI 生图', icon: '🖼️' },
        { id: 'music', label: 'AI 生音乐', icon: '🎵' },
        { id: 'portrait', label: 'AI 生人像', icon: '👤' },
      ]
    },
    currentModeLabel() {
      const hit = this.domainSubModes.find((m) => m.id === this.currentMode)
      return hit ? hit.label : (this.domain === 'video' ? '全能参考' : '默认模式')
    },
    isTextOnlyMode() {
      const m = this.currentMode
      return (
        m === 'text_to_portrait' ||
        m === 'text_to_image' ||
        m === 'text_to_video' ||
        m === 'text_to_music' ||
        m === 'text_to_song' ||
        m === 'text_to_bgm'
      )
    },
    isLibraryMode() {
      return this.domain === 'portrait' && this.portraitMode === 'virtual_library'
    },
    activePortraitAssets() {
      const out = []
      ;(this.portraitLibraryGroups || []).forEach((g) => {
        ;(g.assets || []).forEach((a) => {
          if (a.status === 'Active') out.push({ ...a, groupName: g.name })
        })
      })
      return out
    },
    portraitCaption() {
      if (this.domain !== 'video' || !this.selectedPortraitAssets.length) return ''
      let n = 1
      const bits = []
      if (this.videoMode === 'image_to_video' || this.videoMode === 'first_last_frame') {
        bits.push(`图片${n}是首帧`)
        n += 1
      }
      this.selectedPortraitAssets.forEach((p) => {
        bits.push(`图片${n}是${p.groupName || p.name || '角色'}的形象`)
        n += 1
      })
      return `【图片说明】${bits.join('。')}。`
    },
    currentPromptSegments() {
      return this.promptSegments(this.inputPrompt, this.slotImages)
    },
    hasPromptReferences() {
      return this.currentPromptSegments.some((s) => s.type === 'ref')
    },
    referencedTags() {
      if (!this.inputPrompt || !this.slotImages || !this.slotImages.length) return []
      const list = []
      this.slotImages.forEach((img, idx) => {
        const label = this.getSlotTagLabel(idx)
        const tag = `@${label}`
        if (this.inputPrompt.indexOf(tag) >= 0) {
          list.push({ idx, label, tag, img })
        }
      })
      return list
    },
    deskRunProgressText() {
      const run = this.currentDeskRun
      const name = (this.currentModelInfo && this.currentModelInfo.name) || '模型'
      if (!run) return ''
      const p = Number(run.progress || 0)
      if (run.status === 'running' && p <= 10) return `生成中 · 模型 ${name}`
      return `已完成 ${p}% · 模型 ${name}`
    },
    deskPlaceholder() {
      if (this.isTextOnlyMode) {
        if (this.domain === 'portrait') return '描述人物长相、着装、姿态、表情与光影氛围…'
        if (this.domain === 'video') return '描述视频运镜、主体动作、场景变幻与光影位移…'
        if (this.domain === 'music' && this.musicMode === 'text_to_song' && this.songInputKind === 'lyrics') {
          return '写歌词。可用 [verse] [chorus] 分段。和提示词二选一。'
        }
        if (this.domain === 'music' && this.musicMode === 'text_to_song') return '用中文、英文或粤语描述想要的歌曲…'
        if (this.domain === 'music') return '用中文描述纯音乐的场景、乐器和情绪…'
        return '描述画面构图、主体、色彩与风格质感…'
      }
      if (this.slotImages.length) {
        return '点击上方引用素材，如：使用 @图片1 的人物，保持空间光影推进…'
      }
      return '添加图片、视频、音频或描述你想生成的画面…'
    },
    activeQuickPrompts() {
      if (!this.slotImages || !this.slotImages.length) return []
      const list = []
      const len = this.slotImages.length
      const isVideo = this.domain === 'video'
      const tag1 = '@' + this.getSlotTagLabel(0)

      if (isVideo) {
        list.push({ text: `使用 ${tag1} 人物主体`, template: `使用 ${tag1} 的人物主体，保持外貌与动作连贯，` })
        list.push({ text: `保持 ${tag1} 空间光影`, template: `保持 ${tag1} 的空间光影与构图，镜头向前缓慢推进，` })
        list.push({ text: `以 ${tag1} 为起始帧推进`, template: `以 ${tag1} 为镜头起点，由远及近平滑推镜，` })
        list.push({ text: `让 ${tag1} 画面微风动感`, template: `让 ${tag1} 中的主体自然活动，微风吹拂，光影位移，` })
      } else {
        list.push({ text: `使用 ${tag1} 人物主体`, template: `使用 ${tag1} 的人物主体与面部特征，置于新场景中，` })
        list.push({ text: `保持 ${tag1} 风格与色调`, template: `保持 ${tag1} 的艺术质感与冷暖色调风格，` })
        list.push({ text: `参考 ${tag1} 构图布局`, template: `参考 ${tag1} 的空间比例与景深构图，` })
      }

      if (len >= 2) {
        const tag2 = '@' + this.getSlotTagLabel(1)
        list.unshift({
          text: `融合 ${tag1} 场景 + ${tag2} 主体`,
          template: `将 ${tag2} 的主体置入 ${tag1} 的空间场景中，统一光影色调，`,
        })
        if (isVideo) {
          list.push({
            text: `从 ${tag1} 转场到 ${tag2}`,
            template: `镜头由 ${tag1} 顺畅运镜过渡到 ${tag2}，光影自然位移，`,
          })
        }
      }

      return list
    },
    meaningfulSessions() {
      return (this.sessions || []).filter((s) => {
        if (!s || !s.sessionId) return false
        if (s._draft) return false
        const title = (s.title || '').trim()
        const preview = (s.preview || '').trim()
        if (!preview && (!title || title === '有什么我能帮你的？' || title === 'AI 工坊' || title === '你好')) {
          return false
        }
        if (this.sessionFilter !== 'all' && s.type !== this.sessionFilter) {
          return false
        }
        return true
      })
    },
    sessionGroups() {
      const list = this.meaningfulSessions
      const now = new Date()
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const startYest = startToday - 86400000
      const today = []
      const yesterday = []
      const earlier = []
      list.forEach((s) => {
        const time = s.updatedAt || 0
        if (time >= startToday) today.push(s)
        else if (time >= startYest) yesterday.push(s)
        else earlier.push(s)
      })
      const groups = []
      if (today.length) groups.push({ label: '今天', list: today })
      if (yesterday.length) groups.push({ label: '昨天', list: yesterday })
      if (earlier.length) groups.push({ label: '更早', list: earlier })
      return groups
    },
    filteredSessions() {
      return this.meaningfulSessions
    },
    sessionFilterLabel() {
      const hit = this.sessionFilters.find((f) => f.id === this.sessionFilter)
      return hit ? hit.label : '全部类型'
    },
    currentDomainInfo() {
      return this.domains.find((d) => d.id === this.domain) || this.domains[0]
    },
    domainSoftBg() {
      return this.currentDomainInfo.soft || '#F8FAFC'
    },
    isGenDomain() {
      return this.domain !== 'chat'
    },
    hasGenParams() {
      return this.isGenDomain
    },
    showModel() {
      return true
    },
    showClarity() {
      return false
    },
    showRatio() {
      return false
    },
    showDuration() {
      return false
    },
    showMood() {
      return false
    },
    domainModels() {
      const cat = this.studioCatalog || {}
      if (this.domain === 'video') {
        const models = cat.video?.models || []
        if (this.selectedPortraitAssets.length) {
          return models.filter((m) => /seedance/i.test(`${m.id} ${m.model_code || ''} ${m.name || ''}`))
        }
        return models
      }
      if (this.domain === 'music') {
        return (cat.music?.models || []).filter((m) => m.id === 'doubao_song_v5' || m.id === 'doubao_bgm_v5')
      }
      if (this.domain === 'portrait') return cat.portrait?.models || []
      if (this.domain === 'image') return cat.image?.models || []
      return cat.chat?.models || []
    },
    currentModelId() {
      if (this.domain === 'video') return this.currentVideoModelId
      if (this.domain === 'music') return this.currentMusicModelId
      if (this.domain === 'portrait') return this.currentPortraitModelId
      if (this.domain === 'image') return this.currentImageModelId
      return this.currentChatModelId
    },
    currentModelInfo() {
      const hit = this.domainModels.find((m) => m.id === this.currentModelId)
      if (hit) return hit
      return this.domainModels[0] || { id: this.currentModelId || '', name: '默认', providerName: '-' }
    },
    availableDurations() {
      if (this.currentModelInfo && this.currentModelInfo.durations) {
        return this.currentModelInfo.durations
      }
      if (this.domain === 'music') return [15, 30, 60]
      return [5, 8, 10]
    },
    currentMode() {
      if (this.domain === 'video') return this.videoMode
      if (this.domain === 'music') return this.musicMode
      if (this.domain === 'portrait') return this.portraitMode
      if (this.domain === 'image') return this.imageMode
      return 'chat'
    },
    requiresSlots() {
      const m = this.currentMode
      return (
        m === 'image_to_image' ||
        m === 'image_to_video' ||
        m === 'first_last_frame' ||
        m === 'video_to_music' ||
        m === 'image_to_portrait' ||
        m === 'omni_reference' ||
        m === 'image_reference'
      )
    },
    isMultiSlot() {
      const m = this.currentMode
      return m === 'omni_reference' || m === 'image_reference'
    },
    slotHint() {
      if (this.currentMode === 'video_to_music') return '选视频'
      if (this.currentMode === 'image_to_video') return '首帧'
      return '参考图'
    },
    inputPlaceholder() {
      const map = {
        chat: '发消息，或输入创作想法…',
        image: '描述你想要生成的图片…',
        video: '描述你想要创作的视频…',
        music: '描述你想要的配乐氛围…',
        portrait: '描述你想要的人像…',
      }
      return map[this.domain] || '描述…'
    },
    canSend() {
      if (this.isLibraryMode) return false
      if (!this.inputPrompt || !this.inputPrompt.trim()) {
        if (this.domain === 'video' && this.selectedPortraitAssets.length && this.videoMode === 'text_to_video') return true
        // 全能参考允许仅传图发送（对齐豆包：有素材即可生成）
        if (this.isMultiSlot && this.slotImages.length) return true
        if (this.domain === 'chat' && this.slotImages.length) return true
        return false
      }
      if (this.currentMode === 'first_last_frame') {
        return Boolean(this.slotImages[0] && this.slotImages[1])
      }
      if (
        this.currentMode === 'image_to_image' ||
        this.currentMode === 'image_to_video' ||
        this.currentMode === 'image_to_portrait'
      ) {
        return Boolean(this.slotImages[0])
      }
      if (this.currentMode === 'video_to_music') {
        return Boolean(this.slotImages[0])
      }
      if (this.isMultiSlot) return this.slotImages.length > 0
      return true
    },
    collapseSummary() {
      const parts = [this.currentModelInfo.name || '模型']
      if (this.showRatio) parts.push(this.selectedRatio)
      if (this.showDuration) parts.push(this.selectedDuration + 's')
      if (this.showClarity) parts.push(this.selectedClarity === 'hd' ? '高清' : '标清')
      if (this.showMood) {
        const m = this.moods.find((x) => x.value === this.selectedMood)
        parts.push(m ? m.label : this.selectedMood)
      }
      return parts.join(' · ')
    },
    domainModelsGrouped() {
      const list = this.domainModels || []
      const groups = [
        { name: '火山方舟 (ByteDance)', provider: '火山方舟', icon: '🌋', items: [] },
        { name: 'Agnes AI', provider: 'Agnes AI', icon: '⚡', items: [] },
        { name: 'Google (Gemini / Veo / Gemma)', provider: 'Google', icon: '🌐', items: [] },
      ]
      list.forEach((m) => {
        const p = m.providerName || ''
        const g = groups.find((grp) => p === grp.provider || p.includes(grp.provider))
        if (g) g.items.push(m)
        else {
          let other = groups.find((grp) => grp.provider === '其他')
          if (!other) {
            other = { name: '其他', provider: '其他', icon: '📦', items: [] }
            groups.push(other)
          }
          other.items.push(m)
        }
      })
      return groups.filter((g) => g.items.length > 0)
    },
  },
  onLoad(query) {
    const sys = uni.getSystemInfoSync()
    this.statusBarHeight = sys.statusBarHeight || 20
    if (!sessionValid()) {
      goLogin()
      return
    }
    const view = query && query.view
    if (view === 'operate') this.mainView = 'operate'
    const dom = query && query.domain
    if (dom && this.domains.some((d) => d.id === dom)) this.domain = dom

    this.loadCapabilities()
    this.initSessions()
  },
  onShow() {
    const pending = uni.getStorageSync('studio_pending_image')
    if (pending) {
      uni.removeStorageSync('studio_pending_image')
      this.mainView = 'operate'
      this.domain = 'video'
      this.videoMode = 'image_to_video'
      this.slotImages = [pending]
      this.expanded = false
    }
  },
  onUnload() {
    this.stopPortraitRefresh()
  },
  methods: {
    switchMain(v) {
      this.mainView = v
      if (v === 'operate') {
        this.loadCapabilities()
        this.loadChatHistory()
      }
    },
    openDrawer() {
      this.drawerOpen = true
      this.loadSessions()
    },
    openSettings() {
      this.drawerOpen = false
      uni.navigateTo({ url: '/pages/settings/settings' })
    },
    applyPreset(p) {
      this.inputPrompt = p
    },
    previewMedia(url) {
      if (!url) return
      uni.previewImage({ urls: [url] })
    },

    typeIcon(type) {
      const map = {
        chat: '💬',
        image: '🖼️',
        video: '🎬',
        music: '🎵',
        portrait: '👤',
        quick: '⚡',
      }
      return map[type] || '💬'
    },
    typeTint(type) {
      const map = {
        chat: '#F1F5F9',
        image: '#EFF6FF',
        video: '#F5F3FF',
        music: '#F0FDFA',
        portrait: '#FDF2F8',
      }
      return map[type] || '#F1F5F9'
    },
    selectSessionFilter(id) {
      this.sessionFilter = id
      this.showSessionTypeMenu = false
    },
    typeLabel(type) {
      const map = {
        chat: '对话',
        image: '生图',
        video: '生视频',
        music: '生音乐',
        portrait: '生人像',
        quick: '快捷',
      }
      return map[type] || '对话'
    },
    domainLabelOf(mode) {
      const m = String(mode || '')
      if (m.includes('video')) return '生视频'
      if (m.includes('music')) return '生音乐'
      if (m.includes('portrait')) return '生人像'
      if (m.includes('image')) return '生图'
      if (m === 'chat') return '对话'
      return '创作'
    },
    defaultTitle(s) {
      return this.typeLabel(s.type) + '会话'
    },
    formatTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const hh = String(d.getHours()).padStart(2, '0')
      const mi = String(d.getMinutes()).padStart(2, '0')
      return `${mm}-${dd} ${hh}:${mi}`
    },

    async loadCapabilities(showTip) {
      try {
        const data = await fetchLabCapabilities()
        this.capabilities = data
        this.studioCatalog = mergeStudioCatalog(data && data.studio, this.getDefaultStudioCatalog())
        this.applyDefaultModels()
        if (showTip) uni.showToast({ title: '能力已刷新', icon: 'none' })
      } catch (e) {
        this.studioCatalog = mergeStudioCatalog(null, this.getDefaultStudioCatalog())
        this.applyDefaultModels()
        if (showTip) uni.showToast({ title: '已就绪内置能力矩阵', icon: 'none' })
      }
    },
    getDefaultStudioCatalog() {
      return JSON.parse(JSON.stringify(MODEL_CATALOG))
    },
    applyDefaultModels() {
      const cat = this.studioCatalog || {}
      const pick = (list, currentSetter, currentId, defaultId) => {
        if (!list || !list.length) return
        if (currentId && list.some((m) => m.id === currentId)) return
        const hitDefault = defaultId ? list.find((m) => m.id === defaultId) : null
        const def = hitDefault || list.find((m) => m.default) || list[0]
        currentSetter(def.id)
      }
      pick(cat.image?.models, (id) => (this.currentImageModelId = id), this.currentImageModelId, cat.image?.defaultModel)
      pick(cat.video?.models, (id) => (this.currentVideoModelId = id), this.currentVideoModelId, cat.video?.defaultModel)
      pick(cat.music?.models, (id) => (this.currentMusicModelId = id), this.currentMusicModelId, cat.music?.defaultModel)
      pick(
        cat.portrait?.models,
        (id) => (this.currentPortraitModelId = id),
        this.currentPortraitModelId,
        cat.portrait?.defaultModel
      )
      pick(cat.chat?.models, (id) => (this.currentChatModelId = id), this.currentChatModelId, cat.chat?.defaultModel)
      this.applySchemaDefaults(this.currentModelInfo)
    },
    optionLabel,
    isFieldLocked(key) {
      return (this.fieldLocks || []).indexOf(key) >= 0
    },
    applyLiveConstraints() {
      const r = applyConstraints(this.currentSchema, this.currentMode, this.genParams)
      this.genParams = r.params
      if (r.params.duration != null) this.selectedDuration = r.params.duration
      if (r.params.ratio) this.selectedRatio = r.params.ratio
    },
    onRangeChange(f, ev) {
      const v = ev && ev.detail ? ev.detail.value : ev
      this.setGenParam(f.key, Number(v))
    },
    setGenParam(key, val) {
      if (this.isFieldLocked(key)) return
      this.$set ? this.$set(this.genParams, key, val) : (this.genParams = { ...this.genParams, [key]: val })
      if (key === 'duration') this.selectedDuration = val
      if (key === 'ratio') this.selectedRatio = val
      if (key === 'size' || key === 'resolution') this.selectedClarity = val
      this.applyLiveConstraints()
    },
    applySchemaDefaults(model) {
      const sch = schemaFor(model)
      const next = {}
      const fill = (f) => {
        if (!f) return
        next[f.key] = f.default
      }
      if (sch) {
        ;(sch.common || []).forEach(fill)
        ;(sch.advanced || []).forEach(fill)
        const modes = sch.modes || []
        if (modes.length) {
          const cur = this.currentMode
          if (!modes.some((x) => x.id === cur)) this.switchSubMode(modes[0].id)
        }
      }
      this.genParams = next
      if (next.duration != null) this.selectedDuration = next.duration
      if (next.ratio) this.selectedRatio = next.ratio
      if (next.size) this.selectedClarity = next.size
      else if (next.resolution) this.selectedClarity = next.resolution
      this.applyLiveConstraints()
    },
    selectDomainModel(m) {
      if (!m || !m.id) return
      if (this.domain === 'video') this.currentVideoModelId = m.id
      else if (this.domain === 'music') this.currentMusicModelId = m.id
      else if (this.domain === 'portrait') this.currentPortraitModelId = m.id
      else if (this.domain === 'image') this.currentImageModelId = m.id
      else this.currentChatModelId = m.id
      this.applySchemaDefaults(m)
      uni.showToast({ title: `已选: ${m.name}`, icon: 'none' })
    },

    switchDomain(id) {
      if (this.domain === id) return
      this.domain = id
      this.slotImages = []
      this.expanded = false
      // 默认模态：图=图生图（等选参考图），视频=全能参考；其余文生
      if (id === 'image') this.imageMode = 'image_to_image'
      if (id === 'video') this.videoMode = 'text_to_video'
      if (id === 'music') {
        this.musicMode = 'text_to_bgm'
        this.currentMusicModelId = 'doubao_bgm_v5'
      }
      if (id === 'portrait') this.portraitMode = 'text_to_portrait'
      if (id === 'video' || id === 'portrait') this.loadPortraitLibrary()
      this.$nextTick(() => this.applySchemaDefaults(this.currentModelInfo))
      this.sessionFilter = id
      this.bindSession(false)
      this.loadChatHistory()
    },
    switchSubMode(modeId) {
      if (this.domain === 'image') this.imageMode = modeId
      else if (this.domain === 'video') this.videoMode = modeId
      else if (this.domain === 'music') this.musicMode = modeId
      else if (this.domain === 'portrait') this.portraitMode = modeId
      const multi = modeId === 'omni_reference' || modeId === 'image_reference'
      const max = this.slotMaxImages
      if (modeId === 'first_last_frame') this.slotImages = this.slotImages.slice(0, Math.min(2, max))
      else if (multi) this.slotImages = this.slotImages.slice(0, max)
      else if (
        modeId === 'image_to_image' ||
        modeId === 'image_to_video' ||
        modeId === 'image_to_portrait' ||
        modeId === 'video_to_music'
      ) {
        this.slotImages = this.slotImages.slice(0, 1)
      } else {
        this.slotImages = []
      }
      this.applyLiveConstraints()
    },

    sessionTypeOfDomain() {
      return this.domain === 'chat' ? 'chat' : this.domain
    },
    bindSession(forceNew) {
      const type = this.sessionTypeOfDomain()
      if (
        !forceNew &&
        this.currentSessionId &&
        this.sessions.some((s) => s.sessionId === this.currentSessionId)
      ) {
        const cur = this.sessions.find((s) => s.sessionId === this.currentSessionId)
        if (cur && cur.type === type) return
      }
      if (!forceNew) {
        const existing = this.sessions.find((s) => s.type === type)
        if (existing) {
          this.currentSessionId = existing.sessionId
          return
        }
      }
      // 草稿会话：仅本地 id，首次真正发消息时才 POST 到服务端
      this.currentSessionId = `session_${type}_${Date.now()}`
      this.chatList = []
      this._sessionPersisted = false
    },
    persistCurrentSession(title) {
      if (this._sessionPersisted) {
        createChatSession({
          sessionId: this.currentSessionId,
          type: this.sessionTypeOfDomain(),
          title: title || '',
        }).catch(() => {})
        return
      }
      const meta = {
        sessionId: this.currentSessionId,
        type: this.sessionTypeOfDomain(),
        title: title || this.typeLabel(this.sessionTypeOfDomain()),
        updatedAt: Date.now(),
      }
      this._sessionPersisted = true
      const rest = this.sessions.filter((s) => s.sessionId !== meta.sessionId)
      this.sessions = this.dedupeSessions([meta, ...rest])
      this.persistSessionsLocal()
      createChatSession(meta).catch(() => {})
    },
    async initSessions() {
      await this.loadSessions()
      // 只绑定已有会话，绝不因启动而新建
      this.bindSession(false)
    },
    dedupeSessions(list) {
      const map = {}
      const out = []
      ;(list || []).forEach((s) => {
        const id = s.sessionId || s.id
        if (!id) return
        const type = s.type || 'chat'
        const key = id
        if (map[key]) return
        map[key] = true
        out.push({
          sessionId: id,
          type,
          title: s.title || '',
          updatedAt: s.updatedAt || s.updated_at || s.createdAt || 0,
          preview: s.preview || '',
        })
      })
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      return out
    },
    async loadSessions() {
      let remote = []
      try {
        const data = await fetchChatSessions()
        const list = Array.isArray(data) ? data : (data && data.sessions) || []
        remote = list
      } catch (e) {
        remote = []
      }
      let local = []
      try {
        const raw = uni.getStorageSync('chat_session_list')
        if (Array.isArray(raw)) local = raw
      } catch (e) {}
      // 本地空壳会话（无消息预览且标题为欢迎语）不合并展示
      const cleanedLocal = local.filter((s) => {
        if (!s || !s.sessionId) return false
        if (s._draft) return false
        return true
      })
      this.sessions = this.dedupeSessions([...remote, ...cleanedLocal])
      this.persistSessionsLocal()
    },
    persistSessionsLocal() {
      try {
        uni.setStorageSync('chat_session_list', this.sessions)
      } catch (e) {}
    },
    newSession() {
      this.drawerOpen = false
      this.mainView = 'operate'
      this.inStudioDesk = false
      this.domain = 'chat'
      this.bindSession(true)
      this.chatList = []
      this.inputPrompt = ''
      this.slotImages = []
      this.currentDeskRun = null
    },
    openSession(s) {
      this.drawerOpen = false
      this.mainView = 'operate'
      this.currentSessionId = s.sessionId
      if (s.type && s.type !== 'quick' && s.type !== 'chat') {
        this.domain = s.type
        this.inStudioDesk = true
      } else {
        this.domain = 'chat'
        this.inStudioDesk = false
      }
      this.sessionFilter = s.type || 'all'
      this.loadChatHistory()
    },
    confirmDeleteSession(s) {
      uni.showModal({
        title: '删除会话',
        content: '确定删除该历史对话？',
        confirmColor: '#DC2626',
        success: async (res) => {
          if (!res.confirm) return
          this.sessions = this.sessions.filter((x) => x.sessionId !== s.sessionId)
          this.persistSessionsLocal()
          try {
            await deleteChatSession(s.sessionId)
          } catch (e) {}
          if (this.currentSessionId === s.sessionId) {
            this.currentSessionId = ''
            this.chatList = []
            this.bindSession(true)
          }
        },
      })
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
    scrollToBottom() {
      this.$nextTick(() => {
        if (this.chatList.length) {
          const last = this.chatList[this.chatList.length - 1]
          this.scrollIntoId = 'msg-' + (last.id || this.chatList.length - 1)
        }
      })
    },
    confirmClearChat() {
      uni.showModal({
        title: '清空会话',
        content: '确定清空当前对话记录？',
        confirmColor: '#DC2626',
        success: async (res) => {
          if (!res.confirm) return
          this.chatList = []
          uni.removeStorageSync('chat_messages_' + this.currentSessionId)
          try {
            await clearChatMessages(this.currentSessionId)
          } catch (e) {}
          uni.showToast({ title: '已清空', icon: 'none' })
        },
      })
    },

    pickSlotImage(idx) {
      const isVideo = this.currentMode === 'video_to_music'
      if (isVideo) {
        uni.chooseVideo({
          sourceType: ['album', 'camera'],
          compressed: true,
          success: (res) => {
            if (res.tempFilePath) {
              const copy = [...this.slotImages]
              copy[idx] = res.tempFilePath
              this.slotImages = copy
            }
          },
        })
        return
      }
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          if (res.tempFilePaths && res.tempFilePaths[0]) {
            const copy = [...this.slotImages]
            copy[idx] = res.tempFilePaths[0]
            this.slotImages = copy
          }
        },
      })
    },
    removeSlotImage(idx) {
      const copy = [...this.slotImages]
      copy.splice(idx, 1)
      this.slotImages = copy
    },
    addMultiSlotImage() {
      const max = this.slotMaxImages - this.slotImages.length
      if (max <= 0) return
      uni.chooseImage({
        count: max,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const paths = (res.tempFilePaths || []).slice(0, max)
          this.slotImages = [...this.slotImages, ...paths]
        },
      })
    },

    enterDesk(dom) {
      // 独立交付模式：所有 AI 能力跳转到独立页面（对话页 / 精准编辑页），
      // 不再走工作台内联逻辑（共用层裁剪后该路径不可用）。
      const target = dom === 'chat' || !dom ? '/pages/chat/chat' : '/pages/edit/edit?domain=' + encodeURIComponent(dom || 'image')
      uni.navigateTo({ url: target })
    },
    // 元素标签对话独立入口
    openChatPage() {
      uni.navigateTo({ url: '/pages/chat/chat' })
    },
    exitStudioDesk() {
      this.inStudioDesk = false
      this.domain = 'chat'
      this.bindSession(false)
    },
    switchDeskDomain(dom) {
      this.domain = dom
      this.showDomainDropdown = false
      this.bindSession(false)
      this.loadCapabilities()
      this.currentDeskRun = null
    },
    resetDeskState() {
      this.slotImages = []
      this.inputPrompt = ''
      this.currentDeskRun = null
      this.showAtPicker = false
    },
    openParamSheet() {
      this.paramSheetOpen = true
    },
    switchSubMode(id) {
      if (this.domain === 'video') this.videoMode = id
      else if (this.domain === 'music') {
        const next = id === 'text_to_music' ? 'text_to_bgm' : id
        this.musicMode = next
        this.currentMusicModelId = next === 'text_to_song' ? 'doubao_song_v5' : 'doubao_bgm_v5'
        this.applySchemaDefaults(this.currentModelInfo)
      } else if (this.domain === 'portrait') {
        this.portraitMode = id
        if (id === 'virtual_library') this.loadPortraitLibrary()
      } else if (this.domain === 'image') this.imageMode = id

      // 如果切到了纯文生模式，清空参考素材与@提示，杜绝逻辑冲突
      if (this.isTextOnlyMode || this.isLibraryMode) {
        this.slotImages = []
        this.showAtPicker = false
      }
    },
    switchToImageMode() {
      if (this.domain === 'portrait') this.portraitMode = 'image_to_portrait'
      else if (this.domain === 'image') this.imageMode = 'image_to_image'
      else if (this.domain === 'video') this.videoMode = 'image_to_video'
      else if (this.domain === 'music') return
      this.chooseSlotMedia()
    },
    ensureImageModeOnMediaAdded() {
      if (this.isTextOnlyMode) {
        if (this.domain === 'music') return
        if (this.domain === 'portrait') this.portraitMode = 'image_to_portrait'
        else if (this.domain === 'image') this.imageMode = 'image_to_image'
        else if (this.domain === 'video') this.videoMode = 'image_to_video'
        uni.showToast({ title: '已自动切换为图生/参考模式', icon: 'none' })
      }
    },
    portraitStatusText(status) {
      if (status === 'Active') return '可用'
      if (status === 'Failed') return '失败'
      return '处理中'
    },
    portraitChipLabel(asset) {
      const group = (asset && asset.groupName) || '角色'
      const name = asset && asset.name ? String(asset.name) : ''
      if (!name || name === group) return group
      return group + ' · ' + name
    },
    stopPortraitRefresh() {
      if (this._portraitTimer) {
        clearTimeout(this._portraitTimer)
        this._portraitTimer = 0
      }
    },
    schedulePortraitRefresh() {
      this.stopPortraitRefresh()
      const pending = (this.portraitLibraryGroups || []).some((g) =>
        (g.assets || []).some((a) => a.status === 'Processing')
      )
      if (!pending) return
      if (this.domain !== 'portrait' && this.domain !== 'video') return
      this._portraitTimer = setTimeout(() => {
        this.loadPortraitLibrary()
      }, 8000)
    },
    async loadPortraitLibrary() {
      try {
        const data = await fetchPortraitLibrary()
        this.portraitConsented = !!(data && data.consented)
        this.portraitLibraryGroups = (data && data.groups) || []
        const alive = new Set(this.activePortraitAssets.map((a) => a.id))
        this.selectedPortraitAssets = this.selectedPortraitAssets.filter((a) => alive.has(a.id))
        this.schedulePortraitRefresh()
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '人像库加载失败', icon: 'none' })
      }
    },
    async confirmPortraitConsent() {
      try {
        await acceptPortraitConsent()
        this.portraitConsented = true
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '确认失败', icon: 'none' })
      }
    },
    async createPortraitGroupLocal() {
      const name = String(this.portraitGroupName || '').trim()
      if (!name) {
        uni.showToast({ title: '请填写角色名称', icon: 'none' })
        return
      }
      try {
        await createPortraitGroup(name)
        this.portraitGroupName = ''
        await this.loadPortraitLibrary()
      } catch (e) {
        uni.showToast({ title: (e && e.message) || '创建失败', icon: 'none' })
      }
    },
    removePortraitGroup(group) {
      if (!group) return
      uni.showModal({
        title: '删除角色组',
        content: '删除后火山侧素材组也会去掉，且不能恢复。',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deletePortraitGroup(group.id)
            this.selectedPortraitAssets = this.selectedPortraitAssets.filter((a) => a.groupId !== group.id)
            await this.loadPortraitLibrary()
          } catch (e) {
            uni.showToast({ title: (e && e.message) || '删除失败', icon: 'none' })
          }
        },
      })
    },
    removePortraitAsset(asset) {
      if (!asset) return
      uni.showModal({
        title: '删除素材',
        content: '删除后不能恢复。',
        success: async (res) => {
          if (!res.confirm) return
          try {
            await deletePortraitAsset(asset.id)
            this.selectedPortraitAssets = this.selectedPortraitAssets.filter((a) => a.id !== asset.id)
            await this.loadPortraitLibrary()
          } catch (e) {
            uni.showToast({ title: (e && e.message) || '删除失败', icon: 'none' })
          }
        },
      })
    },
    pickPortraitFile(group) {
      if (!group) return
      uni.chooseImage({
        count: 1,
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
        success: async (res) => {
          const filePath = (res.tempFilePaths || [])[0]
          if (!filePath) return
          uni.showLoading({ title: '上传中', mask: true })
          try {
            await uploadPortraitAsset(group.id, filePath, 'portrait.jpg')
            await this.loadPortraitLibrary()
            uni.showToast({ title: '已提交，等待入库', icon: 'none' })
          } catch (e) {
            uni.showToast({ title: (e && e.message) || '上传失败', icon: 'none' })
          } finally {
            uni.hideLoading()
          }
        },
      })
    },
    isPortraitSelected(id) {
      return this.selectedPortraitAssets.some((a) => a.id === id)
    },
    togglePortraitChip(asset) {
      if (!asset) return
      const idx = this.selectedPortraitAssets.findIndex((a) => a.id === asset.id)
      if (idx >= 0) this.selectedPortraitAssets.splice(idx, 1)
      else this.selectedPortraitAssets.push(asset)
      if (this.selectedPortraitAssets.length) this.ensureSeedanceModel()
    },
    ensureSeedanceModel() {
      const models = (((this.studioCatalog || {}).video || {}).models) || []
      const seedance = models.filter((m) => /seedance/i.test(`${m.id} ${m.model_code || ''} ${m.name || ''}`))
      if (!seedance.length) {
        uni.showToast({ title: '没有可用的 Seedance 模型', icon: 'none' })
        return
      }
      if (!seedance.some((m) => m.id === this.currentVideoModelId)) {
        this.currentVideoModelId = seedance[0].id
        this.applySchemaDefaults(seedance[0])
      }
    },
    removeRefFromPrompt(tag) {
      if (!this.inputPrompt || !tag) return
      this.inputPrompt = this.inputPrompt.split(tag).join('').replace(/，\s*，/g, '，').trim()
    },
    promptSegments(prompt, images) {
      const text = String(prompt || '')
      if (!text) return []
      const imgByTag = {}
      ;(images || []).forEach((im, i) => {
        const url = im && (im.url || im.img || im)
        const label = (im && im.label) || `图片${i + 1}`
        imgByTag['@' + label] = url
        imgByTag['@图片' + (i + 1)] = url
      })
      if (this.slotImages && this.slotImages.length) {
        this.slotImages.forEach((img, i) => {
          const label = this.getSlotTagLabel(i)
          if (!imgByTag['@' + label]) imgByTag['@' + label] = img
          if (!imgByTag['@图片' + (i + 1)]) imgByTag['@图片' + (i + 1)] = img
        })
      }
      const re = /@(图片\d+|视频\d+|音频\d+|首帧|尾帧)/g
      const segs = []
      let last = 0
      let m = re.exec(text)
      while (m) {
        if (m.index > last) segs.push({ type: 'text', value: text.slice(last, m.index) })
        const tag = m[0]
        segs.push({
          type: 'ref',
          tag,
          label: tag.slice(1),
          img: imgByTag[tag] || '',
        })
        last = m.index + tag.length
        m = re.exec(text)
      }
      if (last < text.length) segs.push({ type: 'text', value: text.slice(last) })
      return segs.length ? segs : [{ type: 'text', value: text }]
    },
    isVideoPath(p) {
      return /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i.test(String(p || ''))
    },
    getSlotTagLabel(sIdx) {
      if (this.currentMode === 'first_last_frame') {
        return sIdx === 0 ? '首帧' : '尾帧'
      }
      if (this.currentMode === 'video_to_music') {
        return '视频1'
      }
      const path = this.slotImages[sIdx]
      if (this.isVideoPath(path)) {
        const n = this.slotImages.slice(0, sIdx + 1).filter((x) => this.isVideoPath(x)).length
        return `视频${n}`
      }
      const n = this.slotImages.slice(0, sIdx + 1).filter((x) => !this.isVideoPath(x)).length
      return `图片${n}`
    },
    onRefChipClick(sIdx) {
      const label = this.getSlotTagLabel(sIdx)
      const tag = `@${label}`
      const isVideo = this.domain === 'video'
      const itemList = isVideo
        ? [
            `仅插入 ${tag}`,
            `使用 ${tag} 的人物主体`,
            `保持 ${tag} 的空间光影与构图`,
            `以 ${tag} 为起始帧推进漫游`,
            `让 ${tag} 画面呈现微风动感`,
          ]
        : [
            `仅插入 ${tag}`,
            `使用 ${tag} 的人物主体`,
            `保持 ${tag} 的艺术风格与冷暖色调`,
            `参考 ${tag} 的空间景深与构图`,
          ]
      uni.showActionSheet({
        itemList,
        success: (res) => {
          if (res.tapIndex === 0) {
            this.appendPromptWord(`${tag} `)
          } else if (res.tapIndex === 1) {
            this.appendPromptWord(`使用 ${tag} 的人物主体，`)
          } else if (res.tapIndex === 2) {
            this.appendPromptWord(isVideo ? `保持 ${tag} 的空间光影与构图，镜头向前推进，` : `保持 ${tag} 的艺术风格与冷暖色调，`)
          } else if (res.tapIndex === 3) {
            this.appendPromptWord(isVideo ? `以 ${tag} 为镜头起始帧，平滑推进漫游，` : `参考 ${tag} 的空间景深与构图，`)
          } else if (res.tapIndex === 4 && isVideo) {
            this.appendPromptWord(`让 ${tag} 中的主体自然活动，微风吹拂，光影位移，`)
          }
        },
      })
    },
    appendPromptWord(phrase) {
      if (!this.inputPrompt) {
        this.inputPrompt = phrase
      } else {
        const cur = this.inputPrompt.trimEnd()
        if (cur.endsWith(',') || cur.endsWith('，') || cur.endsWith('。') || cur.endsWith(' ') || cur.endsWith('@')) {
          this.inputPrompt = cur + phrase
        } else {
          this.inputPrompt = cur + '，' + phrase
        }
      }
    },
    applyRefPromptTemplate(qp) {
      if (qp && qp.template) {
        this.appendPromptWord(qp.template)
      }
    },
    startEditPrompt() {
      this.isEditingPrompt = true
    },
    onPromptBlur(e) {
      if (e && e.detail && typeof e.detail.cursor === 'number') {
        this.promptCursorPos = e.detail.cursor
      }
      setTimeout(() => {
        if (!this.showAtPicker) {
          this.isEditingPrompt = false
        }
      }, 250)
    },
    toggleAtPicker() {
      if (this.isTextOnlyMode || !this.slotImages.length) {
        uni.showToast({ title: '当前无可用参考素材', icon: 'none' })
        return
      }
      this.showAtPicker = !this.showAtPicker
      if (this.showAtPicker) {
        this.isEditingPrompt = true
      }
    },
    completeAtReference(sIdx) {
      const label = this.getSlotTagLabel(sIdx)
      const tag = `@${label} `
      const curText = this.inputPrompt || ''
      const pos = (this.promptCursorPos != null && this.promptCursorPos >= 0) ? this.promptCursorPos : curText.length
      const before = curText.slice(0, pos)
      const after = curText.slice(pos)
      if (before.endsWith('@')) {
        this.inputPrompt = before.slice(0, -1) + tag + after
        this.promptCursorPos = pos - 1 + tag.length
      } else {
        this.inputPrompt = before + (before.length && !before.endsWith(' ') ? ' ' : '') + tag + after
        this.promptCursorPos = this.inputPrompt.length - after.length
      }
      this.showAtPicker = false
    },
    onPromptInput(e) {
      const val = (e && e.detail && e.detail.value) != null ? e.detail.value : (this.inputPrompt || '')
      const cursor = (e && e.detail && typeof e.detail.cursor === 'number') ? e.detail.cursor : val.length
      this.promptCursorPos = cursor
      const textBeforeCursor = val.slice(0, cursor)
      if (textBeforeCursor.endsWith('@') && this.slotImages.length > 0 && !this.isTextOnlyMode) {
        this.showAtPicker = true
      } else if (this.showAtPicker && !val.includes('@')) {
        this.showAtPicker = false
      }
    },
    insertCombinePrompt() {
      if (this.slotImages.length >= 2) {
        const t1 = '@' + this.getSlotTagLabel(0)
        const t2 = '@' + this.getSlotTagLabel(1)
        this.appendPromptWord(`将 ${t2} 的主体/人物自然置入 ${t1} 的场景空间中，保持光影和谐，`)
      }
    },
    chooseChatMedia() {
      uni.showActionSheet({
        itemList: ['从手机相册选图', '拍照', '从手机相册选视频', '从素材库选择'],
        success: (res) => {
          if (res.tapIndex === 0) this.pickImageLocal('album')
          else if (res.tapIndex === 1) this.pickImageLocal('camera')
          else if (res.tapIndex === 2) this.pickVideoLocal('album')
          else if (res.tapIndex === 3) this.openSlotAssetPicker()
        },
      })
    },
    chooseSlotMedia() {
      if (this.domain === 'chat') {
        this.chooseChatMedia()
        return
      }
      const isVideo = this.domain === 'music' && this.currentMode === 'video_to_music'
      const itemList = isVideo
        ? ['从手机相册选视频', '拍摄录像']
        : ['从手机相册选图', '拍照拍摄', '从素材库选择']
      uni.showActionSheet({
        itemList,
        success: (res) => {
          if (res.tapIndex === 0) {
            if (isVideo) this.pickVideoLocal('album')
            else this.pickImageLocal('album')
          } else if (res.tapIndex === 1) {
            if (isVideo) this.pickVideoLocal('camera')
            else this.pickImageLocal('camera')
          } else if (res.tapIndex === 2) {
            this.openSlotAssetPicker()
          }
        },
      })
    },
    pickImageLocal(sourceType) {
      const max = this.slotMaxImages - this.slotImages.length
      if (max <= 0) return
      uni.chooseImage({
        count: max,
        sizeType: ['compressed'],
        sourceType: [sourceType],
        success: (res) => {
          if (res.tempFilePaths && res.tempFilePaths.length) {
            this.slotImages = [...this.slotImages, ...res.tempFilePaths.slice(0, max)]
            this.ensureImageModeOnMediaAdded()
          }
        },
      })
    },
    pickVideoLocal(sourceType) {
      uni.chooseVideo({
        sourceType: [sourceType],
        compressed: true,
        success: (res) => {
          if (res.tempFilePath) {
            this.slotImages = [res.tempFilePath]
            this.ensureImageModeOnMediaAdded()
          }
        },
      })
    },
    openSlotAssetPicker() {
      this.currentQuickItem = { mode: 'slot_picker', label: '选择参考素材' }
      this.quickPickerOpen = true
      this.loadRecentLibraryImages()
    },

    copyToDomain(target, url) {
      if (!url) return
      this.mainView = 'operate'
      this.domain = target
      this.inStudioDesk = true
      if (target === 'video') {
        this.videoMode = 'image_to_video'
        this.slotImages = [url]
      } else {
        this.imageMode = 'image_to_image'
        this.slotImages = [url]
      }
      this.sessionFilter = target
      this.bindSession(false)
      uni.showToast({ title: target === 'video' ? '已装入生视频首帧' : '已装入生图参考', icon: 'none' })
    },

    toggleQuickGroup(g) {
      if (!g) return
      this.expandedQuickId = this.expandedQuickId === g.id ? '' : g.id
    },
    launchQuick(q) {
      this.currentQuickItem = q
      this.drawerOpen = false
      if (q && q.desk) {
        this.enterDesk(q.desk)
        if (q.mode) this.switchSubMode(q.mode)
        return
      }
      this.quickPickerOpen = true
      this.loadRecentLibraryImages()
    },
    async loadRecentLibraryImages(category = null, keyword = null, append = false) {
      if (this.loadingRecentImages && !append) return
      this.loadingRecentImages = true
      if (category !== null) this.pickerActiveCategory = category
      if (keyword !== null) this.pickerSearchKeyword = keyword
      if (!append) {
        this.pickerPage = 1
        this.pickerHasMore = true
      }
      try {
        const opts = {
          page: this.pickerPage,
          pageSize: 36,
          sort: 'latest',
        }
        if (this.pickerSearchKeyword && this.pickerSearchKeyword.trim()) {
          opts.keyword = this.pickerSearchKeyword.trim()
        }
        if (this.pickerActiveCategory === 'furniture') {
          opts.mediaType = 'furniture'
        } else if (this.pickerActiveCategory === 'portrait') {
          opts.mediaType = 'portrait'
        } else if (this.pickerActiveCategory === 'space') {
          opts.mediaType = 'image'
        } else {
          // 'all': 全量图片类素材（不排斥家具单品与模特人像）
          opts.all = 1
        }
        const res = await fetchAssets(opts)
        const list = Array.isArray(res) ? res : ((res && (res.items || res.data || res.assets)) || [])
        const formatted = list.map((a) => {
          const cat = (a.category === 'furniture' || a.furniture_item) ? '单品' : ((a.category === 'portrait' || a.character) ? '人像' : '场景')
          const tags = [a.space, a.style, a.furniture_item, a.material].filter(Boolean).slice(0, 2).join(' · ')
          return {
            fid: a.fid,
            imgUrl: a.thumbUrl || a.imgUrl || mediaUrl(a.fid, 0),
            fileName: a.fileName || a.file_name || a.fid,
            category: cat,
            tagsText: tags,
            width: a.width,
            height: a.height,
          }
        })
        if (append) {
          this.recentLibraryImages = [...this.recentLibraryImages, ...formatted]
        } else {
          this.recentLibraryImages = formatted
        }
        if (formatted.length < opts.pageSize) {
          this.pickerHasMore = false
        }
      } catch (e) {
        if (!append) this.recentLibraryImages = []
        this.pickerHasMore = false
      } finally {
        this.loadingRecentImages = false
      }
    },
    switchPickerCategory(catId) {
      this.pickerActiveCategory = catId
      this.loadRecentLibraryImages(catId, this.pickerSearchKeyword, false)
    },
    clearPickerSearch() {
      this.pickerSearchKeyword = ''
      this.loadRecentLibraryImages(this.pickerActiveCategory, '', false)
    },
    onPickerScrollToLower() {
      if (this.loadingRecentImages || !this.pickerHasMore) return
      this.pickerPage += 1
      this.loadRecentLibraryImages(this.pickerActiveCategory, this.pickerSearchKeyword, true)
    },
    pickImageFromLocal(sourceType) {
      uni.chooseImage({
        count: 1,
        sourceType: [sourceType],
        sizeType: ['compressed'],
        success: (res) => {
          if (res.tempFilePaths && res.tempFilePaths[0]) {
            if (this.currentQuickItem && this.currentQuickItem.mode === 'slot_picker') {
              this.quickPickerOpen = false
              this.slotImages = [...this.slotImages, res.tempFilePaths[0]].slice(0, this.slotMaxImages)
              this.ensureImageModeOnMediaAdded()
            } else {
              this.goToEditorWithImage(res.tempFilePaths[0], '')
            }
          }
        },
      })
    },
    confirmQuickWithAsset(item) {
      if (this.currentQuickItem && this.currentQuickItem.mode === 'slot_picker') {
        this.quickPickerOpen = false
        this.slotImages = [...this.slotImages, item.imgUrl].slice(0, this.slotMaxImages)
        this.ensureImageModeOnMediaAdded()
      } else {
        this.goToEditorWithImage(item.imgUrl, item.fid)
      }
    },
    goToEditorWithImage(imgUrl, fid) {
      this.quickPickerOpen = false
      const mode = this.currentQuickItem ? this.currentQuickItem.mode : 'expand'
      if (mode === 'roam' || mode === 'spatial_walkthrough') {
        const fidsParam = encodeURIComponent(JSON.stringify(fid ? [fid] : []))
        uni.navigateTo({ url: `/pages/quick/walkthrough?fids=${fidsParam}` })
        return
      }

      const pageMap = {
        expand: '/pages/quick/expand',
        enhance: '/pages/quick/enhance',
        watermark: '/pages/quick/watermark',
        remove: '/pages/quick/remove',
        insert: '/pages/quick/insert',
        replace: '/pages/quick/replace',
      }

      const targetPage = pageMap[mode] || '/pages/quick/expand'
      let url = `${targetPage}?imgUrl=${encodeURIComponent(imgUrl)}`
      if (fid) url += `&fid=${encodeURIComponent(fid)}`
      uni.navigateTo({ url })
    },

    async handleOptimizePrompt() {
      const p = (this.inputPrompt || '').trim()
      if (!p) {
        uni.showToast({ title: '请先输入描述', icon: 'none' })
        return
      }
      if (this.optimizingPrompt) return
      const modelId = this.currentModelInfo && this.currentModelInfo.id
      if (!modelId) {
        uni.showToast({ title: '请先选择生成模型', icon: 'none' })
        return
      }
      this.optimizingPrompt = true
      try {
        const res = await optimizePrompt(p, {
          modelId,
          mode: this.currentMode,
          slots: { images: this.slotImages.length },
          imageUrls: this.slotImages,
          locked: this.genParams,
        })
        const optimized = res && (res.optimized || (res.data && res.data.optimized))
        if (!optimized) throw new Error('优化器未返回内容')
        if (!this.promptBeforeOptimize) this.promptBeforeOptimize = p
        this.inputPrompt = optimized
        this.isEditingPrompt = false
        uni.showToast({ title: '已写成最终提示词', icon: 'none' })
      } catch (e) {
        let msg = e.message || '优化失败，原文未改'
        if (/OPENAI_API_KEY|AuthenticationError|对话网关未配上游 Key/i.test(msg)) {
          msg = '对话网关未配上游 Key'
        } else if (/timeout|超时/i.test(msg)) {
          msg = '提示词优化超时，请重试'
        }
        uni.showToast({ title: msg, icon: 'none' })
      } finally {
        this.optimizingPrompt = false
      }
    },
    undoOptimize() {
      if (!this.promptBeforeOptimize) return
      this.inputPrompt = this.promptBeforeOptimize
      this.promptBeforeOptimize = ''
    },
    copyInputPrompt() {
      if (!this.inputPrompt) return
      uni.setClipboardData({
        data: this.inputPrompt,
        success: () => uni.showToast({ title: '已复制完整提示词', icon: 'none' })
      })
    },
    handleRetry() {
      if (!this.inputPrompt || !this.inputPrompt.trim()) {
        if (this.lastSentPrompt) {
          this.inputPrompt = this.lastSentPrompt
        }
      }
      this.handleSend()
    },
    async handleSend() {
      if (!this.canSend || this.sending) return
      if (!sessionValid()) {
        goLogin()
        return
      }
      this.sending = true
      const promptText = this.inputPrompt.trim()
      this.lastSentPrompt = promptText
      const mode = this.currentMode
      const userMsgId = 'u_' + Date.now()
      const aiMsgId = 'a_' + (Date.now() + 1)
      const params = {
        ratio: this.showRatio ? this.selectedRatio : undefined,
        duration: this.showDuration ? this.selectedDuration : undefined,
        clarity: this.showClarity ? this.selectedClarity : undefined,
        mood: this.showMood ? this.selectedMood : undefined,
      }
      const attachedImages = this.slotImages.map((u, i) => ({
        url: u,
        label:
          mode === 'first_last_frame'
            ? i === 0
              ? '首帧'
              : '尾帧'
            : mode === 'video_to_music'
              ? '视频'
              : `图片${i + 1}`,
      }))

      const userMsg = {
        id: userMsgId,
        sessionId: this.currentSessionId,
        role: 'user',
        mode,
        prompt: promptText,
        params,
        images: attachedImages,
        status: 'done',
        createdAt: Date.now(),
      }
      const aiMsg = {
        id: aiMsgId,
        sessionId: this.currentSessionId,
        role: 'assistant',
        mode,
        prompt: promptText,
        status: 'running',
        progress: 10,
        engineTitle:
          this.domain === 'chat'
            ? `${this.currentModelInfo.name || '对话模型'} 思考中…`
            : `${this.currentModelInfo.name || '模型'} 生成中…`,
        createdAt: Date.now() + 1,
      }
      if (this.inStudioDesk) {
        this.currentDeskRun = {
          id: aiMsgId,
          status: 'running',
          progress: 10,
          result: null,
          error: '',
        }
      }
      this.chatList.push(userMsg)
      this.chatList.push(aiMsg)
      this.inputPrompt = ''
      this.promptBeforeOptimize = ''
      this.scrollToBottom()
      saveChatMessage(userMsg).catch(() => {})

      try {
        if (this.domain === 'chat') {
          let imageUrls = []
          let videoUrls = []
          if (this.slotImages.length) {
            uni.showLoading({ title: '上传引用…', mask: true })
            try {
              const imgs = this.slotImages.filter((p) => !this.isVideoPath(p))
              const vids = this.slotImages.filter((p) => this.isVideoPath(p))
              if (imgs.length) {
                const uploaded = await uploadRefImages(imgs)
                imageUrls = uploaded.map((u) => u.url).filter(Boolean)
              }
              if (vids.length) {
                const uploaded = await uploadRefImages(vids)
                videoUrls = uploaded.map((u) => u.url).filter(Boolean)
              }
            } finally {
              uni.hideLoading()
            }
          }
          const run = await submitLabRun({
            entryId: 'chat.assistant',
            params: {
              prompt: promptText || '请结合引用素材回答。',
              model: this.currentChatModelId || undefined,
              mode: 'chat',
              sessionId: this.currentSessionId,
              imageUrls,
              videoUrls,
            },
          })
          this.finishChatRun(run, aiMsg, 'text')
        } else {
          let imageUrls = []
          let firstFrame = null
          let lastFrame = null
          let videoUrlRef = null
          if (this.requiresSlots && this.slotImages.length) {
            uni.showLoading({ title: '上传参考…', mask: true })
            try {
              if (mode === 'video_to_music') {
                // 视频暂用 uploadAiFile 路径：若为本地文件则走 uploadRefImage 同类通道
                const uploaded = await uploadRefImages(this.slotImages)
                videoUrlRef = uploaded[0] && uploaded[0].url
              } else {
                const uploaded = await uploadRefImages(this.slotImages)
                if (mode === 'first_last_frame') {
                  firstFrame = uploaded[0] && uploaded[0].url
                  lastFrame = uploaded[1] && uploaded[1].url
                  imageUrls = uploaded.map((u) => u.url).filter(Boolean)
                } else {
                  imageUrls = uploaded.map((u) => u.url).filter(Boolean)
                }
              }
            } finally {
              uni.hideLoading()
            }
          }

          let entryId = 'gen.image'
          if (this.domain === 'video') entryId = 'gen.video'
          else if (this.domain === 'music') {
            entryId = this.musicMode === 'text_to_song' ? 'music.song' : 'music.bgm'
          } else if (this.domain === 'portrait') {
            entryId =
              mode === 'image_to_portrait' ? 'gen.portrait.from_image' : 'gen.portrait'
          }

          const modelInfo = this.currentModelInfo
          const gp = this.genParams || {}
          const gate = assertAgnesFreeTier(modelInfo, {
            imageCount: (imageUrls && imageUrls.length) || this.slotImages.length || 0,
            size: gp.size || gp.resolution || this.selectedClarity || '',
          })
          if (!gate.ok) {
            throw new Error(gate.message)
          }
          let finalPrompt = convertAtRefs(promptText, refStyleFor(modelInfo.id))
          const sch = schemaFor(modelInfo)
          const runParams = {
            prompt: finalPrompt,
            model: modelInfo.model_code || modelInfo.id || undefined,
            adapterId: modelInfo.adapterId || undefined,
            mode,
            sessionId: this.currentSessionId,
          }
          Object.keys(gp).forEach((k) => {
            if (gp[k] === '' || gp[k] === undefined) return
            runParams[k] = gp[k]
          })
          if (sch && sch.submitMap) {
            if (sch.submitMap.duration && gp.duration != null) runParams[sch.submitMap.duration] = gp.duration
            if (sch.submitMap.size) runParams[sch.submitMap.size] = gp.size || gp.resolution
          }
          if (imageUrls.length) runParams.imageUrls = imageUrls
          if (firstFrame) runParams.firstFrame = firstFrame
          if (lastFrame) runParams.lastFrame = lastFrame
          if (videoUrlRef) runParams.videoUrl = videoUrlRef
          if (this.domain === 'video' && this.selectedPortraitAssets.length) {
            runParams.portraitAssetIds = this.selectedPortraitAssets.map((a) => a.id)
          }
          if (this.domain === 'music' && this.musicMode === 'text_to_song') {
            runParams.mode = 'text_to_song'
            runParams.songInputKind = this.songInputKind
            if (this.songInputKind === 'lyrics') {
              runParams.lyrics = promptText
              runParams.prompt = ''
            } else {
              runParams.lyrics = ''
              runParams.prompt = promptText
            }
          } else if (this.domain === 'music') {
            runParams.mode = 'text_to_bgm'
            runParams.lyrics = ''
            runParams.prompt = promptText
          }

          const run = await submitLabRun({ entryId, params: runParams })
          this.promptBeforeOptimize = ''
          this.finishGenRun(run, aiMsg, mode)
        }
      } catch (err) {
        aiMsg.status = 'failed'
        aiMsg.error = err.message || '发送失败'
        if (this.currentDeskRun && this.currentDeskRun.id === aiMsg.id) {
          this.currentDeskRun.status = 'failed'
          this.currentDeskRun.error = aiMsg.error
        }
      } finally {
        this.sending = false
        saveChatMessage(aiMsg).catch(() => {})
        try {
          uni.setStorageSync('chat_messages_' + this.currentSessionId, this.chatList)
        } catch (e) {}
        this.scrollToBottom()
        this.touchSessionTitle(promptText)
      }
    },

    touchSessionTitle(prompt) {
      const title = String(prompt || '').slice(0, 16) || this.typeLabel(this.sessionTypeOfDomain())
      const s = this.sessions.find((x) => x.sessionId === this.currentSessionId)
      if (s) {
        if (!s.title || s.title === this.welcomeTitle || s.title === '新会话') {
          s.title = title
        }
        s.updatedAt = Date.now()
        s.preview = String(prompt || '').slice(0, 40)
        this.persistSessionsLocal()
        if (this._sessionPersisted) {
          createChatSession({
            sessionId: this.currentSessionId,
            type: s.type,
            title: s.title,
          }).catch(() => {})
        } else {
          this.persistCurrentSession(title)
        }
      } else {
        this.persistCurrentSession(title)
      }
    },

    finishChatRun(run, aiMsg) {
      const text =
        run?.result?.text ||
        run?.text ||
        run?.result?.content ||
        (run?.status === 'done' ? '（服务端未返回文本）' : '')
      if (run && run.status === 'failed') {
        aiMsg.status = 'failed'
        aiMsg.error = run.error || (run.result && run.result.error) || '对话失败'
        return
      }
      if (run && run.runId && run.status !== 'done') {
        this.pollRunTask(run.engine, run.runId, aiMsg, 'chat')
        return
      }
      aiMsg.status = 'done'
      aiMsg.progress = 100
      aiMsg.result = { kind: 'text', text: text || '完成' }
    },

    finishGenRun(run, aiMsg, mode) {
      const kind = mediaKindOf(mode)

      const updateDeskRun = () => {
        if (this.currentDeskRun && this.currentDeskRun.id === aiMsg.id) {
          this.currentDeskRun.status = aiMsg.status
          this.currentDeskRun.progress = aiMsg.progress
          this.currentDeskRun.result = aiMsg.result
          this.currentDeskRun.error = aiMsg.error
        }
      }

      if (run && run.status === 'done') {
        const file = run.result?.files?.[0]
        const url = absMediaUrl(file, run.result)
        aiMsg.status = 'done'
        aiMsg.progress = 100
        aiMsg.result = {
          url,
          kind: file?.kind || kind,
        }
        updateDeskRun()
        return
      }
      if (run && run.status === 'failed') {
        aiMsg.status = 'failed'
        aiMsg.error = (run.result && run.result.error) || run.error || '生成失败'
        updateDeskRun()
        return
      }
      if (run && run.runId) {
        this.pollRunTask(run.engine, run.runId, aiMsg, mode)
        return
      }
      if (run && run.result && run.result.previewUrl) {
        aiMsg.status = 'done'
        aiMsg.progress = 100
        aiMsg.result = {
          url: absMediaUrl(null, run.result),
          kind,
        }
        updateDeskRun()
        return
      }
      aiMsg.status = 'failed'
      aiMsg.error =
        this.domain === 'music' || this.domain === 'portrait'
          ? '该生成能力服务端尚未就绪，请先按 API_CONTRACT.md 实现'
          : '服务端未返回生成结果'
      updateDeskRun()
    },

    async pollRunTask(engine, runId, aiMsg, mode) {
      const updateDeskRun = () => {
        if (this.currentDeskRun && this.currentDeskRun.id === aiMsg.id) {
          this.currentDeskRun.status = aiMsg.status
          this.currentDeskRun.progress = aiMsg.progress
          this.currentDeskRun.result = aiMsg.result
          this.currentDeskRun.error = aiMsg.error
        }
      }
      const kind = mode === 'chat' ? 'text' : mediaKindOf(mode)
      const maxTries = kind === 'video' || kind === 'audio' ? 120 : 60
      const intervalMs = kind === 'video' || kind === 'audio' ? 5000 : 3000
      for (let i = 0; i < maxTries; i++) {
        await new Promise((r) => setTimeout(r, intervalMs))
        try {
          const st = await pollLabRun(engine, runId)
          if (st && st.progress != null) {
            aiMsg.progress = st.progress
            updateDeskRun()
          }
          if (st && (st.status === 'done' || st.status === 'success')) {
            if (kind === 'text') {
              aiMsg.status = 'done'
              aiMsg.result = {
                kind: 'text',
                text: st.result?.text || st.text || '完成',
              }
            } else {
              const file = st.result?.files?.[0]
              aiMsg.status = 'done'
              aiMsg.result = {
                url: absMediaUrl(file, st.result),
                kind: file?.kind || kind,
              }
            }
            updateDeskRun()
            return
          }
          if (st && st.status === 'failed') {
            aiMsg.status = 'failed'
            aiMsg.error = st.error || '生成失败'
            updateDeskRun()
            return
          }
        } catch (e) {}
      }
      aiMsg.status = 'failed'
      aiMsg.error = '生成任务轮询超时'
      updateDeskRun()
    },
  },
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f8fafc;
  overflow: hidden;
}
.status-bar {
  flex-shrink: 0;
}
.nav-bar {
  flex-shrink: 0;
  height: 88rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 24rpx;
  background: #ffffff;
  border-bottom: 1rpx solid #e2e8f0;
  box-sizing: border-box;
}
.nav-left,
.nav-right {
  width: 96rpx;
  min-width: 96rpx;
  height: 88rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}
.nav-right {
  justify-content: flex-end;
}
.desk-back {
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}
.desk-back-arrow {
  font-size: 52rpx;
  color: #0f172a;
  font-weight: 300;
  line-height: 72rpx;
}
.desk-mode-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 24rpx;
  background: #f1f5f9;
  border-radius: 999rpx;
}
.desk-mode-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #0f172a;
}
.desk-mode-arrow {
  font-size: 22rpx;
  color: #64748b;
}
.desk-menu-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 998;
  background: rgba(15, 23, 42, 0.25);
}
.desk-menu-popover {
  position: absolute;
  top: 140rpx;
  left: 50%;
  transform: translateX(-50%);
  background: #ffffff;
  border-radius: 20rpx;
  box-shadow: 0 16rpx 48rpx rgba(15, 23, 42, 0.16);
  border: 1rpx solid #e2e8f0;
  padding: 12rpx;
  min-width: 320rpx;
  z-index: 999;
}
.desk-menu-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 24rpx;
  border-radius: 14rpx;
}
.desk-menu-item:active {
  background: #f1f5f9;
}
.desk-menu-item.active {
  background: #eff6ff;
}
.desk-menu-icon {
  font-size: 28rpx;
}
.desk-menu-label {
  flex: 1;
  font-size: 26rpx;
  font-weight: 600;
  color: #334155;
}
.desk-menu-item.active .desk-menu-label {
  color: #2563eb;
  font-weight: 700;
}
.desk-menu-check {
  font-size: 24rpx;
  color: #2563eb;
  font-weight: bold;
}

.hamburger {
  width: 44rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 12rpx 0;
}
.ham-line {
  height: 4rpx;
  background: #0f172a;
  border-radius: 2rpx;
}
.ham-line.short {
  width: 28rpx;
}
.segment-pill {
  width: 320rpx;
  height: 64rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  background: #f1f5f9;
  border-radius: 999rpx;
  padding: 4rpx;
  box-sizing: border-box;
}
.seg-item {
  flex: 1;
  height: 56rpx;
  border-radius: 999rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  text-align: center;
  box-sizing: border-box;
  transition: all 0.2s ease;
}
.seg-item.active {
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(15, 23, 42, 0.08);
}
.seg-text {
  font-size: 26rpx;
  line-height: 56rpx;
  color: #64748b;
  text-align: center;
  display: block;
}
.seg-item.active .seg-text {
  color: #0f172a;
  font-weight: 700;
}
.icon-btn {
  padding: 8rpx;
}
.icon-btn.placeholder {
  opacity: 0;
}
.action-icon {
  font-size: 24rpx;
  color: #64748b;
}

.operate {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chat-scroll {
  flex: 1;
  min-height: 0;
}
.welcome {
  padding: 80rpx 48rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.welcome-badge {
  font-size: 22rpx;
  color: #2563eb;
  background: #eff6ff;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  margin-bottom: 24rpx;
}
.welcome-title {
  font-size: 40rpx;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 16rpx;
  text-align: center;
}
.welcome-desc {
  font-size: 26rpx;
  color: #64748b;
  text-align: center;
  line-height: 1.6;
  margin-bottom: 36rpx;
}
.preset-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.preset-pill {
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  border-radius: 20rpx;
  padding: 22rpx 28rpx;
}
.preset-t {
  font-size: 26rpx;
  color: #334155;
  line-height: 1.5;
}
.chat-group {
  padding: 8rpx 24rpx;
}
.bubble-row.user {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 20rpx;
}
.bubble-row.ai {
  display: flex;
  flex-direction: row;
  margin-bottom: 20rpx;
}
.bubble.user {
  max-width: 85%;
  background: #2563eb;
  border-radius: 24rpx 8rpx 24rpx 24rpx;
  padding: 18rpx 22rpx;
}
.bubble.ai {
  flex: 1;
  max-width: 90%;
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  border-radius: 8rpx 24rpx 24rpx 24rpx;
  padding: 18rpx;
}
.ai-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: #eff6ff;
  align-items: center;
  justify-content: center;
  margin-right: 12rpx;
  font-size: 28rpx;
}
.user-meta {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-bottom: 8rpx;
}
.mode-tag,
.param-tag {
  font-size: 18rpx;
  color: #dbeafe;
  background: rgba(255, 255, 255, 0.18);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.user-prompt {
  font-size: 28rpx;
  color: #ffffff;
  line-height: 1.5;
}
.user-prompt-rich {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
}
.inline-ref-chip {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 6rpx;
  background: #ffffff;
  border-radius: 999rpx;
  padding: 4rpx 12rpx 4rpx 4rpx;
}
.inline-ref-thumb {
  width: 36rpx;
  height: 36rpx;
  border-radius: 8rpx;
  background: #e2e8f0;
}
.inline-ref-label {
  font-size: 22rpx;
  color: #1d4ed8;
  font-weight: 700;
}
.inline-ref-x {
  font-size: 20rpx;
  color: #dbeafe;
  margin-left: 2rpx;
}
.ref-tray {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 12rpx;
}
.ref-thumb {
  width: 96rpx;
  height: 96rpx;
  border-radius: 10rpx;
  overflow: hidden;
  position: relative;
}
.ref-img {
  width: 100%;
  height: 100%;
}
.ref-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 16rpx;
  color: #fff;
  background: rgba(0, 0, 0, 0.4);
  text-align: center;
}
.status-running {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.spinner {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  border: 4rpx solid #e2e8f0;
  border-top-color: #2563eb;
  margin-right: 16rpx;
}
.run-title {
  font-size: 26rpx;
  color: #0f172a;
}
.run-sub {
  font-size: 22rpx;
  color: #64748b;
  margin-top: 4rpx;
}
.failed-t {
  font-size: 26rpx;
  color: #dc2626;
  min-width: 0;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.text-body {
  font-size: 28rpx;
  color: #0f172a;
  line-height: 1.6;
}
.result-image {
  width: 100%;
  border-radius: 12rpx;
}
.result-video {
  width: 100%;
  height: 360rpx;
  border-radius: 12rpx;
  background: #000;
}
.result-audio {
  width: 100%;
}
.result-actions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}
.act-btn {
  padding: 10rpx 20rpx;
  background: #eff6ff;
  border-radius: 999rpx;
}
.act-t {
  font-size: 22rpx;
  color: #2563eb;
}
.chat-pad {
  height: 24rpx;
}

.composer {
  flex-shrink: 0;
  background: #ffffff;
  border-top: 1rpx solid #e2e8f0;
  padding: 12rpx 20rpx 0;
}
.params-panel {
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 20rpx;
  padding: 16rpx;
  margin-bottom: 12rpx;
}
.params-title {
  font-size: 22rpx;
  color: #64748b;
  margin-bottom: 12rpx;
}
.params-body {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.param-block {
  display: flex;
  flex-direction: column;
}
.param-label {
  font-size: 22rpx;
  color: #94a3b8;
  margin-bottom: 8rpx;
}
.param-chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10rpx;
}
.p-chip {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
}
.p-chip.active {
  background: #eff6ff;
  border-color: #2563eb;
}
.p-chip-t {
  font-size: 22rpx;
  color: #334155;
}
.p-chip.active .p-chip-t {
  color: #2563eb;
}
.param-empty {
  font-size: 22rpx;
  color: #94a3b8;
}
.collapsed-params {
  display: flex;
  flex-direction: row;
  align-items: center;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 999rpx;
  padding: 12rpx 22rpx;
  margin-bottom: 12rpx;
}
.collapse-t {
  flex: 1;
  font-size: 22rpx;
  color: #475569;
}
.collapse-arrow {
  font-size: 20rpx;
  color: #94a3b8;
  margin-left: 8rpx;
}
.domain-scroll {
  white-space: nowrap;
  margin-bottom: 10rpx;
}
.domain-row {
  display: inline-flex;
  flex-direction: row;
  gap: 10rpx;
}
.domain-chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1rpx solid transparent;
}
.domain-chip.active {
  background: #eff6ff;
  border-color: #2563eb;
}
.domain-chip.sub {
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
}
.domain-chip.sub.active {
  background: #0f172a;
  border-color: #0f172a;
}
.domain-chip.sub.active .domain-label {
  color: #ffffff;
}
.domain-icon {
  font-size: 22rpx;
  margin-right: 6rpx;
}
.domain-label {
  font-size: 22rpx;
  color: #334155;
}
.domain-chip.active .domain-label {
  color: #2563eb;
  font-weight: 600;
}
.slots {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 10rpx;
}
.slot {
  width: 120rpx;
  height: 120rpx;
  border-radius: 14rpx;
  border: 2rpx dashed #cbd5e1;
  background: #f8fafc;
  position: relative;
  overflow: hidden;
  align-items: center;
  justify-content: center;
}
.slot.multi {
  width: 112rpx;
  height: 112rpx;
  border-style: solid;
  border-color: #e2e8f0;
}
.slot.multi.add {
  border-style: dashed;
  background: #ffffff;
}
.slot.single {
  width: 140rpx;
  height: 140rpx;
}
.slot-badge {
  position: absolute;
  left: 6rpx;
  top: 6rpx;
  font-size: 16rpx;
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  background: rgba(15, 23, 42, 0.55);
  color: #fff;
}
.slot-img {
  width: 100%;
  height: 100%;
}
.slot-empty {
  align-items: center;
  justify-content: center;
}
.plus {
  font-size: 36rpx;
  color: #94a3b8;
  line-height: 1;
}
.slot-label {
  font-size: 18rpx;
  color: #94a3b8;
  margin-top: 4rpx;
}
.slot-del {
  position: absolute;
  right: 4rpx;
  top: 4rpx;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.55);
  color: #fff;
  font-size: 18rpx;
  text-align: center;
  line-height: 32rpx;
}
.slot-arrow {
  color: #94a3b8;
  font-size: 24rpx;
}
.input-row {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 12rpx;
}
.fab {
  height: 72rpx;
  padding: 0 18rpx;
  border-radius: 999rpx;
  background: #0f172a;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.fab-t {
  color: #ffffff;
  font-size: 22rpx;
}
.input-wrap {
  flex: 1;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 24rpx;
  padding: 16rpx 20rpx;
  min-height: 72rpx;
  max-height: 200rpx;
}
.main-input {
  width: 100%;
  font-size: 28rpx;
  color: #0f172a;
  min-height: 40rpx;
}
.send-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #2563eb;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  flex-shrink: 0;
  line-height: 72rpx;
}
.send-btn[disabled] {
  background: #93c5fd;
  color: #ffffff;
}
.send-t {
  font-size: 32rpx;
  color: #ffffff;
  font-weight: 600;
}
.safe-bottom {
  height: env(safe-area-inset-bottom);
  min-height: 12rpx;
}

.drawer-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 1000;
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: stretch;
}
.drawer {
  width: 560rpx;
  max-width: 82vw;
  height: 100%;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  padding-left: env(safe-area-inset-left);
  box-sizing: border-box;
  box-shadow: 8rpx 0 32rpx rgba(15, 23, 42, 0.18);
}
.quick-group {
  margin-bottom: 4rpx;
}
.quick-cat-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 14rpx 8rpx;
  border-radius: 16rpx;
}
.quick-cat-row:active {
  background: #f8fafc;
}
.quick-coming {
  padding: 8rpx 16rpx 16rpx 96rpx;
}
.quick-coming-t {
  font-size: 22rpx;
  color: #94a3b8;
}
.quick-group-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 1rpx;
  margin: 8rpx 4rpx 10rpx;
}
.drawer-safe {
  flex-shrink: 0;
}
.drawer-sec {
  padding: 16rpx 24rpx;
  flex-shrink: 0;
}
.drawer-sec.quick-sec {
  max-height: 52%;
  overflow-y: auto;
}
.drawer-sec.grow {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.drawer-sec-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.drawer-sec-title {
  font-size: 24rpx;
  color: #94a3b8;
  font-weight: 600;
}
.new-session {
  padding: 6rpx 16rpx;
  background: #eff6ff;
  border-radius: 999rpx;
}
.new-t {
  font-size: 22rpx;
  color: #2563eb;
}
.quick-list {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  padding-left: 12rpx;
}
.quick-row-v {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 12rpx 8rpx;
  border-radius: 16rpx;
}
.quick-row-v.nested {
  padding-left: 16rpx;
}
.quick-row-v:active {
  background: #f8fafc;
}
.quick-ico-box {
  width: 72rpx;
  height: 72rpx;
  border-radius: 18rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.quick-ico-box.sm {
  width: 56rpx;
  height: 56rpx;
  border-radius: 14rpx;
}
.quick-ico {
  font-size: 32rpx;
  line-height: 1;
}
.quick-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.quick-name {
  font-size: 28rpx;
  color: #0f172a;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-sub {
  font-size: 22rpx;
  color: #94a3b8;
  margin-top: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-arrow {
  font-size: 32rpx;
  color: #cbd5e1;
  padding: 8rpx;
}
.type-filter-trigger {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 10rpx 18rpx;
  background: #f1f5f9;
  border-radius: 999rpx;
}
.type-filter-t {
  font-size: 24rpx;
  color: #334155;
  font-weight: 600;
  margin-right: 8rpx;
}
.type-filter-arrow {
  font-size: 18rpx;
  color: #64748b;
}
.type-menu {
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  border-radius: 16rpx;
  margin-bottom: 12rpx;
  overflow: hidden;
}
.type-menu-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 22rpx;
  border-bottom: 1rpx solid #f1f5f9;
}
.type-menu-item:last-child {
  border-bottom: none;
}
.type-menu-item.active {
  background: #eff6ff;
}
.type-menu-t {
  font-size: 26rpx;
  color: #0f172a;
}
.type-menu-check {
  font-size: 24rpx;
  color: #2563eb;
}
.drawer-divider {
  height: 1rpx;
  background: #e2e8f0;
  margin: 4rpx 24rpx;
}
.filter-scroll {
  white-space: nowrap;
  margin-bottom: 8rpx;
}
.filter-row {
  display: inline-flex;
  flex-direction: row;
  gap: 8rpx;
}
.filter-chip {
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
}
.filter-chip.active {
  background: #eff6ff;
}
.filter-t {
  font-size: 20rpx;
  color: #475569;
}
.filter-chip.active .filter-t {
  color: #2563eb;
}
.session-scroll {
  flex: 1;
  min-height: 0;
}
.session-empty {
  padding: 48rpx 16rpx;
  align-items: center;
}
.session-empty-t {
  font-size: 26rpx;
  color: #64748b;
}
.session-empty-s {
  font-size: 22rpx;
  color: #94a3b8;
  margin-top: 8rpx;
}
.session-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 16rpx 12rpx;
  border-radius: 14rpx;
  margin-bottom: 4rpx;
  border-left: 8rpx solid #cbd5e1;
}
.session-row-chat { background: #f8fafc; border-left-color: #64748b; }
.session-row-image { background: #eff6ff; border-left-color: #2563eb; }
.session-row-video { background: #f5f3ff; border-left-color: #7c3aed; }
.session-row-music { background: #f0fdfa; border-left-color: #0d9488; }
.session-row-portrait { background: #fdf2f8; border-left-color: #db2777; }
.session-row-quick { background: #fff7ed; border-left-color: #ea580c; }
.session-row.active {
  box-shadow: inset 0 0 0 2rpx #93c5fd;
}
.session-icon-wrap {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-right: 14rpx;
  flex-shrink: 0;
}
.session-icon {
  font-size: 28rpx;
}
.session-main {
  flex: 1;
  min-width: 0;
}
.session-title {
  font-size: 26rpx;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-meta {
  font-size: 20rpx;
  color: #94a3b8;
  margin-top: 4rpx;
}
.session-del {
  padding: 12rpx;
  color: #94a3b8;
  font-size: 22rpx;
}
.drawer-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid #e2e8f0;
  background: #f8fafc;
}
.user-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #2563eb;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-right: 14rpx;
  flex-shrink: 0;
}
.user-initial {
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1;
}
.user-meta-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.user-name {
  font-size: 26rpx;
  color: #0f172a;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-sub {
  font-size: 20rpx;
  color: #94a3b8;
  margin-top: 2rpx;
}
.user-arrow {
  font-size: 32rpx;
  color: #94a3b8;
}

/* ==================== 态一：工坊首页与底栏 (图 6 风格) ==================== */
.home-desk-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.studio-feature-cards {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 32rpx;
}
.feature-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 24rpx 28rpx;
  background: #ffffff;
  border-radius: 24rpx;
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 4rpx 16rpx rgba(15, 23, 42, 0.04);
}
.feature-card.banner {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 1rpx solid #334155;
}
.feature-card.banner .feat-title {
  color: #f8fafc;
}
.feature-card.banner .feat-sub {
  color: #94a3b8;
}
.feature-card.banner .feat-go {
  color: #60a5fa;
}
.feat-badge {
  font-size: 20rpx;
  font-weight: 700;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  margin-right: 18rpx;
  flex-shrink: 0;
}
.feat-badge.img {
  color: #2563eb;
  background: #eff6ff;
}
.feat-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.feat-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #0f172a;
}
.feat-sub {
  font-size: 22rpx;
  color: #64748b;
  margin-top: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feat-go {
  font-size: 24rpx;
  font-weight: 600;
  color: #2563eb;
  margin-left: 12rpx;
  flex-shrink: 0;
}

/* 首页底栏：快捷胶囊 + 输入框 */
.home-composer {
  flex-shrink: 0;
  background: #ffffff;
  border-top: 1rpx solid #e2e8f0;
  padding: 16rpx 24rpx 0;
}
.quick-pill-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  margin-bottom: 16rpx;
  overflow-x: auto;
}
.quick-desk-pill {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 12rpx 10rpx;
  border-radius: 999rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  white-space: nowrap;
  box-sizing: border-box;
}
.quick-desk-pill:active {
  background: #eff6ff;
  border-color: #bfdbfe;
}
.q-icon {
  font-size: 24rpx;
}
.q-label {
  font-size: 22rpx;
  font-weight: 600;
  color: #334155;
}
.home-ref-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-bottom: 12rpx;
}
.home-attach {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.home-attach-t {
  font-size: 40rpx;
  color: #334155;
  line-height: 1;
}
.home-input-bar {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 14rpx;
  margin-bottom: 12rpx;
}
.home-input-wrap {
  flex: 1;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 28rpx;
  padding: 16rpx 24rpx;
  min-height: 72rpx;
  max-height: 200rpx;
  box-sizing: border-box;
}
.home-main-input {
  width: 100%;
  font-size: 28rpx;
  color: #0f172a;
  min-height: 40rpx;
}
.home-send-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #0f172a;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  flex-shrink: 0;
  line-height: 72rpx;
}
.home-send-btn[disabled] {
  background: #cbd5e1;
}
.home-send-t {
  font-size: 34rpx;
  color: #ffffff;
  font-weight: bold;
}

/* ==================== 态二：沉浸式创作工作台 (图 7~10 规范) ==================== */
.studio-desk-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}
.desk-scroll {
  flex: 1;
  min-height: 0;
}
.desk-canvas-stage {
  padding: 24rpx;
}
/* 纯文生展台 */
.desk-text-stage {
  padding: 12rpx 0;
}
.text-stage-card {
  background: #ffffff;
  border-radius: 28rpx;
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 4rpx 16rpx rgba(15, 23, 42, 0.04);
  padding: 48rpx 36rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.stage-icon-box {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #eff6ff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20rpx;
}
.stage-icon {
  font-size: 44rpx;
}
.stage-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 10rpx;
}
.stage-desc {
  font-size: 24rpx;
  color: #64748b;
  line-height: 1.5;
  margin-bottom: 24rpx;
  max-width: 520rpx;
}
.stage-switch-btn {
  padding: 12rpx 28rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1rpx solid #cbd5e1;
}
.stage-switch-btn:active {
  background: #eff6ff;
  border-color: #93c5fd;
}
.stage-btn-t {
  font-size: 22rpx;
  font-weight: 600;
  color: #2563eb;
}

.desk-big-slot {
  height: 380rpx;
  border-radius: 28rpx;
  border: 3rpx dashed #cbd5e1;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
  box-sizing: border-box;
}
.desk-big-slot:active {
  border-color: #2563eb;
  background: #f0f7ff;
}
.big-plus-box {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20rpx;
}
.big-plus-icon {
  font-size: 48rpx;
  color: #64748b;
  font-weight: 300;
  line-height: 1;
}
.big-slot-hint {
  font-size: 30rpx;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8rpx;
}
.big-slot-sub {
  font-size: 22rpx;
  color: #94a3b8;
}

/* 横向大卡片轮播 (图 9, 10 风格) */
.desk-slider {
  width: 100%;
  white-space: nowrap;
}
.slider-track {
  display: inline-flex;
  flex-direction: row;
  gap: 16rpx;
  padding: 8rpx 0;
}
.desk-card {
  width: 280rpx;
  height: 380rpx;
  border-radius: 24rpx;
  background: #ffffff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 4rpx 16rpx rgba(15, 23, 42, 0.08);
  border: 1rpx solid #e2e8f0;
  flex-shrink: 0;
}
.desk-card-img {
  width: 100%;
  height: 100%;
}
.desk-card-tag {
  position: absolute;
  left: 12rpx;
  top: 12rpx;
  background: rgba(15, 23, 42, 0.65);
  padding: 4rpx 14rpx;
  border-radius: 10rpx;
}
.desk-card-tag-t {
  font-size: 20rpx;
  color: #ffffff;
  font-weight: 600;
}
.desk-card-del {
  position: absolute;
  right: 12rpx;
  top: 12rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}
.del-x {
  font-size: 20rpx;
  color: #ffffff;
  line-height: 40rpx;
  text-align: center;
}
.desk-card-add {
  width: 200rpx;
  height: 380rpx;
  border-radius: 24rpx;
  border: 2rpx dashed #cbd5e1;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.desk-card-add:active {
  border-color: #2563eb;
}
.add-circle {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14rpx;
}
.add-plus {
  font-size: 36rpx;
  color: #64748b;
  line-height: 1;
}
.add-t {
  font-size: 22rpx;
  color: #64748b;
  font-weight: 600;
}

/* 结果卡片 */
.desk-result-tray {
  padding: 0 24rpx 24rpx;
}
.desk-run-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  background: #ffffff;
  padding: 24rpx 28rpx;
  border-radius: 20rpx;
  border: 1rpx solid #bfdbfe;
  box-shadow: 0 4rpx 14rpx rgba(37, 99, 235, 0.08);
}
.desk-spinner {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 5rpx solid #dbeafe;
  border-top-color: #2563eb;
  margin-right: 20rpx;
  animation: spin 1s linear infinite;
  flex-shrink: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.run-text-col {
  display: flex;
  flex-direction: column;
}
.run-h1 {
  font-size: 28rpx;
  font-weight: 700;
  color: #0f172a;
}
.run-h2 {
  font-size: 22rpx;
  color: #64748b;
  margin-top: 4rpx;
}
.desk-fail-card {
  background: #fef2f2;
  border: 1rpx solid #fecaca;
  padding: 24rpx 28rpx;
  border-radius: 20rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.fail-t {
  font-size: 26rpx;
  color: #dc2626;
  flex: 1;
  min-width: 0;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.retry-pill {
  padding: 8rpx 20rpx;
  background: #dc2626;
  border-radius: 999rpx;
  flex-shrink: 0;
  margin-left: 16rpx;
}
.retry-t {
  font-size: 22rpx;
  color: #ffffff;
  font-weight: 600;
}
.desk-success-card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 18rpx;
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 8rpx 24rpx rgba(15, 23, 42, 0.08);
}
.desk-result-image {
  width: 100%;
  border-radius: 16rpx;
}
.desk-result-video {
  width: 100%;
  height: 440rpx;
  border-radius: 16rpx;
  background: #000;
}
.desk-result-audio {
  width: 100%;
}
.desk-actions-bar {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  margin-top: 16rpx;
}
.desk-act-btn {
  flex: 1;
  padding: 14rpx 0;
  background: #eff6ff;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.act-btn-t {
  font-size: 24rpx;
  font-weight: 600;
  color: #2563eb;
}
.desk-scroll-pad {
  height: 32rpx;
}

/* 一体化输入坞 (图 7~10 规范) */
.desk-composer {
  flex-shrink: 0;
  background: #ffffff;
  border-top: 1rpx solid #e2e8f0;
  padding: 18rpx 24rpx 0;
  box-shadow: 0 -4rpx 16rpx rgba(15, 23, 42, 0.04);
}
.desk-ref-section {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-bottom: 12rpx;
}
.desk-ref-tags {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx;
}
.desk-ref-chip {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 4rpx;
  background: #eff6ff;
  border: 1rpx solid #bfdbfe;
  padding: 6rpx 14rpx;
  border-radius: 12rpx;
}
.desk-ref-chip:active {
  background: #dbeafe;
}
.desk-ref-chip.multi {
  background: #fdf4ff;
  border-color: #f0abfc;
}
.desk-ref-chip.multi .chip-name {
  color: #c026d3;
}
.chip-at {
  font-size: 22rpx;
  font-weight: 700;
  color: #2563eb;
}
.chip-name {
  font-size: 22rpx;
  font-weight: 600;
  color: #1d4ed8;
}
.chip-plus {
  font-size: 18rpx;
  color: #3b82f6;
  background: rgba(37, 99, 235, 0.1);
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  margin-left: 4rpx;
}
.quick-prompt-scroll {
  width: 100%;
  white-space: nowrap;
}
.quick-prompt-row {
  display: inline-flex;
  flex-direction: row;
  gap: 10rpx;
  padding: 2rpx 0;
}
.quick-p-item {
  display: inline-flex;
  align-items: center;
  padding: 8rpx 18rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 999rpx;
}
.quick-p-item:active {
  background: #eff6ff;
  border-color: #93c5fd;
}
.quick-p-text {
  font-size: 20rpx;
  color: #475569;
  font-weight: 500;
}
.quick-p-item:active .quick-p-text {
  color: #2563eb;
}

.desk-input-box {
  width: 100%;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 16rpx;
  padding: 12rpx 16rpx;
  margin-bottom: 14rpx;
  box-sizing: border-box;
  min-height: 140rpx;
  cursor: text;
}
.composer-inline-flow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  min-height: 120rpx;
  max-height: 220rpx;
  overflow-y: auto;
  line-height: 1.6;
  padding: 2rpx 0;
  box-sizing: border-box;
}
.flow-text {
  font-size: 26rpx;
  color: #1e293b;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.flow-chip {
  background: #2563eb !important;
  padding: 2rpx 10rpx 2rpx 4rpx !important;
  margin: 2rpx 6rpx !important;
  border-radius: 999rpx !important;
  display: inline-flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 6rpx !important;
  vertical-align: middle !important;
}
.flow-chip .inline-ref-thumb {
  width: 32rpx !important;
  height: 32rpx !important;
  border-radius: 6rpx !important;
}
.flow-chip .inline-ref-label {
  font-size: 20rpx !important;
  color: #ffffff !important;
  font-weight: 600 !important;
}
.flow-chip .inline-ref-x {
  font-size: 20rpx !important;
  color: #bfdbfe !important;
  padding-left: 4rpx !important;
}
.flow-edit-hint {
  font-size: 22rpx;
  color: #94a3b8;
  margin-left: 8rpx;
}

/* @ 联想补全弹层 */
.at-suggest-popup {
  background: #ffffff;
  border: 1rpx solid #cbd5e1;
  border-radius: 18rpx;
  padding: 14rpx 18rpx;
  margin-bottom: 12rpx;
  box-shadow: 0 10rpx 28rpx rgba(15, 23, 42, 0.12);
}
.at-suggest-popup.in-drawer {
  margin-bottom: 16rpx;
  border-color: #93c5fd;
  background: #f8fafc;
}
.at-suggest-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10rpx;
}
.at-suggest-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #64748b;
}
.at-suggest-close {
  font-size: 24rpx;
  color: #94a3b8;
  padding: 4rpx 8rpx;
}
.at-suggest-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}
.at-suggest-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 16rpx;
  background: #eff6ff;
  border: 1rpx solid #bfdbfe;
  border-radius: 12rpx;
}
.at-suggest-item:active {
  background: #dbeafe;
}
.at-suggest-thumb {
  width: 36rpx;
  height: 36rpx;
  border-radius: 8rpx;
}
.at-suggest-name {
  font-size: 22rpx;
  font-weight: 600;
  color: #2563eb;
}

/* 抽屉中的行内混排卡片 */
.drawer-flow-card {
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 16rpx;
  padding: 14rpx 18rpx;
  margin-bottom: 16rpx;
  flex-shrink: 0;
}
.drawer-flow-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  margin-bottom: 8rpx;
}
.drawer-flow-title {
  font-size: 22rpx;
  font-weight: 700;
  color: #475569;
}
.drawer-flow-tip {
  font-size: 20rpx;
  color: #94a3b8;
}
.drawer-flow-body {
  max-height: 180rpx;
  min-height: 60rpx;
}

.opt-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.opt-left-btns {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}
.opt-btn {
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: #eff6ff;
}
.opt-btn.at-btn {
  background: #dbeafe;
  border: 1rpx solid #bfdbfe;
}
.opt-btn.at-btn .opt-btn-t {
  color: #1d4ed8;
}
.opt-btn.undo { background: #f1f5f9; }
.opt-btn.done-edit {
  background: #2563eb;
}
.opt-btn.done-edit .opt-btn-t {
  color: #ffffff;
}
.opt-btn.busy { opacity: 0.5; }
.opt-btn-t { font-size: 22rpx; color: #1d4ed8; font-weight: 600; }

.expand-trigger {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6rpx;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1rpx solid #e2e8f0;
}
.expand-trigger:active {
  background: #e2e8f0;
}
.expand-trigger-icon {
  font-size: 24rpx;
  color: #64748b;
  font-weight: 700;
  line-height: 1;
}
.expand-trigger-t {
  font-size: 20rpx;
  color: #64748b;
  font-weight: 600;
}

.range-row { display: flex; flex-direction: row; align-items: center; gap: 12rpx; }
.range-slider { flex: 1; }
.range-val { font-size: 22rpx; color: #64748b; min-width: 64rpx; }
.sheet-chip.locked { opacity: 0.45; }
.desk-input {
  width: 100%;
  height: 160rpx;
  min-height: 120rpx;
  max-height: 220rpx;
  font-size: 28rpx;
  color: #0f172a;
  line-height: 1.5;
  margin-bottom: 0;
  background: transparent;
  box-sizing: border-box;
  overflow-y: auto;
}

/* 3/4 屏抽屉面板 */
.prompt-drawer-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.65);
  z-index: 999;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.prompt-drawer-sheet {
  width: 100%;
  height: 75vh;
  background: #ffffff;
  border-top-left-radius: 32rpx;
  border-top-right-radius: 32rpx;
  display: flex;
  flex-direction: column;
  padding: 24rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  box-shadow: 0 -12rpx 40rpx rgba(0, 0, 0, 0.2);
}
.prompt-drawer-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 20rpx;
  border-bottom: 1rpx solid #e2e8f0;
  margin-bottom: 20rpx;
  flex-shrink: 0;
}
.prompt-drawer-title-col {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.prompt-drawer-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #0f172a;
}
.prompt-drawer-count {
  font-size: 22rpx;
  color: #94a3b8;
}
.prompt-drawer-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
}
.drawer-act-pill {
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1rpx solid #e2e8f0;
}
.drawer-act-pill.at-btn {
  background: #dbeafe;
  border-color: #bfdbfe;
}
.drawer-act-pill.at-btn .drawer-act-t {
  color: #1d4ed8;
}
.drawer-act-pill.done {
  background: #2563eb;
  border-color: #2563eb;
}
.drawer-act-t {
  font-size: 24rpx;
  color: #475569;
  font-weight: 600;
}
.drawer-act-t.done {
  color: #ffffff;
}
.prompt-drawer-scroll {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
.prompt-drawer-textarea {
  width: 100%;
  height: 100%;
  min-height: 50vh;
  font-size: 30rpx;
  line-height: 1.6;
  color: #0f172a;
  background: transparent;
  box-sizing: border-box;
}
.desk-bottom-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}
.desk-left-capsules {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
}
.desk-capsule {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1rpx solid #e2e8f0;
}
.cap-name {
  font-size: 22rpx;
  font-weight: 600;
  color: #334155;
}
.cap-arrow {
  font-size: 20rpx;
  color: #64748b;
}
.desk-send-btn {
  padding: 14rpx 36rpx;
  border-radius: 999rpx;
  background: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4rpx 12rpx rgba(15, 23, 42, 0.2);
}
.desk-send-btn.disabled {
  background: #cbd5e1;
  box-shadow: none;
}
.desk-send-t {
  font-size: 26rpx;
  font-weight: 700;
  color: #ffffff;
}

/* ==================== 底部参数半屏配置抽屉 (图 7, 8 规范) ==================== */
.param-sheet-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 1001;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.param-sheet {
  background: #ffffff;
  border-radius: 36rpx 36rpx 0 0;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  padding: 24rpx 28rpx;
  box-sizing: border-box;
}
.sheet-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 20rpx;
  border-bottom: 1rpx solid #f1f5f9;
}
.sheet-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #0f172a;
}
.sheet-close-btn {
  font-size: 28rpx;
  font-weight: 700;
  color: #2563eb;
  padding: 8rpx 16rpx;
}
.sheet-scroll {
  flex: 1;
  min-height: 0;
  padding: 16rpx 0;
}
.sheet-sec {
  margin-bottom: 28rpx;
}
.sec-label {
  font-size: 24rpx;
  font-weight: 700;
  color: #64748b;
  margin-bottom: 14rpx;
  display: block;
}
.model-grid-2x2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14rpx;
}
.model-card-item {
  background: #f8fafc;
  border: 2rpx solid #e2e8f0;
  border-radius: 18rpx;
  padding: 16rpx;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.model-card-item.active {
  background: #eff6ff;
  border-color: #2563eb;
}
.m-card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}
.m-card-name {
  font-size: 26rpx;
  font-weight: 700;
  color: #0f172a;
}
.model-card-item.active .m-card-name {
  color: #2563eb;
}
.m-card-badge {
  font-size: 18rpx;
  font-weight: 700;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
}
.m-card-desc {
  font-size: 20rpx;
  color: #94a3b8;
  line-height: 1.4;
}
.polish-hint {
  display: block;
  font-size: 24rpx;
  color: #334155;
  line-height: 1.45;
  margin-top: 8rpx;
}
.polish-at {
  display: block;
  font-size: 20rpx;
  color: #64748b;
  margin-top: 8rpx;
  line-height: 1.4;
}
.mode-seg-row {
  display: flex;
  flex-direction: row;
  background: #f1f5f9;
  border-radius: 16rpx;
  padding: 6rpx;
  gap: 8rpx;
}
.mode-seg-item {
  flex: 1;
  padding: 14rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
}
.mode-seg-item.active {
  background: #ffffff;
  box-shadow: 0 2rpx 8rpx rgba(15, 23, 42, 0.08);
}
.mode-seg-t {
  font-size: 24rpx;
  font-weight: 600;
  color: #64748b;
}
.mode-seg-item.active .mode-seg-t {
  color: #0f172a;
  font-weight: 700;
}
.chip-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}
.sheet-chip {
  padding: 12rpx 28rpx;
  border-radius: 999rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
}
.sheet-chip.active {
  background: #eff6ff;
  border-color: #2563eb;
}
.chip-t {
  font-size: 24rpx;
  color: #475569;
}
.sheet-chip.active .chip-t {
  color: #2563eb;
  font-weight: 600;
}
.sheet-pad {
  height: 48rpx;
}

/* ==================== 抽屉时间分组 ==================== */
.session-group-block {
  margin-bottom: 18rpx;
}
.group-header-label {
  font-size: 22rpx;
  font-weight: 700;
  color: #94a3b8;
  padding: 8rpx 12rpx;
  display: block;
}

/* ==================== 高级超参数面板 ==================== */
.advanced-sec {
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  border-radius: 20rpx;
  padding: 18rpx 20rpx;
  margin-top: 10rpx;
}
.advanced-toggle {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.adv-left {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
}
.adv-icon {
  font-size: 26rpx;
}
.adv-title {
  margin-bottom: 0 !important;
  color: #1e293b !important;
}
.adv-arrow {
  font-size: 22rpx;
  color: #2563eb;
  font-weight: 600;
}
.advanced-body {
  margin-top: 20rpx;
  padding-top: 18rpx;
  border-top: 1rpx solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}
.adv-field {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.adv-label-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.adv-field-label {
  font-size: 22rpx;
  font-weight: 600;
  color: #475569;
}
.adv-field-val {
  font-size: 22rpx;
  font-weight: 700;
  color: #2563eb;
}
.adv-reset-btn {
  font-size: 20rpx;
  color: #64748b;
  text-decoration: underline;
}
.adv-input {
  height: 64rpx;
  background: #ffffff;
  border: 1rpx solid #cbd5e1;
  border-radius: 12rpx;
  padding: 0 16rpx;
  font-size: 24rpx;
  color: #0f172a;
}
.adv-textarea {
  width: 100%;
  height: 120rpx;
  background: #ffffff;
  border: 1rpx solid #cbd5e1;
  border-radius: 12rpx;
  padding: 12rpx 16rpx;
  font-size: 22rpx;
  color: #0f172a;
  box-sizing: border-box;
}

/* ==================== 快捷选图 88vh 高视野抽屉 ==================== */
.quick-picker-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.55);
  z-index: 1002;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.quick-picker-sheet {
  background: #ffffff;
  border-radius: 40rpx 40rpx 0 0;
  height: 88vh;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 24rpx 28rpx 0 28rpx;
  box-sizing: border-box;
}
.picker-head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 16rpx;
  border-bottom: 1rpx solid #f1f5f9;
}
.picker-head-left {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.picker-title {
  font-size: 32rpx;
  font-weight: 800;
  color: #0f172a;
}
.picker-subtitle {
  font-size: 22rpx;
  color: #94a3b8;
}
.picker-close {
  font-size: 36rpx;
  color: #94a3b8;
  padding: 6rpx 12rpx;
}
.picker-actions-row {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  padding: 16rpx 0 12rpx 0;
}
.picker-btn {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  padding: 18rpx 0;
  border-radius: 18rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
}
.picker-btn:active {
  background: #eff6ff;
  border-color: #bfdbfe;
}
.p-btn-icon {
  font-size: 30rpx;
}
.p-btn-text {
  font-size: 24rpx;
  font-weight: 700;
  color: #1e293b;
}

/* 搜索栏与分类胶囊 */
.picker-search-bar {
  padding: 8rpx 0;
}
.p-search-box {
  display: flex;
  flex-direction: row;
  align-items: center;
  background: #f1f5f9;
  border-radius: 999rpx;
  height: 64rpx;
  padding: 0 20rpx;
  gap: 12rpx;
}
.p-search-icon {
  font-size: 26rpx;
  color: #94a3b8;
}
.p-search-input {
  flex: 1;
  font-size: 24rpx;
  color: #0f172a;
}
.p-search-clear {
  font-size: 24rpx;
  color: #94a3b8;
  padding: 6rpx;
}
.picker-category-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 0 16rpx 0;
}
.p-cat-chip {
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
}
.p-cat-chip.active {
  background: #eff6ff;
  border-color: #2563eb;
}
.p-cat-t {
  font-size: 22rpx;
  color: #64748b;
  font-weight: 600;
}
.p-cat-chip.active .p-cat-t {
  color: #2563eb;
  font-weight: 700;
}
.picker-reload-pill {
  width: 56rpx;
  height: 56rpx;
  border-radius: 999rpx;
  background: #f8fafc;
  border: 1rpx solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
}
.p-reload-icon {
  font-size: 28rpx;
  color: #64748b;
}
.p-reload-icon.spinning {
  animation: spin 0.8s linear infinite;
}

/* 素材网格与卡片 */
.picker-images-scroll {
  flex: 1;
  min-height: 0;
}
.picker-loading-box,
.picker-empty {
  padding: 80rpx 20rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}
.p-empty-ico {
  font-size: 64rpx;
}
.p-empty-t {
  font-size: 26rpx;
  font-weight: 600;
  color: #64748b;
}
.p-empty-sub {
  font-size: 22rpx;
  color: #94a3b8;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  padding: 8rpx 0;
}
.picker-card {
  background: #ffffff;
  border-radius: 18rpx;
  overflow: hidden;
  border: 1rpx solid #e2e8f0;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2rpx 8rpx rgba(15, 23, 42, 0.04);
}
.picker-card:active {
  border-color: #2563eb;
  transform: scale(0.98);
}
.picker-img-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: #f1f5f9;
}
.picker-thumb {
  width: 100%;
  height: 100%;
}
.picker-cat-tag {
  position: absolute;
  top: 8rpx;
  left: 8rpx;
  background: rgba(15, 23, 42, 0.65);
  color: #ffffff;
  font-size: 18rpx;
  font-weight: 600;
  padding: 2rpx 8rpx;
  border-radius: 6rpx;
  backdrop-filter: blur(4px);
}
.picker-card-info {
  padding: 8rpx 10rpx;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}
.picker-card-name {
  font-size: 20rpx;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-card-tag {
  font-size: 18rpx;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.picker-scroll-pad {
  height: 60rpx;
}
.portrait-lib {
  padding: 8rpx 8rpx 24rpx;
}
.portrait-consent {
  margin-top: 20rpx;
  padding: 24rpx;
  background: #fff7ed;
  border: 1rpx solid #fed7aa;
  border-radius: 16rpx;
}
.portrait-warn {
  display: block;
  font-size: 26rpx;
  line-height: 1.6;
  color: #9a3412;
  margin-bottom: 16rpx;
}
.portrait-new-row,
.portrait-group-head,
.portrait-asset,
.portrait-pick-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 12rpx;
}
.portrait-new-row {
  margin: 20rpx 0;
}
.portrait-name-input {
  flex: 1;
  height: 72rpx;
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  border-radius: 12rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
}
.portrait-group {
  background: #ffffff;
  border: 1rpx solid #e2e8f0;
  border-radius: 16rpx;
  padding: 20rpx;
  margin-bottom: 16rpx;
}
.portrait-group-name {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: #0f172a;
}
.portrait-link {
  font-size: 24rpx;
  color: #dc2626;
}
.portrait-asset-row {
  margin-top: 12rpx;
}
.portrait-asset {
  background: #f8fafc;
  border-radius: 12rpx;
  padding: 12rpx 16rpx;
  margin-bottom: 12rpx;
}
.portrait-asset-name,
.portrait-status,
.portrait-err,
.portrait-pick-label,
.portrait-caption,
.portrait-chip-t {
  font-size: 24rpx;
  color: #334155;
}
.portrait-status.Active {
  color: #059669;
}
.portrait-status.Failed,
.portrait-err {
  color: #dc2626;
}
.portrait-status.Processing {
  color: #d97706;
}
.portrait-err {
  width: 100%;
}
.portrait-pick {
  padding: 4rpx 8rpx 12rpx;
}
.portrait-caption,
.portrait-pick-label {
  display: block;
  line-height: 1.5;
  color: #64748b;
}
.portrait-chip {
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: #f1f5f9;
  border: 1rpx solid transparent;
}
.portrait-chip.on {
  background: #eff6ff;
  border-color: #bfdbfe;
}
</style>

