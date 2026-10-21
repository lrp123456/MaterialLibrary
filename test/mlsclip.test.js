/**
 * .mlsclip 工程文件导出/导入回归，外加 zip 读写实现的自校验。
 *
 * 运行：node test/mlsclip.test.js
 *
 * zip 这块是手写的（src/clip-zip.js），所以两头都验：
 *   1. 自写→自读 字节一致；
 *   2. 自写→7z t 校验合法（7z 缺失时跳过并标注）；
 *   3. 7z 写→自读 内容一致（证明中央目录解析不是只认自己产的包）。
 * 端口/数据库与 clip-api.test.js 保持同一套桩：node:sqlite + 假登录。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

// ---- 桩掉鉴权，测试只关心接口语义 ----
const authPath = require.resolve(path.join(ROOT, 'src/auth.js'));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    verifySession: () => ({ id: 1, username: 'tester', role: 'admin' }),
  },
};

const { handleClipApi } = require(path.join(ROOT, 'src/clip-api.js'));
const { writeZip, openZip, crc32 } = require(path.join(ROOT, 'src/clip-zip.js'));

const SEVEN_ZIP = process.env.SEVEN_ZIP
  || 'C:/Program Files/7-Zip/7z.exe';
const has7z = fs.existsSync(SEVEN_ZIP);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsclip-test-'));
const originalsDir = path.join(dataDir, 'cache', 'originals');
fs.mkdirSync(originalsDir, { recursive: true });

// ---- 造素材：两个小视频 + 一个大文件（稀疏，只用来触发 500MB 上限）----
const videoBytes = Buffer.alloc(256 * 1024);
for (let i = 0; i < videoBytes.length; i += 1) videoBytes[i] = i % 251;
const audioBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(64 * 1024, 7)]);
fs.writeFileSync(path.join(originalsDir, 'fid_a.mp4'), videoBytes);
fs.writeFileSync(path.join(originalsDir, 'fid_b.m4a'), audioBytes);

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE assets (
    fid TEXT PRIMARY KEY, file_name TEXT, kind TEXT, width INTEGER, height INTEGER,
    duration_s REAL, thumb_url TEXT, size INTEGER, updated_at INTEGER
  );
`);
record('fid_a', '客厅.mp4', 'video', videoBytes.length);
record('fid_b', '旁白.m4a', 'audio', audioBytes.length);
record('fid_huge', '4K原片.mp4', 'video', 501 * 1024 * 1024);

function record(fid, fileName, kind, size) {
  db.prepare('INSERT INTO assets (fid,file_name,kind,width,height,duration_s,thumb_url,size,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(fid, fileName, kind, 1920, 1080, 12.5, '/t/x.jpg', size, Date.now());
}
// 501MB 稀疏文件：只有 stat 大小是真的，内容全 0，写盘不占空间
const hugePath = path.join(originalsDir, 'fid_huge.mp4');
fs.writeFileSync(hugePath, '');
fs.truncateSync(hugePath, 501 * 1024 * 1024);

const services = { db, config: { dataDir } };

const server = http.createServer((req, res) => {
  handleClipApi(services, req, res).then((handled) => {
    if (!handled && !res.headersSent) { res.writeHead(599); res.end('unhandled'); }
  }).catch((e) => {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
  });
});

function request({ method, urlPath, body, contentType = 'application/json' }) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, path: urlPath, method,
        headers: { 'Content-Type': contentType } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try { json = JSON.parse(buf.toString('utf8')); } catch { /* 二进制 */ }
          resolve({ status: res.statusCode, headers: res.headers, buffer: buf, text: buf.toString('utf8'), json });
        });
      },
    );
    req.on('error', (e) => resolve({ status: 0, text: String(e.message), json: null, buffer: Buffer.alloc(0) }));
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: String(detail) });
const note = (msg) => console.log(`  · ${msg}`);

