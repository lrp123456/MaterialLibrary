/**
 * 组合式 API 5：WebGPU / 2D Canvas 实时增强视口预览 (useWebGpuPreview)
 * 职责：
 *  - 探测浏览器 WebGPU / Canvas2D 渲染上下文
 *  - 驱动视频/图片实时滤镜与效果预览管线
 *  - 注册与取消 rAF 动画帧，onScopeDispose 时安全销毁 GPU 资源与事件
 */
import { ref, onMounted, onScopeDispose } from 'vue';

export function useWebGpuPreview(canvasRef) {
  const isWebGpuSupported = ref(false);
  const isRunning = ref(false);
  let animationFrameId = null;
  let gpuDevice = null;

  async function initContext() {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          gpuDevice = await adapter.requestDevice();
          isWebGpuSupported.value = true;
        }
      } catch (e) {
        console.warn('[WebGPU] 不可用，降级至 Canvas2D:', e.message);
      }
    }
  }

  function startPreviewLoop(renderFrame) {
    if (isRunning.value) return;
    isRunning.value = true;

    function loop() {
      if (!isRunning.value) return;
      if (typeof renderFrame === 'function') {
        try {
          renderFrame(canvasRef?.value, gpuDevice);
        } catch (_) {}
      }
      animationFrameId = requestAnimationFrame(loop);
    }

    loop();
  }

  function stopPreviewLoop() {
    isRunning.value = false;
    if (animationFrameId != null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  onMounted(() => {
    initContext();
  });

  onScopeDispose(() => {
    stopPreviewLoop();
    if (gpuDevice && typeof gpuDevice.destroy === 'function') {
      try { gpuDevice.destroy(); } catch (_) {}
      gpuDevice = null;
    }
  });

  return {
    isWebGpuSupported,
    isRunning,
    startPreviewLoop,
    stopPreviewLoop,
  };
}
