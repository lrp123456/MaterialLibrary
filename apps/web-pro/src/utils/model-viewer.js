/**
 * @google/model-viewer 单例加载器
 *
 * <model-viewer> 是自定义元素：只有 import 过 @google/model-viewer（副作用注册
 * customElements）后标签才生效。历史上仅 StudioEditLayer 会动态 import，
 * 冷导航直接打开含 <model-viewer> 的页面（如素材库 3D 单品、QuickStudio）时
 * 元素未注册 → 3D 区域空白，必须本会话先开过编辑层才「碰巧可用」。
 *
 * 所有用到 <model-viewer> 的组件在挂载时调用 ensureModelViewer()：
 *  - 全仓只产生一次动态 import（vendor-model-viewer 独立 chunk，按需加载）；
 *  - import 成功前已存在的 <model-viewer> 标签会在注册时自动 upgrade。
 */
let loaderPromise = null;

export function isModelViewerReady() {
  return typeof window !== 'undefined'
    && !!window.customElements
    && !!window.customElements.get('model-viewer');
}

export function ensureModelViewer() {
  if (typeof window === 'undefined' || !window.customElements) {
    return Promise.resolve(false);
  }
  if (window.customElements.get('model-viewer')) {
    return Promise.resolve(true);
  }
  if (!loaderPromise) {
    loaderPromise = import('@google/model-viewer')
      .then(() => {
        const ok = !!window.customElements.get('model-viewer');
        if (!ok) console.warn('@google/model-viewer 加载完成但未注册 model-viewer 元素');
        return ok;
      })
      .catch((err) => {
        // 允许重试：网络抖动导致 chunk 加载失败后不应永久卡死
        loaderPromise = null;
        console.warn('Failed to load @google/model-viewer:', err);
        return false;
      });
  }
  return loaderPromise;
}