function sevenZipTest(filePath) {
  if (!has7z) return null;
  const r = spawnSync(SEVEN_ZIP, ['t', filePath], { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/** 用 7z 生成一个外部 zip，验证我们读别人的包也没问题。 */
function makeExternalZip(dir) {
  if (!has7z) return null;
  const src = path.join(dir, 'ext-src');
  fs.mkdirSync(path.join(src, 'media'), { recursive: true });
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ format: 'mlsclip', version: 1 }));
  fs.writeFileSync(path.join(src, 'media', 'fid_x.mp4'), videoBytes);
  const out = path.join(dir, 'external.zip');
  const r = spawnSync(SEVEN_ZIP, ['a', '-tzip', '-mx=9', out, './*'], { cwd: src, encoding: 'utf8' });
  return r.status === 0 && fs.existsSync(out) ? out : null;
}

function makeProject(id, name) {
  return {
    metadata: {
      id, name, group: '', thumbnail: undefined,
      duration: 12.5,
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-21T00:00:00.000Z',
    },
    scenes: [{
      id: 'scene-main', name: '主场景', isMain: true, bookmarks: [],
      tracks: {
        video: [{ id: 'v1', elements: [{ id: 'el1', mediaId: 'local_media_1', startTime: 0, duration: 5 }] }],
        audio: [],
        text: [],
      },
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    }],
    currentSceneId: 'scene-main',
    settings: { fps: 30, width: 1920, height: 1080, background: '#000000' },
    version: 1,
    // 备份约定：local mediaId → 库内 fid，导入端据此重建引用
    mediaFidMap: { local_media_1: 'fid_a' },
  };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // ============ 1. zip 实现自校验 ============
  const zipDir = path.join(dataDir, 'ziptest');
  fs.mkdirSync(zipDir, { recursive: true });
  const selfZip = path.join(zipDir, 'self.zip');
  const manifestBytes = Buffer.from(JSON.stringify({ format: 'mlsclip', version: 1 }), 'utf8');
  writeZip(selfZip, [
    { name: 'manifest.json', data: manifestBytes },
    { name: 'media/大文件.bin', data: videoBytes },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'stored.bin', data: Buffer.from('store 方式不压缩'), compress: false },
  ]);
  const z = openZip(selfZip);
  check('zip：条目名与 UTF-8 中文按序读回',
    z.names.join(',') === 'manifest.json,media/大文件.bin,empty.txt,stored.bin', z.names.join(','));
  check('zip：manifest 内容一致', z.read('manifest.json').equals(manifestBytes), z.read('manifest.json').length);
  check('zip：256KB 媒体解压后字节一致', z.read('media/大文件.bin').equals(videoBytes), videoBytes.length);
  check('zip：空文件可读', z.read('empty.txt').length === 0, z.read('empty.txt').length);
  check('zip：store 条目保持原样', z.read('stored.bin').toString('utf8') === 'store 方式不压缩',
    z.read('stored.bin').toString('utf8'));
  check('zip：crc32 与 zlib 一致', crc32(Buffer.from('hello')) === 0x3610a686,
    crc32(Buffer.from('hello')).toString(16));

  const self7z = sevenZipTest(selfZip);
  if (self7z) {
    check('zip：7z t 校验通过', self7z.ok, self7z.out.split('\n').filter(Boolean).slice(-2).join(' | '));
  } else {
    note('未找到 7z，跳过外部校验');
  }

  const external = makeExternalZip(zipDir);
  if (external) {
    const ez = openZip(external);
    check('zip：能读 7z 生成的包（条目齐全）',
      ez.names.includes('manifest.json') && ez.names.some((n) => n.endsWith('fid_x.mp4')),
      ez.names.join(','));
    check('zip：7z 包内媒体内容一致',
      (ez.names.find((n) => n.endsWith('fid_x.mp4')) || '') &&
      ez.read(ez.names.find((n) => n.endsWith('fid_x.mp4'))).equals(videoBytes),
      'bytes');
  }

  // ============ 2. 导出（默认不含媒体）============
  const exportBody = {
    name: '客厅漫游',
    editorVersion: '0.2.10',
    includeMedia: false,
    project: makeProject('proj_local_1', '客厅漫游'),
    assets: [
      { fid: 'fid_a', name: '客厅.mp4', mime: 'video/mp4', size: videoBytes.length },
      { fid: 'fid_b', name: '旁白.m4a', mime: 'audio/mp4', size: audioBytes.length },
    ],
  };

  let r = await request({
    method: 'POST', urlPath: '/editor-api/projects/proj_local_1/export',
    body: JSON.stringify(exportBody),
  });
  check('导出：返回 ok + downloadUrl + size',
    r.status === 200 && r.json.ok === true && !!r.json.downloadUrl && r.json.size > 0,
    `${r.status} ${r.text.slice(0, 200)}`);
  check('导出：默认不内嵌媒体（embedded=0）',
    r.json.embedded === 0 && Array.isArray(r.json.warnings) && r.json.warnings.length === 0,
    `${r.json.embedded} ${JSON.stringify(r.json.warnings)}`);

  const exportUrl = r.json.downloadUrl;
  const filename = r.json.filename;
  check('导出：文件名以 .mlsclip 结尾', /\.mlsclip$/.test(filename), filename);

  r = await request({ method: 'GET', urlPath: exportUrl });
  check('导出：downloadUrl 可取回 zip', r.status === 200 && r.buffer.length > 0, `${r.status} ${r.buffer.length}`);
  check('导出：Content-Type 为 zip', /zip/.test(r.headers['content-type'] || ''), r.headers['content-type']);
  const exportedZipPath = path.join(zipDir, 'exported.mlsclip');
  fs.writeFileSync(exportedZipPath, r.buffer);
  const exported7z = sevenZipTest(exportedZipPath);
  if (exported7z) {
    check('导出：7z t 校验导出包合法', exported7z.ok,
      exported7z.out.split('\n').filter(Boolean).slice(-2).join(' | '));
  }

  const zz = openZip(exportedZipPath);
  check('导出：包内四件套齐全（manifest/project/assets）',
    zz.has('manifest.json') && zz.has('project.json') && zz.has('assets.json'),
    zz.names.join(','));
  check('导出：默认包内没有 media/ 条目',
    !zz.names.some((n) => n.startsWith('media/')), zz.names.join(','));

  const manifest = zz.readJson('manifest.json');
  check('导出：manifest 字段符合约定',
    manifest.format === 'mlsclip' && manifest.version === 1 && manifest.hasMedia === false
      && manifest.projectId === 'proj_local_1' && manifest.name === '客厅漫游'
      && typeof manifest.createdAt === 'string' && manifest.editorVersion === '0.2.10',
    JSON.stringify(manifest));

  const assetsJson = zz.readJson('assets.json');
  const aEntry = assetsJson.find((a) => a.fid === 'fid_a');
  check('导出：assets.json 记录 fid/size/sha256/mime/embedded',
    assetsJson.length === 2 && aEntry && aEntry.embedded === false
      && aEntry.size === videoBytes.length && /^[0-9a-f]{64}$/.test(aEntry.sha256)
      && aEntry.mime === 'video/mp4' && aEntry.name === '客厅.mp4',
    JSON.stringify(aEntry));
  check('导出：sha256 与实际文件一致',
    aEntry.sha256 === require('crypto').createHash('sha256').update(videoBytes).digest('hex'),
    aEntry.sha256);

  const projectJson = zz.readJson('project.json');
  check('导出：project.json 保留工程全量（含 mediaFidMap）',
    projectJson.metadata.id === 'proj_local_1'
      && projectJson.scenes.length === 1
      && projectJson.mediaFidMap.local_media_1 === 'fid_a',
    JSON.stringify(projectJson.metadata));

  // ============ 3. 导出（含媒体 + 500MB 上限）============
  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/proj_local_1/export',
    body: JSON.stringify({
      ...exportBody,
      includeMedia: true,
      assets: [
        ...exportBody.assets,
        { fid: 'fid_huge', name: '4K原片.mp4', mime: 'video/mp4', size: 501 * 1024 * 1024 },
      ],
    }),
  });
  check('导出含媒体：超 500MB 的素材被强转为不内嵌',
    r.status === 200 && r.json.embedded === 2
      && r.json.warnings.some((w) => /4K原片\.mp4/.test(w) && /500MB/.test(w)),
    `${r.status} embedded=${r.json.embedded} ${JSON.stringify(r.json.warnings)}`);

  const withMedia = await request({ method: 'GET', urlPath: r.json.downloadUrl });
  const mediaZipPath = path.join(zipDir, 'with-media.mlsclip');
  fs.writeFileSync(mediaZipPath, withMedia.buffer);
  const mz = openZip(mediaZipPath);
  check('导出含媒体：media/<fid>.<ext> 存在',
    mz.has('media/fid_a.mp4') && mz.has('media/fid_b.m4a'), mz.names.join(','));
  check('导出含媒体：内嵌字节与原文件一致',
    mz.read('media/fid_a.mp4').equals(videoBytes), mz.read('media/fid_a.mp4').length);
  const mManifest = mz.readJson('manifest.json');
  check('导出含媒体：manifest.hasMedia=true', mManifest.hasMedia === true, JSON.stringify(mManifest));
  const mAssets = mz.readJson('assets.json');
  const hugeEntry = mAssets.find((a) => a.fid === 'fid_huge');
  check('导出含媒体：超大素材 embedded=false 且仍有 sha256',
    hugeEntry && hugeEntry.embedded === false && /^[0-9a-f]{64}$/.test(hugeEntry.sha256),
    JSON.stringify(hugeEntry));
  if (has7z) {
    const t = sevenZipTest(mediaZipPath);
    check('导出含媒体：7z t 校验通过', t.ok, t.out.split('\n').filter(Boolean).slice(-2).join(' | '));
  }

  // ============ 4. 导入 ============
  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/import',
    body: withMedia.buffer, contentType: 'application/zip',
  });
  check('导入：返回新 projectId 且素材不缺',
    r.status === 200 && r.json.ok === true && /^proj_/.test(r.json.projectId || '')
      && r.json.missing.length === 0,
    `${r.status} ${r.text.slice(0, 240)}`);
  check('导入：工程结构原样保留，id 换新',
    r.json.project.metadata.name === '客厅漫游'
      && r.json.project.metadata.id === r.json.projectId
      && r.json.project.scenes.length === 1
      && r.json.project.mediaFidMap.local_media_1 === 'fid_a',
    JSON.stringify(r.json.project && r.json.project.metadata));
  check('导入：库里已有素材不再重复下载',
    Array.isArray(r.json.media) && r.json.media.length === 0, JSON.stringify(r.json.media));

  const stored = db.prepare('SELECT id,name,data,rev FROM editor_projects WHERE id=?').get(r.json.projectId);
  check('导入：服务端留有工程记录（rev=1）',
    !!stored && stored.name === '客厅漫游' && Number(stored.rev) === 1
      && JSON.parse(stored.data).metadata.id === r.json.projectId,
    stored ? stored.id : 'none');

  // 缺素材：包里引用了库里没有的 fid，且没内嵌
  const missingZip = path.join(zipDir, 'missing.mlsclip');
  writeZip(missingZip, [
    { name: 'manifest.json', data: JSON.stringify({ format: 'mlsclip', version: 1, createdAt: new Date().toISOString(), editorVersion: '0.2.10', projectId: 'p_old', name: '缺素材工程', hasMedia: false }) },
    { name: 'project.json', data: JSON.stringify(makeProject('p_old', '缺素材工程')) },
    { name: 'assets.json', data: JSON.stringify([
      { fid: 'fid_a', name: '客厅.mp4', size: videoBytes.length, sha256: '', mime: 'video/mp4', embedded: false },
      { fid: 'fid_gone', name: '丢失的镜头.mp4', size: 10, sha256: '', mime: 'video/mp4', embedded: false },
    ]) },
  ]);
  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/import',
    body: fs.readFileSync(missingZip), contentType: 'application/zip',
  });
  check('导入缺素材：不失败，只返回 missing 清单',
    r.status === 200 && r.json.ok === true
      && r.json.missing.length === 1
      && r.json.missing[0].fid === 'fid_gone'
      && r.json.missing[0].name === '丢失的镜头.mp4',
    `${r.status} ${JSON.stringify(r.json && r.json.missing)}`);
  check('导入缺素材：已在库的素材不算缺',
    r.json.missing.every((m) => m.fid !== 'fid_a'), JSON.stringify(r.json.missing));

  // 内嵌但库里没有的素材：应产出 media 下载地址
  const embeddedZip = path.join(zipDir, 'embedded.mlsclip');
  writeZip(embeddedZip, [
    { name: 'manifest.json', data: JSON.stringify({ format: 'mlsclip', version: 1, createdAt: new Date().toISOString(), editorVersion: '0.2.10', projectId: 'p_old', name: '带素材工程', hasMedia: true }) },
    { name: 'project.json', data: JSON.stringify(makeProject('p_old', '带素材工程')) },
    { name: 'assets.json', data: JSON.stringify([
      { fid: 'fid_new', name: '新镜头.mp4', size: videoBytes.length, sha256: require('crypto').createHash('sha256').update(videoBytes).digest('hex'), mime: 'video/mp4', embedded: true },
    ]) },
    { name: 'media/fid_new.mp4', data: videoBytes },
  ]);
  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/import',
    body: fs.readFileSync(embeddedZip), contentType: 'application/zip',
  });
  check('导入内嵌素材：返回可下载的 media 项',
    r.status === 200 && r.json.media.length === 1 && r.json.missing.length === 0
      && /^\/editor-api\/projects\/imports\/[^/]+\/media\//.test(r.json.media[0].url || ''),
    `${r.status} ${JSON.stringify(r.json && r.json.media)}`);

  if (r.json.media && r.json.media[0]) {
    const mediaRes = await request({ method: 'GET', urlPath: r.json.media[0].url });
    check('导入内嵌素材：下载内容与包内一致',
      mediaRes.status === 200 && mediaRes.buffer.equals(videoBytes),
      `${mediaRes.status} ${mediaRes.buffer.length}`);
  }

  // ============ 5. 校验与错误分支 ============
  const badVersionZip = path.join(zipDir, 'v2.mlsclip');
  writeZip(badVersionZip, [
    { name: 'manifest.json', data: JSON.stringify({ format: 'mlsclip', version: 2, name: '未来版本' }) },
    { name: 'project.json', data: JSON.stringify(makeProject('p', 'n')) },
  ]);
  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/import',
    body: fs.readFileSync(badVersionZip), contentType: 'application/zip',
  });
  check('导入：manifest 版本过高被拒 400', r.status === 400 && /版本 2/.test(r.json.error || ''),
    `${r.status} ${r.json && r.json.error}`);

  const notMlsclip = path.join(zipDir, 'other.mlsclip');
  writeZip(notMlsclip, [{ name: 'manifest.json', data: JSON.stringify({ format: 'other', version: 1 }) }]);
  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/import',
    body: fs.readFileSync(notMlsclip), contentType: 'application/zip',
  });
  check('导入：非 mlsclip 包被拒 400', r.status === 400 && /不是 \.mlsclip/.test(r.json.error || ''),
    `${r.status} ${r.json && r.json.error}`);

  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/import',
    body: Buffer.from('这不是 zip'), contentType: 'application/zip',
  });
  check('导入：非 zip 内容被拒 400', r.status === 400, `${r.status} ${r.json && r.json.error}`);

  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/proj_local_1/export',
    body: JSON.stringify({ project: { metadata: { id: 'x', name: 'y' } }, assets: [{ fid: 'fid_nope' }] }),
  });
  check('导出：清单里有未入库素材被拒 400 并列出 fid',
    r.status === 400 && Array.isArray(r.json.missing) && r.json.missing[0] === 'fid_nope',
    `${r.status} ${r.text.slice(0, 120)}`);

  r = await request({
    method: 'POST', urlPath: '/editor-api/projects/proj_local_1/export',
    body: JSON.stringify({ project: { scenes: [] } }),
  });
  check('导出：缺 metadata 被拒 400', r.status === 400, `${r.status} ${r.text.slice(0, 120)}`);

  r = await request({ method: 'GET', urlPath: '/editor-api/projects/exports/export_nope_000000' });
  check('下载：不存在的导出包 404', r.status === 404, `${r.status}`);

  // 不命中工程文件路由的路径不能被吞掉（交回 editor-projects）
  r = await request({ method: 'GET', urlPath: '/editor-api/projects/proj_local_1' });
  check('未命中的 /projects/:id 交回 editor-projects', r.status === 599, `${r.status}`);

  server.close();

  console.log('\n=== .mlsclip 工程文件回归 ===');
  let fail = 0;
  for (const x of results) {
    if (!x.pass) fail += 1;
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}   [${x.detail.slice(0, 150)}]`);
  }
  console.log(`\n合计 ${results.length} 项，失败 ${fail} 项${has7z ? '' : '（7z 相关项已跳过）'}`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
