/**
 * 服装、人像的手动预处理。进库时不调用。
 * 服装：抽出衣服。人像：高清重绘后上传火山，旧素材在新图成功后再删。
 */
const fs = require('fs');
const path = require('path');
const { executeAdapter } = require('./gen');
const { createDerivative, setMainDerivative } = require('./derivatives');
const portraitLib = require('./portrait-library');

function clothingPrompt(background, color) {
  if (background === 'transparent') {
    return '抽出画面中的服装单品，去掉人物和原来的场景。只保留衣服本身，背景完全透明，不要文字、水印、衣架和杂物。';
  }
  if (background === 'solid') {
    const hex = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : '#F2F2F2';
    return `抽出画面中的服装单品，去掉人物和原来的场景。只保留衣服本身，背景为纯色 ${hex}，不要文字、水印、衣架和杂物。`;
  }
  return '抽出画面中的服装单品，去掉人物和原来的场景。只保留衣服本身，背景为纯白，不要文字、水印、衣架和杂物。';
}

const PORTRAIT_PROMPT = '以参考图中的人物面容为参照，重绘一张干净的竖版虚拟人像。正面，肩部以上，表情自然，浅灰纯色背景。去掉水印、文字、logo 和边框。';

async function pickImageAdapter(db) {
  const primary = db.prepare("SELECT * FROM gen_adapters WHERE id='agnes_image' AND enabled=1").get();
  if (primary) return primary;
  return db.prepare("SELECT * FROM gen_adapters WHERE kind='image' AND enabled=1 ORDER BY builtin DESC LIMIT 1").get();
}

function pickPortraitAdapter(db) {
  const seedream = db.prepare("SELECT * FROM gen_adapters WHERE id='ark_seedream' AND enabled=1").get();
  if (seedream) return seedream;
  return null;
}

function portraitModel(db) {
  const row = db.prepare(`
    SELECT model_code FROM llm_models
    WHERE enabled=1 AND lower(model_code) LIKE '%seedream%'
    LIMIT 1
  `).get();
  return (row && row.model_code) || 'doubao-seedream-5-0-flash-260915';
}

async function generateFromAsset(services, asset, prompt) {
  const adapter = await pickImageAdapter(services.db);
  return generateWith(services, asset, prompt, adapter, 'agnes-image-2.5-flash', '');
}

async function generateWith(services, asset, prompt, adapter, model, ratio) {
  const { config } = services;
  if (!adapter) {
    const err = new Error('没有可用的生图适配器');
    err.code = 'no_adapter';
    throw err;
  }
  const origDir = path.join(config.dataDir, 'cache', 'originals');
  const exts = ['.jpg', '.jpeg', '.png', '.webp'];
  let ref = null;
  const named = asset.file_name ? path.extname(asset.file_name) : '';
  const tryExt = named ? [named, ...exts] : exts;
  for (const ext of tryExt) {
    const p = path.join(origDir, `${asset.fid}${ext.toLowerCase()}`);
    if (fs.existsSync(p)) { ref = p; break; }
  }
  if (!ref) {
    const err = new Error('本地原图不存在');
    err.code = 'fid_missing';
    throw err;
  }
  const res = await executeAdapter(services, adapter, {
    kind: 'image',
    mode: 'ref',
    gpuPriority: 'low',
    prompt,
    model,
    ratio: ratio || undefined,
    imageLocalPaths: [ref],
  });
  if (!res.ok || !res.files?.[0]?.localPath) {
    const err = new Error((res && res.error) || '生图服务未返回产物');
    err.code = 'gen_failed';
    throw err;
  }
  return res.files[0].localPath;
}

async function runLibraryPrep(services, fid, body, user) {
  const { db } = services;
  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
  if (!asset || asset.status === 'deleted') {
    const err = new Error('素材不存在');
    err.code = 'not_found';
    throw err;
  }
  const op = String((body && body.op) || '');
  if (op === 'clothing_extract') {
    if (asset.category !== 'clothing') {
      const err = new Error('只有服装库的图可以抽出衣服');
      err.code = 'bad_request';
      throw err;
    }
    const background = ['transparent', 'white', 'solid'].includes(body.background) ? body.background : 'white';
    const genPath = await generateFromAsset(services, asset, clothingPrompt(background, body.color));
    const mime = background === 'transparent' ? 'image/png' : 'image/jpeg';
    const deriv = await createDerivative(services, {
      assetFid: fid,
      kind: 'clothing_extract',
      srcPath: genPath,
      fileName: path.basename(genPath),
      mime,
      params: { background, color: body.color || '' },
    });
    if (deriv && deriv.id) setMainDerivative(db, fid, deriv.id);
    return { fid, op, derivativeId: deriv && deriv.id, background };
  }
  if (op === 'portrait_redraw_upload') {
    if (asset.category !== 'portrait') {
      const err = new Error('只有人像库的图可以高清重绘并上传');
      err.code = 'bad_request';
      throw err;
    }
    const portraitAdapter = pickPortraitAdapter(db);
    const genPath = portraitAdapter
      ? await generateWith(services, asset, PORTRAIT_PROMPT, portraitAdapter, portraitModel(db), '3:4')
      : await generateFromAsset(services, asset, PORTRAIT_PROMPT);
    const deriv = await createDerivative(services, {
      assetFid: fid,
      kind: 'portrait_redraw',
      srcPath: genPath,
      fileName: path.basename(genPath),
      mime: 'image/jpeg',
      params: { op: 'portrait_redraw' },
    });
    if (deriv && deriv.id) setMainDerivative(db, fid, deriv.id);
    const buffer = fs.readFileSync(genPath);
    const uploaded = await portraitLib.replaceUploadedPortrait(services, {
      fid,
      buffer,
      fileName: `${fid}-portrait.jpg`,
      name: asset.file_name || fid,
      user,
    });
    return { fid, op, derivativeId: deriv && deriv.id, portrait: uploaded };
  }
  const err = new Error('未知的预处理');
  err.code = 'bad_request';
  throw err;
}

module.exports = { runLibraryPrep, clothingPrompt };
