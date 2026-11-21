const fs = require('fs');
const path = require('path');
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');

const TEST_DB = 'C:\\Users\\lrp\\.dsh-material-library-test\\material.db';
const TEST_MEDIA = 'C:\\Users\\lrp\\.dsh-material-library-test\\creation-library';

if (!fs.existsSync(TEST_DB)) {
  console.error('Test DB does not exist at:', TEST_DB);
  process.exit(1);
}

const db = new Database(TEST_DB, { readonly: true });

console.log('================================================================');
console.log('       「灵感空间 PRO」测试通道 (test) 创作资产全景深度分析报告   ');
console.log('================================================================\n');

// 1. 全局资产统计
const totalCount = db.prepare('SELECT count(*) as c FROM creation_templates').get().c;
const inCreationCount = db.prepare('SELECT count(*) as c FROM creation_templates WHERE in_creation_lib = 1').get().c;
const inMaterialCount = db.prepare('SELECT count(*) as c FROM creation_templates WHERE in_material_lib = 1').get().c;
const bothCount = db.prepare('SELECT count(*) as c FROM creation_templates WHERE in_creation_lib = 1 AND in_material_lib = 1').get().c;
const onlyCreation = inCreationCount - bothCount;
const onlyMaterial = inMaterialCount - bothCount;
const coversCount = db.prepare('SELECT count(*) as c FROM creation_templates WHERE is_cover = 1').get().c;

// 时间跨度
const timeSpan = db.prepare('SELECT min(created_at) as earliest, max(created_at) as latest FROM creation_templates').get();

// 静帧 vs 视频
const allRows = db.prepare(`
  SELECT id, title, prompt, space, style, operation, type, origin_images, result_images, video_mode,
         root_origin_hash, prompt_hash, is_cover, created_at, media_dir
  FROM creation_templates
`).all();

let stillCount = 0;
let videoCount = 0;
let tourVideoCount = 0;
let transitionVideoCount = 0;
let totalResultImagesCount = 0;

for (const r of allRows) {
  const isVideo = r.type === 'video' || r.operation === '生视频' || !!r.video_mode;
  if (isVideo) {
    videoCount++;
    if (r.video_mode === 'transition' || /转场|两端|端点/.test(`${r.title || ''} ${r.prompt || ''}`)) {
      transitionVideoCount++;
    } else {
      tourVideoCount++;
    }
  } else {
    stillCount++;
  }

  // 计算生成图片数
  if (r.result_images) {
    try {
      const arr = JSON.parse(r.result_images);
      if (Array.isArray(arr)) totalResultImagesCount += arr.length;
      else if (typeof arr === 'string') totalResultImagesCount += 1;
    } catch (_) {
      totalResultImagesCount += 1;
    }
  }
}

// 磁盘媒体文件统计
let totalMediaDirs = 0;
let totalMediaFiles = 0;
let totalMediaBytes = 0;
let mediaExtensions = {};

