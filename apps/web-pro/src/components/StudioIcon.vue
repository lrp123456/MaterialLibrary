<template>
  <span
    :class="['studio-icon-wrap inline-flex items-center justify-center shrink-0 cursor-inherit select-none', customClass]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    :title="title || undefined"
  >
    <MorphIcon
      :icon="activePath"
      :size="size"
      :color="color || 'currentColor'"
      :spring="spring || 'smooth'"
      :reduced-motion="reducedMotion || 'user'"
    />
  </span>
</template>

<script setup>
import { computed, ref } from 'vue';
import { MorphIcon } from 'morphicons/vue';

const props = defineProps({
  name: { type: String, required: true },
  hoverName: { type: String, default: '' },
  hoverMorph: { type: Boolean, default: false },
  size: { type: [Number, String], default: 18 },
  color: { type: String, default: '' },
  customClass: { type: String, default: '' },
  title: { type: String, default: '' },
  spring: { type: [String, Object], default: 'smooth' }, // 'smooth' | 'snappy' | 'bouncy' | { stiffness, damping }
  reducedMotion: { type: String, default: 'user' }, // 'never' | 'user' | 'always'
});

// 默认高频动效形变对定义 (Hover 或状态切换时平滑变幻)
const DEFAULT_MORPH_PAIRS = {
  wand: 'sparkles',
  sparkles: 'wand',
  play: 'pause',
  pause: 'play',
  chevronRight: 'chevronDown',
  chevronDown: 'chevronUp',
  chevronUp: 'chevronDown',
  chevronLeft: 'chevronDown',
  edit: 'check',
  plus: 'check',
  maximize: 'minimize',
  minimize: 'maximize',
  copy: 'check',
  settings: 'sliders',
  lock: 'unlock',
  unlock: 'lock',
  eye: 'eyeOff',
  eyeOff: 'eye',
  undo: 'rotateRight',
  moon: 'sun',
  sun: 'moon',
};

// 常见别名映射
const ALIASES = {
  'maximize-2': 'maximize',
  'alert': 'warning',
  'delete': 'trash',
  'x': 'close',
  'magnifier': 'search',
  'redo': 'rotateRight',
  'unfold': 'chevronsUpDown',
  'lock-closed': 'lock',
  'magic': 'wand',
  'question': 'help',
  'box': 'cube',
};

