/**
 * AI 智能打标与提示词语义分析中枢 (AI Tagger & Semantic Comparator)
 *
 * 核心职责：
 * 1. 入库 AI 智能打标：
 *    - 调用视觉大模型 (VLM / NewAPI DeepSeek / Doubao Seed / Agnes) 对指令及图片进行深度语义解析；
 *    - 自动输出结构化空间、风格、空间走向 (生视频专用，如门厅-客厅)、操作类型及设计亮点。
 * 2. 空间走向严格语义断言 (Trajectory Semantic Invariant):
 *    - 走向格式必须且只能由两个合法标准空间组成（如 "门厅 → 客厅"），严禁将动作/碎片词（如 "左侧推门"、"（图片2）把"）拼入走向；
 *    - 单空间运镜规范化为 "${空间} 导览漫游"。
 * 3. 提示词语义相似度划分 (非字面字符比对，而是 AI 语义理解)：
 *    - 判定提示词变动是微调修饰 (SUBTLE)、大改 (MAJOR)、同义重跑 (EXACT) 还是全新方案 (DIFFERENT)。
 */
'use strict';

const { chatVision, completeChat } = require('./vlm');

// 室内标准空间词表
const CANONICAL_SPACES = [
  '门厅', '玄关', '客厅', '餐厅', '客餐厅', '厨房', '主卧', '次卧', '卧室', 
  '衣帽间', '卫浴', '卫生间', '书房', '阳台', '露台', '茶室', '走廊', '过道', '楼梯间', '庭院'
];

// 室内标准风格词表
const CANONICAL_STYLES = [
  '中古风', '法式轻奢', '法式复古', '法式', '意式极简', '意式轻奢', '现代极简', '现代简约',
  '奶油风', '侘寂', '宋式美学', '新中式', '深色原木风', '日式原木风', '工业风', '美式乡村', '包豪斯', '托斯卡纳'
];

// 空间关键词与特征字典（用于空间与动线物理特征深度识别）
const SPACE_FEATURE_MAP = [
  { 
    space: '门厅', 
    keywords: ['门厅', '玄关', '入户', '进门', '门厅柜', '玄关柜', '鞋柜', '换鞋', '衣帽钩', '衣帽勾', '入户门', '落水区', '玄关处', '入室门'],
    pattern: /(?:左侧|右侧|正面|室外)?推门(?:进入|进来|而入)|(?:由|从)(?:左侧|右侧|正面|室外)推门/
  },
  { space: '客厅', keywords: ['客厅', '客餐厅', '沙发', '茶几', '电视柜', '电视墙', '中堂'] },
  { space: '餐厅', keywords: ['餐厅', '餐桌', '餐椅', '餐边柜', '用餐区'] },
  { space: '厨房', keywords: ['厨房', '橱柜', '岛台', '中岛', '灶台', '水槽', '料理台', '炉灶'] },
  { space: '卧室', keywords: ['卧室', '主卧', '次卧', '大床', '床头', '床尾', '床边', '飘窗'] },
  { space: '衣帽间', keywords: ['衣帽间', '步入式衣柜', '更衣室'] },
  { space: '卫浴', keywords: ['卫浴', '卫生间', '浴室', '沐浴间', '洗手台', '洗手间', '淋浴', '马桶', '浴缸'] },
  { space: '书房', keywords: ['书房', '写字台', '书架', '书桌'] },
  { space: '阳台', keywords: ['阳台', '露台', '落地窗'] },
  { space: '茶室', keywords: ['茶室', '茶台', '茶桌'] },
  { space: '过道', keywords: ['走廊', '过道', '楼梯间'] }
];

const VALID_SPACES_SET = new Set(CANONICAL_SPACES);

// 风格匹配词典
const STYLE_KEYWORDS = [
  { style: '中古风', keywords: ['中古风', '中古风格', '中古'] },
  { style: '法式复古', keywords: ['法式复古'] },
  { style: '法式轻奢', keywords: ['法式轻奢'] },
  { style: '法式', keywords: ['法式风格', '法式'] },
  { style: '现代极简', keywords: ['现代极简', '极简风格', '极简'] },
  { style: '现代简约', keywords: ['现代简约', '现代风格', '现代'] },
  { style: '奶油风', keywords: ['奶油风', '奶油'] },
  { style: '侘寂', keywords: ['侘寂风', '侘寂'] },
  { style: '宋式美学', keywords: ['宋式美学', '宋式', '宋代'] },
  { style: '新中式', keywords: ['新中式', '中式风格', '中式'] },
  { style: '深色原木风', keywords: ['深色原木风', '深色原木'] },
  { style: '日式原木风', keywords: ['日式原木风', '日式原木', '原木风'] },
  { style: '工业风', keywords: ['工业风'] },
  { style: '美式乡村', keywords: ['美式乡村', '美式风格', '美式'] },
  { style: '托斯卡纳', keywords: ['托斯卡纳'] },
  { style: '包豪斯', keywords: ['包豪斯'] }
];

