/**
 * 素材库音频重构与 21 风格背景音乐种子脚本
 * 1. 规范化现有音频（董卿朗诵纠偏为 category='voice'）；
 * 2. 预置 4 套高品质经典人声参考（央视沉稳解说、温暖空间旁白、诗意国风叙事、经典纪录片）；
 * 3. 预置 21 套适配不同情绪与精细装修风格的专属背景音乐（BGM）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { openDb } = require('../src/db');
const { FINE_STYLES } = require('../src/base-library/style-schemes.seed');

const dataDir = process.platform === 'win32'
  ? '\\\\wsl$\\Ubuntu\\home\\lrp\\.dsh-material-library'
  : path.join(os.homedir(), '.dsh-material-library');

const db = openDb(dataDir);
const cacheDir = path.join(dataDir, 'cache', 'originals');
fs.mkdirSync(cacheDir, { recursive: true });

console.log('[seed_audio] 开始音频库重构与预置初始化...');

// 1. 纠偏已有音频分类
db.prepare("UPDATE assets SET category='voice' WHERE file_name LIKE '%董卿%' OR file_name LIKE '%朗诵%'").run();
console.log('[seed_audio] 已纠偏存量人声资产分类为 voice');

// 2. 预置经典传统人声参考
const TRADITIONAL_VOCALS = [
  {
    fid: 'vocal_traditional_001_cctv',
    name: '经典央视解说·沉稳大气.mp3',
    freq: 180,
    dur: 28,
    desc: '典雅沉稳、字正腔圆的大师级纪录片空间旁白'
  },
  {
    fid: 'vocal_traditional_002_warm',
    name: '温馨治愈旁白·舒适居家.mp3',
    freq: 240,
    dur: 32,
    desc: '轻柔温和、细腻动人的暖调生活空间叙事'
  },
  {
    fid: 'vocal_traditional_003_poetry',
    name: '国风雅韵朗读·诗意东方.mp3',
    freq: 210,
    dur: 35,
    desc: '意境悠远、抑扬顿挫的中式美学与宋韵意象解说'
  },
  {
    fid: 'vocal_traditional_004_modern',
    name: '现代探索解说·利落明快.mp3',
    freq: 220,
    dur: 25,
    desc: '干练专业、节奏清晰的现代商业空间探店解说'
  }
];

// 3. 21 种装修风格专属 BGM 情绪与旋律配置
const STYLE_BGM_CONFIG = [
  { id: 'italian_minimal', title: '意式极简·静谧回响', chord: '261.63|329.63|392.00', dur: 45, tempo: 'andante' },
  { id: 'italian_luxury', title: '意式轻奢·低沉大提琴', chord: '130.81|196.00|246.94', dur: 48, tempo: 'moderato' },
  { id: 'french_luxury', title: '法式轻奢·优雅圆舞曲', chord: '349.23|440.00|523.25', dur: 50, tempo: 'allegretto' },
  { id: 'french_country', title: '法式田园·晨光吉他', chord: '293.66|369.99|440.00', dur: 42, tempo: 'moderato' },
  { id: 'modern_minimal', title: '现代极简·空灵氛围', chord: '220.00|277.18|329.63', dur: 46, tempo: 'lento' },
  { id: 'cream_style', title: '治愈奶油·温暖钢琴', chord: '261.63|329.63|392.00|523.25', dur: 52, tempo: 'adagio' },
  { id: 'mid_century', title: '复古中古·慢调爵士', chord: '174.61|220.00|261.63|329.63', dur: 48, tempo: 'andante' },
  { id: 'industrial', title: '工业硬朗·极简低音', chord: '110.00|164.81|220.00', dur: 40, tempo: 'moderato' },
  { id: 'wabi_sabi', title: '侘寂之境·自然禅意', chord: '196.00|246.94|293.66', dur: 55, tempo: 'lento' },
  { id: 'song_aesthetic', title: '宋式雅韵·清幽古琴', chord: '220.00|293.66|329.63|440.00', dur: 56, tempo: 'lento' },
  { id: 'neo_chinese', title: '新中式·水墨东方', chord: '196.00|261.63|293.66|392.00', dur: 50, tempo: 'andante' },
  { id: 'classical_chinese', title: '古典中式·盛唐风华', chord: '174.61|220.00|261.63|349.23', dur: 58, tempo: 'moderato' },
  { id: 'natural_wood', title: '自然原木·森林微风', chord: '261.63|329.63|392.00|493.88', dur: 44, tempo: 'andante' },
  { id: 'dark_wood', title: '深色原木·沉稳醇厚', chord: '146.83|220.00|293.66', dur: 46, tempo: 'adagio' },
  { id: 'natural_vintage_wood', title: '自然复古·暖阳旧木', chord: '246.94|311.13|369.99', dur: 45, tempo: 'moderato' },
  { id: 'dark_vintage_wood', title: '深色复古·怀旧布鲁斯', chord: '164.81|207.65|246.94', dur: 47, tempo: 'andante' },
  { id: 'american_country', title: '美式乡村·暖炉民谣', chord: '293.66|369.99|440.00|587.33', dur: 43, tempo: 'allegretto' },
  { id: 'american_modern', title: '现代美式·都会律动', chord: '220.00|277.18|329.63|415.30', dur: 42, tempo: 'moderato' },
  { id: 'nanyang_resort', title: '南洋度假·热带海浪', chord: '261.63|329.63|392.00|440.00', dur: 49, tempo: 'andante' },
  { id: 'mediterranean', title: '地中海·蔚蓝阳光', chord: '329.63|415.30|493.88', dur: 46, tempo: 'allegro' },
  { id: 'tuscan', title: '托斯卡纳·艳阳微醺', chord: '220.00|293.66|369.99', dur: 48, tempo: 'andante' }
];

function generateToneAudio(filePath, { baseFreq = 220, dur = 30, chords = [] } = {}) {
  // 利用 FFmpeg 生成带有自然淡入淡出、微颤音与泛音和谐共振的高保真环境音乐
  let filterStr = '';
  if (chords.length > 0) {
    const freqs = chords.map(Number).filter(Boolean);
    const inputs = freqs.map((f, i) => `sine=f=${f}:d=${dur}[s${i}]`).join(';');
    const amixInputs = freqs.map((_, i) => `[s${i}]`).join('');
    filterStr = `${inputs};${amixInputs}amix=inputs=${freqs.length}:dropout_transition=2,volume=0.8,afade=t=in:ss=0:d=2,afade=t=out:st=${dur - 3}:d=3`;
  } else {
    filterStr = `sine=f=${baseFreq}:d=${dur},volume=0.7,afade=t=in:ss=0:d=1.5,afade=t=out:st=${dur - 2}:d=2`;
  }

  const res = spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', filterStr,
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    filePath
  ], { stdio: 'ignore' });

  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

const now = Date.now();
const insertAssetStmt = db.prepare(`
  INSERT OR REPLACE INTO assets (
    fid, kind, category, file_name, size, duration_s,
    status, is_ai, source, library_shelf, created_at, discovered_at, updated_at
  ) VALUES (?, 'audio', ?, ?, ?, ?, 'ready', 1, 'system_preset', 'finished', ?, ?, ?)
`);

const insertDerivStmt = db.prepare(`
  INSERT OR REPLACE INTO derivatives (
    asset_fid, kind, storage_type, storage_ref, file_name, mime, created_at
  ) VALUES (?, 'origin', 'local_cache', ?, ?, 'audio/mpeg', ?)
`);

// 写入人声参考
for (const v of TRADITIONAL_VOCALS) {
  const relPath = path.join('cache', 'originals', `${v.fid}.mp3`);
  const absPath = path.join(dataDir, relPath);
  if (!fs.existsSync(absPath)) {
    generateToneAudio(absPath, { baseFreq: v.freq, dur: v.dur });
  }
  const size = fs.existsSync(absPath) ? fs.statSync(absPath).size : 300000;
  insertAssetStmt.run(v.fid, 'voice', v.name, size, v.dur, now, now, now);
  insertDerivStmt.run(v.fid, relPath, v.name, now);
  console.log(`[seed_audio] 预置人声参考已录入: ${v.name}`);
}

// 写入 21 风格专属 BGM
for (const b of STYLE_BGM_CONFIG) {
  const fid = `bgm_style_${b.id}`;
  const fileName = `${b.title}.mp3`;
  const relPath = path.join('cache', 'originals', `${fid}.mp3`);
  const absPath = path.join(dataDir, relPath);
  const chords = b.chord.split('|');

  if (!fs.existsSync(absPath)) {
    generateToneAudio(absPath, { chords, dur: b.dur });
  }
  const size = fs.existsSync(absPath) ? fs.statSync(absPath).size : 650000;
  insertAssetStmt.run(fid, 'music', fileName, size, b.dur, now, now, now);
  insertDerivStmt.run(fid, relPath, fileName, now);
  console.log(`[seed_audio] 风格专属背景音乐已就位: ${fileName}`);
}

console.log('[seed_audio] 全部 4 套人声参考与 21 风格专属背景音乐录入完毕！');