// 标准 24x24 视口核心矢量动效图标库路径定义
const ICONS = {
  // wand 魔法棒
  wand: 'M14.7 6.3a1 1 0 0 0 0 1.4l2 2a1 1 0 0 0 1.4 0l3.6-3.6a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-3.6 3.6zm-1.4 2.8L3.6 18.8a1 1 0 0 0 0 1.4l1.2 1.2a1 1 0 0 0 1.4 0L15.9 11.7l-2.6-2.6zM2 2l1.5 1.5M7 2L5.5 3.5M2 7l1.5-1.5',
  // sparkles 闪烁/AI
  sparkles: 'm12 3-1.9 4.8L5.3 9.7l3.9 3.5-1.2 5.1L12 15.6l4 2.7-1.2-5.1 3.9-3.5-4.8-1.9L12 3zm7-1 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L16 5l2.2-.8L19 2zM5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8L5 16z',
  // video 视频
  video: 'M15 8v8H5a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h10zm4-1.5v11l-3-2.5V9l3-2.5z',
  // image 图片
  image: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5l4.5-6 3.5 4.5 2.5-3 3.5 4.5zM8.5 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  // music 音乐
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  // search 搜索
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  // sliders 调节/参数
  sliders: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6',
  // edit 铅笔/编辑
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  // chat 对话
  chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  // mic 麦克风
  mic: 'M12 15a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v7a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z',
  // grid 网格
  grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  // history 历史
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 7 7 6.97 6.97 0 0 1-5-2.14l-1.42 1.42A8.96 8.96 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  // settings 设置
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  // plus 加号
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  // check 对勾
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  // close 关闭
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  // play 播放
  play: 'M8 5v14l11-7z',
  // pause 暂停
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  // upload 上传
  upload: 'M5 20h14v-2H5v2zm0-10h4v6h6v-6h4l-7-7-7 7z',
  // download 下载
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  // copy 复制
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  // trash 垃圾桶
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  // refresh 刷新
  refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  // send 发送
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  // tag 标签
  tag: 'M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z',
  // building 建筑
  building: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z',
  // sofa 沙发/室内
  sofa: 'M20 9V6c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v3c-1.1 0-2 .9-2 2v5c0 1.1.9 2 2 2v1c0 .55.45 1 1 1s1-.45 1-1v-1h12v1c0 .55.45 1 1 1s1-.45 1-1v-1c1.1 0 2-.9 2-2v-5c0-1.1-.9-2-2-2zm-2 0H6V6h12v3zm2 7H4v-5h16v5z',
  // shirt 服装
  shirt: 'M12 4l3 2 4-2-2 6-2-1v11H9V9L7 10 5 4l4 2 3-2z',
  // user 人像
  user: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  // star 收藏/星标
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  a11y: 'M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 9h4l1.2 2.2L8 18h2v4h2v-4h0l1.2-4.2L16 18h2l-1.5-7H20v-2H4v2zm7 2.2V20h2v-8.2l-1-.6-1 .6z',
  // arrowUp 向上
  arrowUp: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  // arrowDown 向下
  arrowDown: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
  // arrowRight 右向
  arrowRight: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z',
  // arrowLeft 左向
  arrowLeft: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  // chevronDown 下拉
  chevronDown: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z',
  // chevronRight 右拉
  chevronRight: 'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z',
  // chevronLeft 左拉
  chevronLeft: 'M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z',
  // chevronUp 向上折叠
  chevronUp: 'M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z',
  // chevronsUpDown 时间轴双向展开
  chevronsUpDown: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  // maximize 全屏/放大
  maximize: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  // minimize 还原/收缩
  minimize: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z',
  // paperclip 附件
  paperclip: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  // camera 运镜/镜头
  camera: 'M9.4 4l-1.8 2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-3.6l-1.8-2h-5.2zm2.6 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
  // volume 音量/音频
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
  // film 胶卷/影视
  film: 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z',
  // palette 调色板/风格
  palette: 'M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.21-.64-1.67-.08-.1-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 8 6.5 8s1.5.67 1.5 1.5S7.33 11 6.5 11zm3-4C8.67 7 8 6.33 8 5.5S8.67 4 9.5 4s1.5.67 1.5 1.5S10.33 7 9.5 7zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 4 14.5 4s1.5.67 1.5 1.5S15.33 7 14.5 7zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 8 17.5 8s1.5.67 1.5 1.5S18.33 11 17.5 11z',
  // eye 眼睛
  eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
  // eyeOff 隐藏/闭眼
  eyeOff: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.44-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z',
  // crop 裁剪
  crop: 'M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z',
  // square 矩形框
  square: 'M3 3h18v18H3V3zm2 2v14h14V5H5z',
  // type 文字
  type: 'M5 4v3h5.5v12h3V7H19V4H5z',
  // eraser 橡皮擦/去除
  eraser: 'M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.5H2v-4.24l9.29-9.29 4.95-3.41zm-6.7 13.94l6.36-6.36-2.83-2.83-6.36 6.36 2.83 2.83z',
  // undo 撤回
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  // pointer 鼠标指针/选择
  pointer: 'M9 3l10 9-4.5.5 3.5 6-2 1.2-3.5-6L9 16V3z',
  // layers 多图层/多点
  layers: 'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  // rotateRight 重做/右转
  rotateRight: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  // rotateLeft 左转
  rotateLeft: 'M5.6 10.6C7.45 8.99 9.85 8 12.5 8c4.65 0 8.58 3.03 9.96 7.22L20.1 16c-1.05-3.19-4.05-5.5-7.6-5.5-1.95 0-3.73.72-5.12 1.88L11 16H2V7l3.6 3.6z',
  // move 移动/位移/十字方向标
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  // cloud 云端/同步
  cloud: 'M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z',
  // scan 扫描/取景/标定
  scan: 'M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2m-10 0H5a2 2 0 0 1-2-2v-2m4-5h10',
  // lock 锁定
  lock: 'M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM9 8V6a3 3 0 0 1 6 0v2H9z',
  // unlock 解锁
  unlock: 'M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM9 6a3 3 0 0 1 6 0v2H9V6z',
  // warning 警告
  warning: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-7h-2v5h2v-5z',
  // info 信息提示
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  // filter 筛选
  filter: 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z',
  // folder 文件夹
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  // archive 入库
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.82-1h12.12l.94 1H5.12z',
  // link 链接
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  // externalLink 外链
  externalLink: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  // moon 暗黑模式/月亮
  moon: 'M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z',
  // sun 明朗模式/太阳
  sun: 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1z',
  // help 帮助/问号
  help: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 11.9 12 12.5 12 14h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z',
  // cube 立方体/模型
  cube: 'M21 16.5l-9 5.25-9-5.25V7.5l9-5.25 9 5.25v9zM12 2.25L3 7.5l9 5.25 9-5.25-9-5.25zM12 12.75v9',
  // database 数据库/知识库
  database: 'M21 5c0 1.66-4.03 3-9 3S3 6.66 3 5s4.03-3 9-3 9 1.34 9 3zm0 7c0 1.66-4.03 3-9 3s-9-1.34-9-3m0 7c0 1.66-4.03 3-9 3s-9-1.34-9-3M3 5v14M21 5v14',
  // default circle 兜底圆形
  circle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'
};

const isHovered = ref(false);

const canonicalName = computed(() => {
  const n = props.name || 'circle';
  return ALIASES[n] || n;
});

const effectiveName = computed(() => {
  if (isHovered.value) {
    if (props.hoverName) {
      const hn = props.hoverName;
      return ALIASES[hn] || hn;
    }
    const cName = canonicalName.value;
    if (props.hoverMorph && DEFAULT_MORPH_PAIRS[cName]) {
      return DEFAULT_MORPH_PAIRS[cName];
    }
  }
  return canonicalName.value;
});

const activePath = computed(() => {
  return ICONS[effectiveName.value] || ICONS[canonicalName.value] || ICONS.circle;
});

function onMouseEnter() {
  if (props.hoverName || props.hoverMorph) {
    isHovered.value = true;
  }
}

function onMouseLeave() {
  if (isHovered.value) {
    isHovered.value = false;
  }
}
</script>