/**
 * 纯粹、健壮的空间走向提取器 (Clean Trajectory Extractor)
 * 严格保证：若输出 "A → B"，则 A 与 B 必定属于室内标准空间，绝无任何碎片杂词！
 */
function extractCleanTrajectory(prompt, detectedSpaceFallback = '') {
  const p = String(prompt || '');

  // 1. 过滤干扰短语（运镜词汇，严禁误判为空间转场）
  const cleanP = p
    .replace(/从始至终/g, '')
    .replace(/自始至终/g, '')
    .replace(/由远及近/g, '')
    .replace(/由近及远/g, '')
    .replace(/由上至下/g, '')
    .replace(/由下至上/g, '')
    .replace(/从左至右/g, '')
    .replace(/从右至左/g, '')
    .replace(/向[左右前]侧?横向平移/g, '')
    .replace(/中景后拉/g, '');

  // 2. 查找文本中出现的空间特征及其首次出现的位置
  const hits = [];
  for (const item of SPACE_FEATURE_MAP) {
    let minPos = Infinity;
    for (const kw of item.keywords) {
      const idx = cleanP.indexOf(kw);
      if (idx !== -1 && idx < minPos) {
        minPos = idx;
      }
    }
    if (item.pattern) {
      const match = cleanP.match(item.pattern);
      if (match && match.index < minPos) {
        // 排除沐浴间推门（沐浴间内开门属于卫浴内部，非入户门厅）
        const prefix = cleanP.slice(Math.max(0, match.index - 8), match.index);
        if (!prefix.includes('沐浴') && !prefix.includes('淋浴') && !prefix.includes('浴室')) {
          minPos = match.index;
        }
      }
    }
    if (minPos !== Infinity) {
      hits.push({ space: item.space, pos: minPos });
    }
  }

  hits.sort((a, b) => a.pos - b.pos);

  // 3. 去除相邻重复的空间
  const distinctSeq = [];
  for (const h of hits) {
    if (distinctSeq.length === 0 || distinctSeq[distinctSeq.length - 1].space !== h.space) {
      distinctSeq.push(h);
    }
  }

  // 4. 判定是否有明确的走向动线（起点 -> 终点）
  const hasMovement = /(?:推门|进入|走向|来到|走到|穿过|顺着|向前方|向左前方|向右前方|走入)/.test(p);

  if (distinctSeq.length >= 2 && hasMovement) {
    const sp1 = distinctSeq[0].space;
    const sp2 = distinctSeq[1].space;
    if (VALID_SPACES_SET.has(sp1) && VALID_SPACES_SET.has(sp2) && sp1 !== sp2) {
      return {
        trajectory: `${sp1} → ${sp2}`,
        space: sp2 || sp1,
        isMulti: true
      };
    }
  }

  // 5. 单空间导览漫游
  const primarySpace = (distinctSeq[0] && distinctSeq[0].space) || detectedSpaceFallback;
  if (primarySpace && VALID_SPACES_SET.has(primarySpace)) {
    return {
      trajectory: `${primarySpace} 导览漫游`,
      space: primarySpace,
      isMulti: false
    };
  }

  return {
    trajectory: '全景空间漫游',
    space: detectedSpaceFallback || '未填写',
    isMulti: false
  };
}

/**
 * 提取标准风格
 */
function extractCleanStyle(prompt) {
  const p = String(prompt || '');
  for (const item of STYLE_KEYWORDS) {
    for (const kw of item.keywords) {
      if (p.includes(kw)) {
        return item.style;
      }
    }
  }
  return '';
}

/**
 * 规则引擎备用提取（当 AI 离线或网络异常时，100% 保障不卡死且绝对规范）
 */
