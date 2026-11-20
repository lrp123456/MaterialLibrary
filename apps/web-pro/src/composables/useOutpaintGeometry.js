/**
 * 组合式 API 3：扩图几何计算与画布自适应 (useOutpaintGeometry)
 * 职责：
 *  - 计算目标画幅比例扩展边距（left, right, top, bottom）
 *  - 归一化坐标换算与画布视口自适应
 *  - 注册窗口 resize 监听器，并在 onScopeDispose 时自动解绑
 */
import { ref, computed, onMounted, onScopeDispose } from 'vue';

export function useOutpaintGeometry(sourceMeta = ref({ width: 1024, height: 1024 })) {
  const targetRatio = ref('16:9'); // '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
  const customPadding = ref({ left: 0, right: 0, top: 0, bottom: 0 });
  const viewportWidth = ref(window?.innerWidth || 1280);

  const parsedRatio = computed(() => {
    const parts = targetRatio.value.split(':').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
      return parts[0] / parts[1];
    }
    return 16 / 9;
  });

  const calculatedGeometry = computed(() => {
    const w = sourceMeta.value.width || 1024;
    const h = sourceMeta.value.height || 1024;
    const currentRatio = w / h;
    const desired = parsedRatio.value;

    let targetW = w;
    let targetH = h;
    let padX = 0;
    let padY = 0;

    if (desired > currentRatio) {
      // 需要在左右两侧扩展
      targetW = Math.round(h * desired);
      padX = Math.round((targetW - w) / 2);
    } else if (desired < currentRatio) {
      // 需要在上下两侧扩展
      targetH = Math.round(w / desired);
      padY = Math.round((targetH - h) / 2);
    }

    return {
      targetWidth: targetW,
      targetHeight: targetH,
      padding: {
        left: customPadding.value.left || padX,
        right: customPadding.value.right || padX,
        top: customPadding.value.top || padY,
        bottom: customPadding.value.bottom || padY,
      },
      normalizedRect: {
        x: padX / targetW,
        y: padY / targetH,
        w: w / targetW,
        h: h / targetH,
      },
    };
  });

  const handleResize = () => {
    viewportWidth.value = window.innerWidth;
  };

  onMounted(() => {
    window.addEventListener('resize', handleResize);
  });

  onScopeDispose(() => {
    window.removeEventListener('resize', handleResize);
  });

  return {
    targetRatio,
    customPadding,
    calculatedGeometry,
  };
}
