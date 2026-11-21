const fs = require('fs');
const path = require('path');
const { resolveDerivativeFile } = require('../derivatives');
const { chatVision } = require('../vlm');
const { readReport, writeReport } = require('../image-analysis/store');
const {
  applyScene,
  upsertRegion,
  compileDraft,
  GRAMMARS
} = require('../image-analysis/contract');

const SCENE_PROMPT = `你是室内实景分析员。只根据图片输出 JSON，不要解释。
空间类型只能是：客厅、客餐厅、餐厅、卧室、厨房、卫生间、书房、玄关、儿童房、阳台、其他、未知。不能写风格词。
每个候选物体给出 nameZh、part、role、box。box 是 0 到 1 的 {x,y,w,h}。
part 只能是 ceiling、wall、floor、millwork、upholstery、hard_furniture、curtain_bedding、rug、other。
role 只能是 feature_wall、custom_millwork、soft_panel、headboard、sofa、table、freestanding_cabinet、floor、ceiling、curtain、bedding、rug、tv、metal、pillow、other。
{"spaceType":"客厅","colors":["#RRGGBB"],"candidates":[{"id":"c1","nameZh":"电视背景墙","part":"wall","role":"feature_wall","box":{"x":0.2,"y":0.1,"w":0.6,"h":0.7}}]}`;

function regionPrompt(role) {
  const grammar = GRAMMARS[
    {
      feature_wall: 'wall', custom_millwork: 'wall', soft_panel: 'soft_panel', headboard: 'headboard',
      sofa: 'sofa', table: 'table', freestanding_cabinet: 'cabinet', floor: 'floor', ceiling: 'ceiling',
      curtain: 'curtain', bedding: 'bedding', rug: 'rug'
    }[role] || ''
  ];
  const slots = grammar ? grammar.slots : {};
  return `你是室内局部分析员。只分析画面主体，输出 JSON。看不清就填 unknown，不要猜测材质商品名。
栏位只能使用给定枚举。${JSON.stringify(slots)}
额外给出 materialFamily（paint、art_coat、wood、stone、leather、fabric、metal、glass、unknown 之一）和 colorLabel（一个可见颜色描述）。
{"structure":{},"materialFamily":"unknown","colorLabel":""}`;
}

function analysisDir(config) {
  return path.join(config.dataDir, 'image-analysis');
}

async function imageBase64(db, services, fid) {
  const row = db.prepare(
    "SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' ORDER BY id DESC LIMIT 1"
  ).get(fid);
  const file = await resolveDerivativeFile(services, row);
  if (!file || !fs.existsSync(file)) throw new Error('找不到这张图片的原文件');
  return fs.readFileSync(file).toString('base64');
}

function withDrafts(report) {
  return {
    ...report,
    regions: (report.regions || []).map((region) => {
      const draft = compileDraft(region);
      return { ...region, draft: draft.ok ? draft.text : '', draftOk: Boolean(draft.ok) };
    })
  };
}

function createImageAnalysisService(db, services, vision = chatVision) {
  const dir = analysisDir(services.config);

  return {
    getReport(fid) {
      return withDrafts(readReport(dir, fid));
    },

    async analyzeScene(fid, model) {
      const previous = readReport(dir, fid);
      const image = await imageBase64(db, services, fid);
      const raw = await vision({ model, prompt: SCENE_PROMPT, images: [image], disableFallback: false });
      const next = applyScene(previous.fid ? previous : { fid, scene: null, regions: [] }, raw);
      next.fid = String(fid).replace(/[^a-zA-Z0-9_-]/g, '');
      return withDrafts(writeReport(dir, next));
    },

    preview(fid, selection, phrase) {
      const report = readReport(dir, fid);
      if (!report.scene) throw new Error('先分析整张图');
      const draft = upsertRegion(report, { id: 'preview', selection, phrase });
      const region = draft.regions.find((item) => item.id === 'preview');
      return {
        candidates: region.candidates,
        suggestedId: region.suggestedId,
        focusConfirmed: region.focusConfirmed,
        focus: region.focus
      };
    },

    async analyzeRegion(fid, input, model) {
      const report = readReport(dir, fid);
      if (!report.scene) throw new Error('先分析整张图');
      let next = upsertRegion(report, input);
      let region = next.regions.find((item) => item.id === (input.id || next.regions[next.regions.length - 1].id));
      const existing = (report.regions || []).find((item) => item.id === input.id);
      const keepStructure = input.skipVision && existing && existing.structure && existing.structure.grammar;
      if (keepStructure) {
        next = upsertRegion(report, { ...input, structure: existing.structure.slots });
        region = next.regions.find((item) => item.id === input.id);
      } else if (region.focusConfirmed && region.focus && region.structure.grammar) {
        const image = await imageBase64(db, services, fid);
        const raw = await vision({
          model,
          prompt: regionPrompt(region.focus.role),
          images: [image],
          disableFallback: false
        });
        next = upsertRegion(report, {
          ...input,
          structure: raw && raw.structure,
          material: { family: raw && raw.materialFamily },
          color: { label: raw && raw.colorLabel }
        });
        region = next.regions.find((item) => item.id === input.id);
      }
      writeReport(dir, next);
      const drafted = withDrafts(next);
      const draftedRegion = drafted.regions.find((item) => item.id === region.id) || region;
      return { report: drafted, region: draftedRegion, draft: compileDraft(region) };
    }
  };
}

module.exports = { createImageAnalysisService, SCENE_PROMPT };