function ruleBasedExtract(prompt, type = 'image') {
  const p = String(prompt || '');
  const detectedStyle = extractCleanStyle(p);
  const isVideo = type === 'video' || p.includes('视频') || p.includes('一镜到底') || p.includes('漫游') || p.includes('穿行');

  let detectedSpace = '';
  for (const sp of CANONICAL_SPACES) {
    if (p.includes(sp)) {
      detectedSpace = sp;
      break;
    }
  }

  let trajectory = '';
  let operation = isVideo ? '生视频' : '换空间';

  if (isVideo) {
    const res = extractCleanTrajectory(p, detectedSpace);
    trajectory = res.trajectory;
    if (!detectedSpace || detectedSpace === '未填写') {
      detectedSpace = res.space;
    }
    operation = res.isMulti ? '双图转场' : '单图导览';
  }

  return {
    modality: isVideo ? 'video' : 'image',
    space: detectedSpace || '未填写',
    style: detectedStyle || '未填写',
    trajectory: trajectory || (isVideo ? '全景空间漫游' : ''),
    operation,
    summary: p.slice(0, 36) || '室内空间设计创作'
  };
}

/**
 * 获取可用的 LLM 配置
 */
function resolveBestLlmConfig() {
  try {
    const { loadProjectEnv } = require('./env-secrets');
    loadProjectEnv();
  } catch (_) {}

  // 1. 优先使用 New API 网关中的 deepseek-flash（速度极快且稳定）
  if (process.env.NEWAPI_BASE_URL && process.env.NEWAPI_API_KEY) {
    return {
      baseUrl: process.env.NEWAPI_BASE_URL,
      apiKey: process.env.NEWAPI_API_KEY,
      model: 'deepseek-flash'
    };
  }

  // 2. 其次使用方舟或 LiteLLM 本地网关
  return {
    baseUrl: process.env.LITELLM_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: process.env.ARK_API_KEY || 'default',
    model: 'doubao-seed-2-1-lite-260915'
  };
}

/**
 * 入库 AI 智能打标
 * 输入：prompt 提示词, originUrl 基图, resultUrl 产物图/海报, type 模态
 */
async function aiTagCreationItem({ prompt, originUrl, resultUrl, type = 'image', services = null }) {
  const isVideo = type === 'video' || String(resultUrl || '').endsWith('.mp4');
  const fallback = ruleBasedExtract(prompt, isVideo ? 'video' : 'image');

  const systemPrompt = `你是一名资深室内设计分析专家。请分析用户的室内设计创作提示词与方案，输出标准严格的 JSON 格式（无 markdown 包裹）。
必须提取以下字段：
1. "space": 所属空间（必须在：门厅、玄关、客厅、餐厅、客餐厅、厨房、主卧、次卧、卧室、衣帽间、卫浴、卫生间、书房、阳台、茶室、过道等中选择，无法确定填"未填写"）；
2. "style": 设计风格（如：中古风、法式轻奢、法式复古、法式、现代极简、现代简约、奶油风、侘寂、宋式美学、深色原木风、美式乡村等，无法确定填"未填写"）；
3. "trajectory": 【生视频专用】若为视频或漫游，提取空间走向（格式必须为"起点 → 终点"，两端必须都是标准空间名，如"门厅 → 客厅"、"客厅 → 餐厅"；若为单空间内运镜则填"客厅 导览漫游"；若为生图静帧此项输出空字符串""）；
4. "operation": 核心动作（如："换空间"、"换表面"、"单图导览"、"双图转场"、"一镜到底穿行"）；
5. "summary": 一句话提炼该方案的设计重点（20字以内）。`;

  try {
    const userPrompt = `提示词内容: "${prompt || '无'}"\n模态类型: ${isVideo ? '视频 (video)' : '静态图像 (image)'}`;
    const llmCfg = resolveBestLlmConfig();

    const resp = await completeChat({
      baseUrl: llmCfg.baseUrl,
      apiKey: llmCfg.apiKey,
      model: llmCfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      timeoutMs: 6000
    });

    const text = resp.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(text);

    if (parsed && typeof parsed === 'object') {
      let finalTraj = isVideo ? (parsed.trajectory || fallback.trajectory) : '';
      // 严格断言走向：如果 AI 输出的走向不符合两端标准空间格式，使用规则提取兜底
      if (isVideo && finalTraj && finalTraj.includes('→')) {
        const parts = finalTraj.split('→').map(s => s.trim());
        if (parts.length !== 2 || !VALID_SPACES_SET.has(parts[0]) || !VALID_SPACES_SET.has(parts[1])) {
          finalTraj = fallback.trajectory;
        }
      }

      return {
        modality: isVideo ? 'video' : 'image',
        space: (parsed.space && VALID_SPACES_SET.has(parsed.space)) ? parsed.space : fallback.space,
        style: (parsed.style && parsed.style !== '未填写') ? parsed.style : fallback.style,
        trajectory: finalTraj || fallback.trajectory,
        operation: parsed.operation || fallback.operation,
        summary: parsed.summary || fallback.summary,
        ai_tagged: true
      };
    }
  } catch (err) {
    console.warn('[ai-tagger] AI 打标降级回退到规则引擎:', err.message);
  }

  return { ...fallback, ai_tagged: false };
}

