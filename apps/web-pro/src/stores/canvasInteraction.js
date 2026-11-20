/**
 * 领域 Store 3：精准编辑画布几何交互 (Canvas Interaction Store)
 * 职责：
 *  - 集中管理 BBox / Polygon / Brush / Outpaint 等归一化几何坐标状态
 *  - 画布视口缩放 (Zoom) 与平移 (Pan) 矩阵
 *  - 当前交互工具模式 ('crop' | 'bbox' | 'polygon' | 'brush' | 'outpaint')
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useCanvasInteractionStore = defineStore('canvasInteraction', () => {
  const activeTool = ref('crop'); // 'crop' | 'bbox' | 'polygon' | 'brush' | 'outpaint'
  const isDrawing = ref(false);

  // 归一化几何数据 (0.0 ~ 1.0)
  const normalizedBbox = ref(null); // { x: 0, y: 0, w: 1, h: 1 }
  const polygonPoints = ref([]); // [{ x, y }]
  const brushStrokes = ref([]); // [{ points: [{x, y}], size: number }]

  // 扩图设置
  const outpaintConfig = ref({
    ratio: '16:9',
    expandLeft: 0,
    expandRight: 0,
    expandTop: 0,
    expandBottom: 0,
    prompt: '',
  });

  // 画布视口变换
  const zoom = ref(1.0);
  const pan = ref({ x: 0, y: 0 });

  function setTool(tool) {
    activeTool.value = tool;
  }

  function setNormalizedBbox(bbox) {
    normalizedBbox.value = bbox ? { ...bbox } : null;
  }

  function setPolygonPoints(pts) {
    polygonPoints.value = Array.isArray(pts) ? [...pts] : [];
  }

  function addBrushStroke(stroke) {
    if (stroke && stroke.points && stroke.points.length) {
      brushStrokes.value.push(stroke);
    }
  }

  function setOutpaintConfig(cfg) {
    outpaintConfig.value = { ...outpaintConfig.value, ...cfg };
  }

  function resetGeometry() {
    normalizedBbox.value = null;
    polygonPoints.value = [];
    brushStrokes.value = [];
    isDrawing.value = false;
  }

  function resetViewport() {
    zoom.value = 1.0;
    pan.value = { x: 0, y: 0 };
  }

  return {
    activeTool,
    isDrawing,
    normalizedBbox,
    polygonPoints,
    brushStrokes,
    outpaintConfig,
    zoom,
    pan,
    setTool,
    setNormalizedBbox,
    setPolygonPoints,
    addBrushStroke,
    setOutpaintConfig,
    resetGeometry,
    resetViewport,
  };
});