if (fs.existsSync(TEST_MEDIA)) {
  const dirs = fs.readdirSync(TEST_MEDIA);
  totalMediaDirs = dirs.length;
  for (const d of dirs) {
    const dirPath = path.join(TEST_MEDIA, d);
    try {
      const stat = fs.statSync(dirPath);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(dirPath);
        totalMediaFiles += files.length;
        for (const f of files) {
          try {
            const fstat = fs.statSync(path.join(dirPath, f));
            totalMediaBytes += fstat.size;
            const ext = path.extname(f).toLowerCase() || 'other';
            mediaExtensions[ext] = (mediaExtensions[ext] || 0) + 1;
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
}

// 2. 基图聚合与血缘深度分析
const rootStats = db.prepare(`
  SELECT root_origin_hash, count(*) as step_count,
         min(created_at) as first_step, max(created_at) as last_step,
         group_concat(DISTINCT style) as styles,
         group_concat(DISTINCT space) as spaces
  FROM creation_templates
  GROUP BY root_origin_hash
  ORDER BY step_count DESC
`).all();

const totalRoots = rootStats.length;
const avgStepsPerRoot = (totalCount / (totalRoots || 1)).toFixed(2);
const singleStepRoots = rootStats.filter(r => r.step_count === 1).length;
const multiStepRoots = rootStats.filter(r => r.step_count > 1).length;
const deepRoots = rootStats.filter(r => r.step_count >= 5).length;
const maxStepRoot = rootStats[0] || { root_origin_hash: 'N/A', step_count: 0 };

// 3. 空间分布
const spaceStats = db.prepare(`
  SELECT coalesce(nullif(space, ''), '未填写') as space_name, count(*) as cnt
  FROM creation_templates
  GROUP BY space_name
  ORDER BY cnt DESC
`).all();

// 4. 风格分布
const styleStats = db.prepare(`
  SELECT coalesce(nullif(style, ''), '未填写') as style_name, count(*) as cnt
  FROM creation_templates
  GROUP BY style_name
  ORDER BY cnt DESC
`).all();

// 5. 操作分布
const opStats = db.prepare(`
  SELECT coalesce(nullif(operation, ''), '未填写') as op_name, count(*) as cnt
  FROM creation_templates
  GROUP BY op_name
  ORDER BY cnt DESC
`).all();

// 6. 提示词生态与重用分析
const promptStats = db.prepare(`
  SELECT count(DISTINCT prompt_hash) as unique_prompts,
         count(*) - count(DISTINCT prompt_hash) as reused_prompts
  FROM creation_templates
  WHERE prompt_hash IS NOT NULL
`).get();

const topPrompts = db.prepare(`
  SELECT prompt, count(*) as reuse_count
  FROM creation_templates
  WHERE prompt IS NOT NULL AND length(prompt) > 3
  GROUP BY prompt_hash
  HAVING reuse_count > 1
  ORDER BY reuse_count DESC
  LIMIT 8
`).all();

// 7. 汇总分析结果
const result = {
  assetScale: {
    totalCreations: totalCount,
    stillImages: stillCount,
    totalVideos: videoCount,
    tourVideos: tourVideoCount,
    transitionVideos: transitionVideoCount,
    coversLocked: coversCount,
    coverLockRatio: ((coversCount / totalCount) * 100).toFixed(1) + '%',
    timeSpan: {
      earliest: timeSpan.earliest,
      latest: timeSpan.latest
    }
  },
  dualLibraryDecoupling: {
    inCreationLib: inCreationCount,
    inMaterialLib: inMaterialCount,
    bothLibs: bothCount,
    onlyCreation,
    onlyMaterial,
  },
  storagePhysical: {
    creationLibraryDirs: totalMediaDirs,
    mediaFilesCount: totalMediaFiles,
    totalSizeMB: (totalMediaBytes / (1024 * 1024)).toFixed(2),
    fileTypeDistribution: mediaExtensions
  },
  rootLineageAnalysis: {
    totalRoots,
    avgStepsPerRoot,
    singleStepRoots: { count: singleStepRoots, ratio: ((singleStepRoots / totalRoots) * 100).toFixed(1) + '%' },
    multiStepRoots: { count: multiStepRoots, ratio: ((multiStepRoots / totalRoots) * 100).toFixed(1) + '%' },
    deepEvolutionRoots: { count: deepRoots, ratio: ((deepRoots / totalRoots) * 100).toFixed(1) + '%' },
    maxStepsInSingleRoot: maxStepRoot.step_count,
    topRoots: rootStats.slice(0, 8).map(r => ({
      rootOriginHashPrefix: r.root_origin_hash ? r.root_origin_hash.slice(0, 12) : 'N/A',
      stepsCount: r.step_count,
      stylesCovered: r.styles ? r.styles.split(',').filter(Boolean) : [],
      spacesCovered: r.spaces ? r.spaces.split(',').filter(Boolean) : []
    }))
  },
  spatialCoverage: spaceStats.map(s => ({
    space: s.space_name,
    count: s.cnt,
    percentage: ((s.cnt / totalCount) * 100).toFixed(1) + '%'
  })),
  styleDistribution: styleStats.map(s => ({
    style: s.style_name,
    count: s.cnt,
    percentage: ((s.cnt / totalCount) * 100).toFixed(1) + '%'
  })),
  operationBreakdown: opStats.map(o => ({
    operation: o.op_name,
    count: o.cnt,
    percentage: ((o.cnt / totalCount) * 100).toFixed(1) + '%'
  })),
  promptEcosystem: {
    uniquePrompts: promptStats.unique_prompts,
    reusedPrompts: promptStats.reused_prompts,
    reuseRate: ((promptStats.reused_prompts / totalCount) * 100).toFixed(1) + '%',
    topReusedPrompts: topPrompts.map(p => ({
      count: p.reuse_count,
      promptSnippet: p.prompt.length > 50 ? p.prompt.slice(0, 50) + '...' : p.prompt
    }))
  }
};

console.log('=== ANALYSIS_RESULT_JSON_START ===');
console.log(JSON.stringify(result, null, 2));
console.log('=== ANALYSIS_RESULT_JSON_END ===');