/**
 * AI 提示词语义相似度分析 (AI Semantic Comparator)
 * 判定两份提示词是细节微调修饰 (SUBTLE)、主体硬装大改 (MAJOR)、同义重跑 (EXACT) 还是全新方案 (DIFFERENT)
 */
async function comparePromptsSemantically(promptA, promptB) {
  const pA = String(promptA || '').trim();
  const pB = String(promptB || '').trim();

  // 1. 完全相同
  if (pA === pB) {
    return {
      relationship: 'EXACT',
      similarity_score: 1.0,
      explanation: '提示词完全一致，属于同词重跑或批量抽卡'
    };
  }

  // 2. 规范化去标点空白相同
  const normA = pA.replace(/[\s\r\n\t,，。！!？?、:：;；"'"'“”‘’]/g, '').toLowerCase();
  const normB = pB.replace(/[\s\r\n\t,，。！!？?、:：;；"'"'“”‘’]/g, '').toLowerCase();
  if (normA === normB) {
    return {
      relationship: 'EXACT',
      similarity_score: 0.99,
      explanation: '仅有微小标点或换行差异，语义完全相同'
    };
  }

  // 3. 调用 AI 进行语义层级判定
  try {
    const sys = `你是一名资深的室内设计自然语言语义分析专家。请比对以下两份室内设计提示词的语义演变关系：
请严格输出 JSON 格式（无 markdown 代码块）：
{
  "relationship": "SUBTLE" | "MAJOR" | "DIFFERENT",
  "similarity_score": 0.0 到 1.0 之间的数字,
  "explanation": "简明的一句话解释修改了什么"
}
判定标准：
- SUBTLE (细节修饰微调): 空间与整体硬装大框架未变，仅调整了局部材质、颜色形容词、光影、或换了1~2件软装家具（如布艺换皮质沙发）；
- MAJOR (硬装/格局大改): 空间推翻了原有硬装布局，改变了主体动线、核心功能区（如做大岛台、做整墙胡桃木柜体）；
- DIFFERENT (全新方案): 风格彻底突变，或者描述的是完全不同的房间。`;

    const user = `【原版本 A】:\n${pA}\n\n【新版本 B】:\n${pB}`;
    const llmCfg = resolveBestLlmConfig();

    const resp = await completeChat({
      baseUrl: llmCfg.baseUrl,
      apiKey: llmCfg.apiKey,
      model: llmCfg.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      timeoutMs: 5000
    });

    const parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
    if (parsed.relationship) {
      return {
        relationship: parsed.relationship,
        similarity_score: Number(parsed.similarity_score || 0.8),
        explanation: parsed.explanation || 'AI 语义分析完成'
      };
    }
  } catch (e) {
    console.warn('[ai-tagger] AI 语义对比降级为字符对比:', e.message);
  }

  // 兜底降级：Jaccard 词袋比对
  const wordsA = new Set(pA.split(/[\s,，。]+/));
  const wordsB = new Set(pB.split(/[\s,，。]+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  const score = union.size > 0 ? (intersection.size / union.size) : 0;

  if (score >= 0.6) {
    return {
      relationship: 'SUBTLE',
      similarity_score: score,
      explanation: '修饰词细节微调（基于关键词重合分析）'
    };
  } else if (score >= 0.25) {
    return {
      relationship: 'MAJOR',
      similarity_score: score,
      explanation: '提示词格局产生较大变化'
    };
  }
  return {
    relationship: 'DIFFERENT',
    similarity_score: score,
    explanation: '两份提示词属于不同方案'
  };
}

module.exports = {
  CANONICAL_SPACES,
  CANONICAL_STYLES,
  extractCleanTrajectory,
  extractCleanStyle,
  ruleBasedExtract,
  aiTagCreationItem,
  comparePromptsSemantically
};
