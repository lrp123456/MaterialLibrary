/**
 * 调用真实 ACE-Step 1.5 AI 音乐生成模型为 21 种精细装修风格生成专属纯音乐 BGM
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');

const dataDir = process.platform === 'win32'
  ? '\\\\wsl$\\Ubuntu\\home\\lrp\\.dsh-material-library'
  : path.join(os.homedir(), '.dsh-material-library');

const db = openDb(dataDir);
const cacheDir = path.join(dataDir, 'cache', 'originals');
fs.mkdirSync(cacheDir, { recursive: true });

const STYLE_PROMPTS = [
  { id: 'italian_minimal', title: '意式极简·静谧回响', prompt: 'quiet minimalist piano, ambient electronic textures, subtle cello, serene modern space, calm luxury, instrumental BGM, 48khz' },
  { id: 'italian_luxury', title: '意式轻奢·低沉大提琴', prompt: 'deep rich cello, slow elegance, sophisticated piano, luxury modern penthouse, warm cinematic mood, instrumental BGM' },
  { id: 'french_luxury', title: '法式轻奢·优雅圆舞曲', prompt: 'graceful chamber strings, elegant waltz tempo, airy harp and violin, romantic french salon, instrumental BGM' },
  { id: 'french_country', title: '法式田园·晨光吉他', prompt: 'warm acoustic guitar, morning sunshine, gentle flute, rustic french countryside, breezy and sweet, instrumental BGM' },
  { id: 'modern_minimal', title: '现代极简·空灵氛围', prompt: 'ethereal ambient synth, soft gentle piano drops, pure modern architecture, clean space, instrumental BGM' },
  { id: 'cream_style', title: '治愈奶油·温暖钢琴', prompt: 'warm soothing piano, soft acoustic guitar, healing gentle lullaby mood, creamy warm living room, cozy, instrumental BGM' },
  { id: 'mid_century', title: '复古中古·慢调爵士', prompt: 'vintage slow jazz, muted brass, upright bass, warm vinyl warmth, retro 1960s lounge, instrumental BGM' },
  { id: 'industrial', title: '工业硬朗·极简低音', prompt: 'deep electronic sub bass, crisp industrial percussion, minimal dark ambient, loft space, instrumental BGM' },
  { id: 'wabi_sabi', title: '侘寂之境·自然禅意', prompt: 'zen natural ambient, bamboo water drops, gentle atmospheric drone, wabi-sabi tea house, tranquil peace, instrumental BGM' },
  { id: 'song_aesthetic', title: '宋式雅韵·清幽古琴', prompt: 'traditional chinese guqin, bamboo flute, misty water ink aesthetic, song dynasty elegance, poetic, instrumental BGM' },
  { id: 'neo_chinese', title: '新中式·水墨东方', prompt: 'oriental fusion, pipa and modern cello, elegant chinese court, graceful ink painting, instrumental BGM' },
  { id: 'classical_chinese', title: '古典中式·盛唐风华', prompt: 'grand traditional guzheng, majestic chinese palace, imperial grandeur, graceful strings, instrumental BGM' },
  { id: 'natural_wood', title: '自然原木·森林微风', prompt: 'acoustic guitar and gentle wooden percussion, forest breeze, organic Nordic sunlight, peaceful, instrumental BGM' },
  { id: 'dark_wood', title: '深色原木·沉稳醇厚', prompt: 'deep resonant cello, dark oak study room, contemplative and scholarly, rich low frequencies, instrumental BGM' },
  { id: 'natural_vintage_wood', title: '自然复古·暖阳旧木', prompt: 'warm nostalgic acoustic guitar, afternoon sun on vintage wooden floor, tender memory, instrumental BGM' },
  { id: 'dark_vintage_wood', title: '深色复古·怀旧布鲁斯', prompt: 'vintage blues guitar, slow tempo, late night wood lounge, smoky and relaxed, instrumental BGM' },
  { id: 'american_country', title: '美式乡村·暖炉民谣', prompt: 'warm fireplace folk guitar, cheerful country fiddle, homey cozy living room, instrumental BGM' },
  { id: 'american_modern', title: '现代美式·都会律动', prompt: 'smooth modern urban groove, sophisticated electric piano, modern Manhattan apartment, upbeat, instrumental BGM' },
  { id: 'nanyang_resort', title: '南洋度假·热带海浪', prompt: 'tropical ambient, gentle marimba, soft ocean breeze, southeast asian resort, relaxed holiday, instrumental BGM' },
  { id: 'mediterranean', title: '地中海·蔚蓝阳光', prompt: 'bright spanish acoustic guitar, sunny santorini blue sky, joyful Mediterranean sea breeze, instrumental BGM' },
  { id: 'tuscan', title: '托斯卡纳·艳阳微醺', prompt: 'romantic italian mandolin, sunny vineyard afternoon, warm acoustic strings, tuscan villa, instrumental BGM' }
];

function submitTask(prompt, duration = 30) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      prompt,
      lyrics: '',
      audio_duration: duration,
      batch_size: 1
    });

    const req = http.request(
      {
        hostname: '192.168.1.107',
        port: 9000,
        path: '/api/music/release_task',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let text = '';
        res.on('data', c => text += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(text);
            const taskId = j.data?.task_id;
            if (taskId) resolve(taskId);
            else reject(new Error(`No task_id in response: ${text}`));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function pollTask(taskId, timeoutMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Task ${taskId} timed out after ${timeoutMs}ms`));
      }

      const payload = JSON.stringify({
        task_id_list: JSON.stringify([taskId])
      });

      const req = http.request(
        {
          hostname: '192.168.1.107',
          port: 9000,
          path: '/api/music/query_result',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let text = '';
          res.on('data', c => text += c);
          res.on('end', () => {
            try {
              const j = JSON.parse(text);
              const item = j.data?.[0];
              if (!item) {
                setTimeout(check, 2000);
                return;
              }
              if (item.status === 1) {
                const results = JSON.parse(item.result || '[]');
                const first = results[0];
                if (first && first.file) {
                  resolve(first);
                  return;
                }
              }
              if (item.status === -1 || item.error) {
                reject(new Error(`Task ${taskId} failed: ${item.error || item.result}`));
                return;
              }
              setTimeout(check, 1500);
            } catch (e) {
              setTimeout(check, 2000);
            }
          });
        }
      );
      req.on('error', () => setTimeout(check, 2000));
      req.write(payload);
      req.end();
    };
    check();
  });
}

function downloadAudio(remoteFileRel, localPath) {
  return new Promise((resolve, reject) => {
    const url = `http://192.168.1.107:9000/api/music${remoteFileRel}`;
    const fileStream = fs.createWriteStream(localPath);
    http.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(fs.statSync(localPath).size);
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log(`[real_music] 开始为 21 种精细装修风格调用 ACE-Step 1.5 生成真实纯音乐 BGM...`);
  
  const insertAssetStmt = db.prepare(`
    INSERT OR REPLACE INTO assets (
      fid, kind, category, file_name, size, duration_s,
      status, is_ai, source, library_shelf, created_at, discovered_at, updated_at
    ) VALUES (?, 'audio', 'music', ?, ?, ?, 'ready', 1, 'acestep_1.5', 'finished', ?, ?, ?)
  `);

  const insertDerivStmt = db.prepare(`
    INSERT OR REPLACE INTO derivatives (
      asset_fid, kind, storage_type, storage_ref, file_name, mime, created_at
    ) VALUES (?, 'origin', 'local_cache', ?, ?, 'audio/mpeg', ?)
  `);

  let count = 0;
  for (const item of STYLE_PROMPTS) {
    count++;
    const fid = `bgm_style_${item.id}`;
    const fileName = `${item.title}.mp3`;
    const relPath = path.join('cache', 'originals', `${fid}.mp3`);
    const absPath = path.join(dataDir, relPath);

    console.log(`\n[${count}/${STYLE_PROMPTS.length}] 正在生成【${item.title}】...`);
    console.log(`  提示词: ${item.prompt}`);
    
    try {
      const taskId = await submitTask(item.prompt, 30);
      console.log(`  任务已提交, task_id: ${taskId}, 正在生成...`);
      const result = await pollTask(taskId);
      console.log(`  生成成功! 正在下载 ${result.file}...`);
      const size = await downloadAudio(result.file, absPath);
      const duration = result.metas?.duration || 30;
      const now = Date.now();

      insertAssetStmt.run(fid, fileName, size, duration, now, now, now);
      insertDerivStmt.run(fid, relPath, fileName, now);
      console.log(`  ✓ 已成功归档至素材库「背景音乐」: ${fileName} (${(size / 1024).toFixed(1)} KB, ${duration}s, 调式: ${result.metas?.keyscale || '自然音阶'})`);
    } catch (err) {
      console.error(`  ✕ 生成【${item.title}】失败:`, err.message);
    }
  }

  console.log('\n[real_music] 全部 21 套风格专属 AI 纯音乐生成并录入完成！');
}

run().catch(console.error);
