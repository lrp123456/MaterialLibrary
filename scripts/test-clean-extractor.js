'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\lrp\\.dsh-material-library-test\\material.db', { readonly: true });

// 空间关键词与特征字典
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

const VALID_SPACES = new Set(SPACE_FEATURE_MAP.map(s => s.space));

const STYLE_KEYWORDS = [
  { style: '中古风', keywords: ['中古', '中古风', '中古风格'] },
  { style: '法式复古', keywords: ['法式复古'] },
  { style: '法式轻奢', keywords: ['法式轻奢'] },
  { style: '法式', keywords: ['法式', '法式风格'] },
  { style: '现代极简', keywords: ['现代极简', '极简'] },
  { style: '现代简约', keywords: ['现代简约', '现代风格', '现代'] },
  { style: '奶油风', keywords: ['奶油风', '奶油'] },
  { style: '侘寂', keywords: ['侘寂', '侘寂风'] },
  { style: '宋式美学', keywords: ['宋式', '宋代', '宋式美学'] },
  { style: '新中式', keywords: ['新中式', '中式'] },
  { style: '深色原木风', keywords: ['深色原木', '深色原木风'] },
  { style: '日式原木风', keywords: ['日式原木', '原木风', '日式'] },
  { style: '工业风', keywords: ['工业风'] },
  { style: '美式乡村', keywords: ['美式乡村', '美式'] },
  { style: '托斯卡纳', keywords: ['托斯卡纳'] },
  { style: '包豪斯', keywords: ['包豪斯'] }
];

function extractCleanTrajectory(prompt) {
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

  // 2. 查找文本中出现的全部空间及其首次出现的位置
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
        // 排除沐浴间推门
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

  // 3. 去重相邻相同的空间
  const distinctSeq = [];
  for (const h of hits) {
    if (distinctSeq.length === 0 || distinctSeq[distinctSeq.length - 1].space !== h.space) {
      distinctSeq.push(h);
    }
  }

  // 4. 判定是否有明确的走向动线（起点 -> 终点）
  // 只有在存在运动动词（推门、进入、走向、来到、走到、穿过、顺着）时判定转场
  const hasMovement = /(?:推门|进入|走向|来到|走到|穿过|顺着|向前方|向左前方|向右前方)/.test(p);

  if (distinctSeq.length >= 2 && hasMovement) {
    const sp1 = distinctSeq[0].space;
    const sp2 = distinctSeq[1].space;
    if (VALID_SPACES.has(sp1) && VALID_SPACES.has(sp2) && sp1 !== sp2) {
      return {
        trajectory: `${sp1} → ${sp2}`,
        space: sp2 || sp1,
        isMulti: true
      };
    }
  }

  // 5. 单空间导览
  if (distinctSeq.length >= 1 && VALID_SPACES.has(distinctSeq[0].space)) {
    return {
      trajectory: `${distinctSeq[0].space} 导览漫游`,
      space: distinctSeq[0].space,
      isMulti: false
    };
  }

  return {
    trajectory: '全景空间漫游',
    space: '未填写',
    isMulti: false
  };
}

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

// 测试跑全部 363 个视频
const allVideos = db.prepare("SELECT id, root_origin_hash, trajectory, style, space, prompt FROM creation_templates WHERE type='video'").all();
console.log(`Analyzing ${allVideos.length} videos...`);

// 构建 root_origin_hash -> 已知 style 映射表
const hashToStyle = new Map();
const images = db.prepare("SELECT root_origin_hash, style FROM creation_templates WHERE type='image' AND style IS NOT NULL AND style != '' AND style != '未填写'").all();
for (const img of images) {
  if (img.root_origin_hash && !hashToStyle.has(img.root_origin_hash)) {
    hashToStyle.set(img.root_origin_hash, img.style);
  }
}

const newTrajCounts = {};
const newStyleCounts = {};
let repairedCount = 0;

for (const v of allVideos) {
  const res = extractCleanTrajectory(v.prompt);
  let st = extractCleanStyle(v.prompt);
  if (!st && v.root_origin_hash && hashToStyle.has(v.root_origin_hash)) {
    st = hashToStyle.get(v.root_origin_hash);
  }
  if (!st) st = '未填写';

  if (res.trajectory === '卫浴 → 门厅') {
    console.log(`[DEBUG 卫浴 → 门厅] ${v.id}: ${v.prompt.slice(0, 120)}`);
  }
  newTrajCounts[res.trajectory] = (newTrajCounts[res.trajectory] || 0) + 1;
  newStyleCounts[st] = (newStyleCounts[st] || 0) + 1;

  if (v.trajectory !== res.trajectory) {
    repairedCount++;
  }
}

console.log(`Repaired / updated trajectories: ${repairedCount} / ${allVideos.length}`);
console.log('\n=== New Trajectories Distribution ===');
console.table(Object.entries(newTrajCounts).sort((a,b)=>b[1]-a[1]).map(([t, cnt])=>({ trajectory: t, count: cnt })));

console.log('\n=== New Styles Distribution ===');
console.table(Object.entries(newStyleCounts).sort((a,b)=>b[1]-a[1]).map(([s, cnt])=>({ style: s, count: cnt })));
