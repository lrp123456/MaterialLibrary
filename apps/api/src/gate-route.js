/**
 * 闸门按种类入库。种类已是保留类时，忽略 is_material=false。
 * 回收站捞回只用已经记下的种类和原文，不再调用视觉模型。
 */

const KEEP_CATEGORIES = ['interior', 'exterior', 'furniture', 'clothing', 'portrait', 'finished'];
const RESTAGE_CATEGORIES = new Set(['interior', 'exterior']);
const MANUAL_CATEGORIES = new Set(['clothing', 'portrait', 'finished']);

const CLOTH_RE = /服装|穿搭|服饰|裙子|衣服|上衣|套装/;
const PORTRAIT_RE = /人像|自拍|肖像|证件照|头像/;

const GATE_PROMPT = `你是素材库分拣员。看图后只返回 JSON，不要解释。
先看主体占不占满画面，再选种类。不要因为这张图是截图就拒绝。
画面的大部分是房间、建筑、服装穿搭或单品本身，就按对应种类留下。手机截下的视频画面，只要主体仍占画面的大部分，状态栏、播放进度条、暂停图标或一条细边都保留原种类。轻微水印、签名同样不改变种类。
房间、建筑、服装或单品只是嵌在另一张画面里的一小块，四周主要是按钮、列表、标题、页面或大块衬底时，归 none。不要因为里面嵌着一张室内或穿搭小图就保留。
种类只允许这些值：
- interior：室内空间全景或效果图（客厅、卧室、餐厅、厨房、卫浴、书房、商业空间）
- exterior：建筑外观、庭院、泳池、露台、景观
- furniture：家具、灯具、软装单品。布料、石材、木皮只有能看成一件独立家具时才归这里
- clothing：服装单品、模特穿搭展示、裙装、上衣、裤装、套装。包括：平摊、衣架挂拍、假人模特拍，以及真人穿搭展示。
  【重要互斥规则】：只要画面主要在展示衣服/穿搭搭配，或者人物【脸部不可见、头部截去、五官被涂抹打码、背影、低头挡脸、无清晰完整五官】，严禁归入 portrait，必须归入 clothing！
- portrait：虚拟人像与人物肖像库。主体必须是人物本身，且【必须具有清晰可见、完整露出的真实或虚拟五官人脸】（如清晰脸部特写、证件照、半身/全身清晰露脸肖像）。
  【严禁】：如果人物五官脸部不可见、被截去、被涂抹遮挡、低头背影、无清晰人脸，或者主体重点在展示衣服/裙子/穿搭，严禁选 portrait！
- none：主体不是要展示的空间或物品。聊天、美食、表情包、纯文字、无关风景、其他也归这里。
水印和素材网站字样不改变种类。
is_material：种类不是 none 时必须为 true，种类是 none 时必须为 false。
reason：一句中文，说明为什么是这个种类。
只返回 JSON：{"is_material":true,"category":"interior","reason":"..."}`;

function normalizeCategory(raw) {
  let c = String(raw || '').trim().toLowerCase();
  if (c === 'interior_design') c = 'interior';
  if (c === 'material') c = 'none';
  if (KEEP_CATEGORIES.includes(c) || c === 'none') return c;
  return '';
}

function shouldAutoRestage(category) {
  return RESTAGE_CATEGORIES.has(normalizeCategory(category));
}

function routeGate(gate) {
  const category = normalizeCategory(gate && gate.category);
  const reason = String((gate && gate.reason) || '').trim();
  if (KEEP_CATEGORIES.includes(category)) {
    return { keep: true, category, reason };
  }
  return { keep: false, category: category || 'none', reason };
}

function promptIncludesLibraries(text) {
  return String(text || '').includes('clothing') && String(text || '').includes('portrait');
}

/**
 * 回收站里已有闸门记录的归位。
 * library 为空表示留在回收站。
 */
function classifyTrashRecovery(category, reason) {
  const cat = normalizeCategory(category);
  const text = String(reason || '');
  if (cat === 'interior' || cat === 'exterior' || cat === 'furniture') {
    return { library: cat, restage: RESTAGE_CATEGORIES.has(cat) };
  }
  if (cat === 'clothing' || CLOTH_RE.test(text)) {
    return { library: 'clothing', restage: false };
  }
  if (cat === 'portrait' || (PORTRAIT_RE.test(text) && !CLOTH_RE.test(text))) {
    return { library: 'portrait', restage: false };
  }
  return { library: null, restage: false };
}

function isManualLibraryCategory(category) {
  return MANUAL_CATEGORIES.has(String(category || ''));
}

module.exports = {
  KEEP_CATEGORIES,
  RESTAGE_CATEGORIES,
  MANUAL_CATEGORIES,
  shouldAutoRestage,
  GATE_PROMPT,
  normalizeCategory,
  routeGate,
  promptIncludesLibraries,
  classifyTrashRecovery,
  isManualLibraryCategory,
};
