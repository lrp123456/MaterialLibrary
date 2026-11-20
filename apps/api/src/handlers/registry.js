/**
 * 快捷操作能力注册表 (Quick Actions Registry)
 * 规则：
 * 1. 登记六种单图操作 + 空间漫游。
 * 2. 就绪条件 (ready) 基于本地 handler 与执行器配置，彻底解绑 KX2BFK_umbra_quick 模板。
 * 3. 客户端只问服务端有哪些操作、缺什么配置 (missingConfig)。
 * 4. 扩展时：只改提示词，加一条预设；输入种类或执行器变了，才加一个 handler。
 */

const { findImageAdapter, findSeedanceAdapter } = require('./adapter-io');
const { imagexReady, resolveImagexConfig } = require('./veimagex-expand');

function imageReady(db) {
  if (findImageAdapter(db)) return { ready: true, missingConfig: null };
  return { ready: false, missingConfig: '未配置图像适配器 ark_seedream 或 agnes_image' };
}

const QUICK_ACTIONS = [
  {
    id: 'expand',
    label: '扩图',
    type: 'single_image',
    description: '目标比例 16:9、9:16、1:1、4:3、3:4，原图保存在正中，专用扩图接口',
    fields: [
      { key: 'expand_ratio', label: '目标比例', type: 'enum', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], default: '16:9' },
    ],
    needsSelection: false,
    pastebackSupport: false,
    executorCheck: (db) => {
      if (imagexReady(resolveImagexConfig({ db }))) return { ready: true, missingConfig: null };
      return { ready: false, missingConfig: '未配置 veImageX（VOLC_ACCESSKEY / VOLC_SECRETKEY / IMAGEX_SERVICE_ID）' };
    }
  },
  {
    id: 'enhance',
    label: '清晰度',
    type: 'single_image',
    description: '两个操作：手机 4 倍 (端侧轻量推理) 与云端重绘 (整图替换)',
    fields: [
      { key: 'target', label: '模式', type: 'enum', options: ['local_4x', 'cloud_redraw'], default: 'local_4x' }
    ],
    needsSelection: false,
    pastebackSupport: false,
    executorCheck: (db) => imageReady(db),
  },
  {
    id: 'watermark',
    label: '去水印',
    type: 'single_image',
    description: '手动画框或四点选区，语义擦除水印文字并补齐背景，默认贴回可关',
    fields: [],
    needsSelection: true,
    pastebackSupport: true,
    defaultPasteback: true,
    executorCheck: (db) => imageReady(db),
  },
  {
    id: 'remove',
    label: '删',
    type: 'single_image',
    description: '手动画框或四点选区，原位消除物体并修补背景，默认贴回可关',
    fields: [],
    needsSelection: true,
    pastebackSupport: true,
    defaultPasteback: true,
    executorCheck: (db) => imageReady(db),
  },
  {
    id: 'insert',
    label: '增',
    type: 'single_image',
    description: '选区 + 带二维图单品 (模式 B 默认，可选模式 C)，像素锁死，外扩 12% 强制贴回',
    fields: [
      { key: 'mode', label: '模式', type: 'enum', options: ['B', 'C'], default: 'B' },
      { key: 'product_fid', label: '二维单品', type: 'string', required: true }
    ],
    needsSelection: true,
    pastebackSupport: false, // 强制贴回，不可关闭
    forcePasteback: true,
    needsGlb: false,
    needs2DProduct: true,
    executorCheck: (db) => imageReady(db),
  },
  {
    id: 'replace',
    label: '改',
    type: 'single_image',
    description: '选区 + 带 GLB 单品，滑杆转模型朝向，固定机位参考图 (45°/85°)，默认贴回可关',
    fields: [
      { key: 'glb_fid', label: 'GLB 3D单品', type: 'string', required: true },
      { key: 'yaw', label: '模型朝向角', type: 'number', min: 0, max: 360, default: 0 }
    ],
    needsSelection: true,
    pastebackSupport: true,
    defaultPasteback: true,
    needsGlb: true,
    needs2DProduct: false,
    executorCheck: (db) => imageReady(db),
  },
  {
    id: 'spatial_walkthrough',
    label: '漫游',
    type: 'multi_image',
    description: '2-6 张实拍空间图，两步确认：拓扑连接示意图确认 -> 镜头顺序与风格确认 -> Seedance 渲染',
    fields: [
      { key: 'photo_fids', label: '空间照片(2-6张)', type: 'array', min: 2, max: 6, required: true },
      { key: 'aspect_ratio', label: '视频画幅', type: 'enum', options: ['16:9', '9:16'], default: '16:9' },
      { key: 'duration_per_shot', label: '单段时长(秒)', type: 'number', default: 4 },
      { key: 'style', label: '运镜风格', type: 'string', default: '平稳向前推进' }
    ],
    needsSelection: false,
    executorCheck: (db) => {
      if (findSeedanceAdapter(db)) return { ready: true, missingConfig: null };
      return { ready: false, missingConfig: '未配置视频适配器 ark_seedance' };
    }
  }
];

function getCapabilities(db) {
  return QUICK_ACTIONS.map(action => {
    const check = action.executorCheck ? action.executorCheck(db) : { ready: true, missingConfig: null };
    return {
      id: action.id,
      label: action.label,
      type: action.type,
      description: action.description,
      fields: action.fields,
      needsSelection: action.needsSelection,
      pastebackSupport: action.pastebackSupport,
      forcePasteback: action.forcePasteback,
      needsGlb: action.needsGlb,
      needs2DProduct: action.needs2DProduct,
      ready: check.ready,
      missingConfig: check.missingConfig,
    };
  });
}

module.exports = {
  QUICK_ACTIONS,
  getCapabilities,
  getQuickCapabilities: getCapabilities,
};
