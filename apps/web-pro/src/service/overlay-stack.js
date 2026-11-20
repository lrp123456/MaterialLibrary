/**
 * 全局浮层栈（web-pro 桌面端）
 *
 * 存在的原因：这个 SPA 没有 router、没有 Pinia，二十多个弹窗/抽屉各自用
 * 独立的 ref(v-if) 控制，四套 window keydown 监听靠 else-if 链互相谦让。
 * 结果是「左上角返回」「浏览器返回」「ESC」都无法可靠地先关掉最上层浮层。
 *
 * 这里提供一层 LIFO 栈：组件把控制显隐的 ref 交给 bindOverlays() 登记，
 * 统一入口（App.vue 的 handleGlobalBack）只调 closeTop() 即可。
 *
 * 注意：登录弹窗、崩溃屏障、版本更新提示是「功能性 fixed 层」，不应入栈，
 * 否则用户会把登录框关掉后停留在一屏破图上。
 */
import { watch, isRef } from 'vue';

// 模块级单例：所有组件共享同一个栈。数组尾部 = 栈顶 = 视觉上最上层的浮层。
const stack = [];

function register({ id, close, priority = 0 }) {
  if (!id || typeof close !== 'function') return;
  const existing = stack.findIndex((item) => item.id === id);
  if (existing >= 0) stack.splice(existing, 1);
  const entry = { id, close, priority: Number(priority) || 0 };
  // 同优先级保持「后开先关」；显式声明了更高 priority 的浮层排在栈顶。
  const pos = stack.findIndex((item) => item.priority > entry.priority);
  if (pos < 0) stack.push(entry);
  else stack.splice(pos, 0, entry);
}

function unregister(id) {
  const idx = stack.findIndex((item) => item.id === id);
  if (idx >= 0) stack.splice(idx, 1);
}

function hasOverlays() {
  return stack.length > 0;
}

function closeTop() {
  const top = stack.pop();
  if (!top) return false;
  try {
    top.close();
  } catch (e) {
    console.warn('[overlay-stack] 关闭浮层失败:', top.id, e);
  }
  return true;
}

/**
 * 批量登记。用法（每个组件通常只要这两行）：
 *
 *   import { bindOverlays } from '../service/overlay-stack.js';
 *   bindOverlays({ assetDetail: activeModalAsset, filter: filterOpen }, { prefix: 'library:' });
 *
 * 值可以是：
 *   - ref               → 关闭时自动置 false（布尔）或 null（对象型 ref）
 *   - { ref, close }    → 用自定义关闭函数（对象型弹窗、需要先清子状态时用）
 *   - { ref, priority } → 声明层级，数值越大越先被返回键关闭
 *
 * 返回的 unsubscribe 会停掉全部 watch；组件卸载时建议调用。
 */
function bindOverlays(refsMap, options = {}) {
  const prefix = options.prefix || '';
  const stops = [];
  for (const [key, raw] of Object.entries(refsMap || {})) {
    const refObj = raw && raw.ref ? raw.ref : raw;
    if (!isRef(refObj)) continue;
    const id = `${prefix}${key}`;
    const customClose = raw && raw.ref && typeof raw.close === 'function' ? raw.close : null;
    const priority = raw && raw.ref ? Number(raw.priority) || 0 : 0;
    const doClose = customClose || (() => {
      refObj.value = typeof refObj.value === 'boolean' ? false : null;
    });

    // sync：closeTop() 里 pop 之后立即把 ref 置回，watch 同步触发 unregister，
    // 不会拖到下一个 tick 误删刚入栈的同名浮层。
    const stop = watch(refObj, (open) => {
      if (open) register({ id, close: doClose, priority });
      else unregister(id);
    }, { immediate: true, flush: 'sync' });
    stops.push(stop);
  }
  return () => {
    for (const stop of stops) stop();
    for (const key of Object.keys(refsMap || {})) unregister(`${prefix}${key}`);
  };
}

function clearOverlays() {
  stack.length = 0;
}

export const overlayStack = { register, unregister, hasOverlays, closeTop, clearOverlays };
export { register, unregister, hasOverlays, closeTop, clearOverlays, bindOverlays };
export default overlayStack;
