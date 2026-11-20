/**
 * 材质入库视觉预填模块
 * 调用 chatVision 分析 1K 底色贴图，输出中文品名、装修面/子类标签、平铺色卡合规探测
 */

const { isValidSurface, isValidSubclass } = require('./taxonomy');

const PREFILL_PROMPT = `你是一名专业室内设计材质治理专家。请分析输入的材质贴图图片（及附带的元数据），返回纯 JSON 对象（不要 markdown 代码块）：
{
  "name_cn": "准确凝练的中文材质品名，如：意式深胡桃木地板、浅灰微水泥艺术漆、哑光大理石岩板",
  "tags": [
    { "surface": "ceiling|wall|floor|millwork|furniture|soft", "subclass": "合法子类键" }
  ],
  "is_flat_swatch": true或者false,
  "reject_reason": "若 is_flat_swatch 为 false，说明原因（例如包含窗户透视、整件家具构件、硬阴影、房间实景照片等，不属于均匀平铺材质）"
}
约束：
1. 装修面 surface 必须为 ceiling, wall, floor, millwork, furniture, soft 之一。
2. subclass 必须为合法的预定义键（如 floor_wood, floor_stone, wall_paint, wall_paper, wall_paneling, wall_tile, ceiling_paint, ceiling_panel, millwork_door, soft_fabric 等）。非法标签必须剔除。
3. 若图片是包含透视、硬阴影、大范围室内空间、整件家具的实景照片而非正射均匀材质平铺贴图，is_flat_swatch 必须标为 false。`;

async function prefillMaterialVision(imageBuffer, { title = '', source = '', tags = [] } = {}) {
  try {
    const { chatVision } = require('../vlm');
    const base64 = imageBuffer.toString('base64');
    const userPrompt = `${PREFILL_PROMPT}\n\n参考元数据: 标题: ${title}, 来源: ${source}, 标签: ${tags.join(', ')}`;

    const respText = await chatVision([
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }
    ], { model: 'workflow_vision' });

    let jsonStr = respText.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    }
    const parsed = JSON.parse(jsonStr);

    const validTags = [];
    if (Array.isArray(parsed.tags)) {
      for (const t of parsed.tags) {
        if (t && isValidSurface(t.surface) && isValidSubclass(t.subclass)) {
          validTags.push({ surface: t.surface, subclass: t.subclass });
        }
      }
    }

    return {
      success: true,
      name_cn: (parsed.name_cn || '').trim(),
      tags: validTags,
      is_flat_swatch: parsed.is_flat_swatch !== false,
      reject_reason: parsed.reject_reason || ''
    };
  } catch (e) {
    return {
      success: false,
      name_cn: '',
      tags: [],
      is_flat_swatch: true, // 调用失败不当成房间照片
      reject_reason: '',
      error: e.message
    };
  }
}

module.exports = {
  prefillMaterialVision
};
