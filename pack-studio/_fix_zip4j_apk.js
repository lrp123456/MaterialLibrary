/**
 * 给基座 APK 补上 zip4j（d8 编译 → 注入 classes3.dex → apksigner 同签名重签）
 *
 * 背景（2026-10-03 设备实证）：
 *   点「立即更新」→ plus.runtime.install → 基座 APK 立刻 FATAL：
 *     Unresolved exception class when finding catch block:
 *       net.lingala.zip4j.exception.ZipException
 *     java.lang.NullPointerException: Attempt to read from null array
 *       at io.dcloud.feature.pdr.RuntimeFeatureImpl$a.run
 *   反查 base.apk 的 classes.dex：pdr 的 15 个类都在，
 *   但 zip4j 只有 2 个类名「引用」、0 个类「定义」——依赖被裁掉了。
 *   这是 DCloud 离线打包的已知问题，官方要求自行补依赖：
 *     implementation 'net.lingala.zip4j:zip4j:2.11.5'
 *   本机没有 gradle 发行版，无法跑 assembleRelease，
 *   因此改走等效路径：d8 直接把 zip4j 编成 dex 塞进 APK。
 *
 * 用法：node _fix_zip4j_apk.js <源APK> <输出APK>
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const JAVA_HOME = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\amazon-corretto';
const SDK = 'C:\\Android\\Sdk';
const D8 = path.join(SDK, 'build-tools', '35.0.0', 'd8.bat');
const APKSIGNER = path.join(SDK, 'build-tools', '35.0.0', 'apksigner.bat');
const ZIPALIGN = path.join(SDK, 'build-tools', '35.0.0', 'zipalign.exe');
const KEYSTORE = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\app-safe-pack\\Test.keystore';
const KEY_ALIAS = 'android';
const KEY_PASS = '123456';
const ANDROID_JAR = path.join(SDK, 'platforms', 'android-34', 'android.jar');
const MIN_API = '26';

const env = {
  ...process.env,
  JAVA_HOME,
  PATH: JAVA_HOME + '\\bin;' + (process.env.PATH || ''),
};

function findZip4jJar() {
  const root = path.join(os.homedir(), '.gradle', 'caches', 'modules-2', 'files-2.1', 'net.lingala.zip4j');
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.jar')) return p;
    }
  }
  throw new Error('gradle 缓存里找不到 zip4j 的 jar');
}

function run(cmd, args, opts = {}) {
  // Node 22 在 Windows 上不能直接 spawn .bat（EINVAL），统一经 cmd /c 转发。
  // 路径全部含空格/中文，参数用双引号包起来。
  const quoted = args.map((a) => (/[\s"]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a)));
  const isBat = /\.bat$/i.test(cmd);
  const finalCmd = isBat ? process.env.ComSpec || 'cmd.exe' : cmd;
  // cmd /c 后面的整条命令直接拼成一个字符串交给它解析。
  // 不要加最外层引号 —— cmd 会把 \" 当成命令名的一部分
  // （报「'xxx' 不是内部或外部命令」）。单个含空格的参数各自加引号即可。
  const finalArgs = isBat ? ['/d', '/c', cmd + ' ' + quoted.join(' ')] : args;
  return execFileSync(finalCmd, finalArgs, {
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    ...opts,
  });
}

/** 解析 dex 的 class_def 表，确认 zip4j 的类真的在里面（只靠字符串会误判） */
function dexClassDefs(dex) {
  const out = new Set();
  const u32 = (o) => dex.readUInt32LE(o);
  const sidOff = u32(60), tidOff = u32(68), nDefs = u32(96), defOff = u32(100);
  // dex 的 string_data 是 uleb128 长度 + MUTF-8。必须返回「读完长度后的新位置」，
  // 否则从长度字节本身去找终止 0，得到的是空串（这个坑踩过一次）。
  const ulebAt = (o) => {
    let r = 0, s = 0, p = o;
    for (;;) { const b = dex[p++]; r |= (b & 0x7f) << s; s += 7; if (!(b & 0x80)) break; }
    return [r, p];
  };
  // 类描述符全是 ASCII，latin1 不会误解码，也不会被 0xC0 0x80 干扰。
  const str = (i) => {
    const [, p] = ulebAt(u32(sidOff + i * 4));
    return dex.toString('latin1', p, dex.indexOf(0, p));
  };
  const type = (i) => str(u32(tidOff + i * 4));
  for (let i = 0; i < nDefs; i++) out.add(type(u32(defOff + i * 32)));
  return out;
}

function main() {
  const src = process.argv[2] || path.join(
    os.homedir(), 'DevEcoStudioProjects', 'AlbumSyncUniAppX',
    'android-offline', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const dst = process.argv[3] || path.resolve(__dirname, 'base-with-zip4j.apk');
  if (!fs.existsSync(src)) throw new Error('源 APK 不存在: ' + src);

  const work = path.join(__dirname, 'zip4j-build');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  // 1) d8：zip4j.jar -> classes.dex
  const jar = findZip4jJar();
  console.log('[1/5] d8 编译 zip4j\n     jar = ' + jar);
  const dexDir = path.join(work, 'dex');
  fs.mkdirSync(dexDir);
  run(D8, ['--release', '--min-api', MIN_API, '--lib', ANDROID_JAR, '--output', dexDir, jar], { quiet: true });
  const dexPath = path.join(dexDir, 'classes.dex');
  if (!fs.existsSync(dexPath)) throw new Error('d8 没有产出 classes.dex');
  const dex = fs.readFileSync(dexPath);
  const defs = dexClassDefs(dex);
  const need = [
    'Lnet/lingala/zip4j/ZipFile;',
    'Lnet/lingala/zip4j/exception/ZipException;',
    'Lnet/lingala/zip4j/io/inputstream/ZipInputStream;',
  ];
  for (const n of need) {
    if (!defs.has(n)) throw new Error('生成的 dex 里缺类定义: ' + n);
  }
  console.log('     dex ' + dex.length + 'B，zip4j 类定义 ' +
    [...defs].filter((c) => c.includes('zip4j')).length + ' 个，关键类齐全 ✓');

  // 2) 解包 APK（Node 原生 zip 读写，pack-studio 已有 readZipEntries）
  const { readZipEntries, readZipFile } = require('./lib/push-update');
  const srcBuf = fs.readFileSync(src);
  const entries = readZipEntries(srcBuf);
  const names = [...entries.keys()];
  console.log('[2/5] 源 APK ' + names.length + ' 个条目');
  if (names.includes('classes3.dex')) {
    throw new Error('源 APK 已有 classes3.dex，无法安全注入。请改用 classes4.dex 或重命名后再试。');
  }
  // zip4j 只需要「类定义」，不需要原 zip4j 的资源/清单
  const skip = new Set();
  for (const n of names) {
    // 去掉旧的签名块，重签会重新生成
    if (/^META-INF\/.*\.(RSA|DSA|EC|SF|MF)$/i.test(n)) skip.add(n);
  }

  // 3) 重新打包（沿用 wgt-pipeline 的 zipDir 逻辑，append classes3.dex）
  const zlib = require('zlib');
  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  const payload = [];
  for (const n of names) {
    if (skip.has(n)) continue;
    const e = entries.get(n);
    payload.push({ name: n, data: readZipFile(entries, n), method: e.method });
  }
  // manifest 里 classes3.dex 不需要登记（Android 自动按序加载 classes.dex/classes2.dex/...）。
  // 压缩方式跟随现有 classes2.dex，保证风格一致。
  const dexMethod = (entries.get('classes2.dex') || entries.get('classes.dex') || { method: 8 }).method;
  payload.push({ name: 'classes3.dex', data: dex, method: dexMethod });
  console.log('[3/5] 待写入 ' + payload.length + ' 个条目（含 classes3.dex，跳过旧签名 ' + skip.size + ' 个）');

  // 压缩方式必须逐条沿用原 APK 的：
  //   本工程的 lib/**/*.so 在原包里是 deflate（AndroidManifest extractNativeLibs=true，
  //   安装时解压到 lib/），如果这里一律 store，5 个 ABI 的 so 全部不压缩，
  //   APK 会从 79MB 暴涨到 154MB。踩过一次。
  const chunks = [];
  const central = [];
  let offset = 0;
  let deflated = 0;
  for (const { name, data, method } of payload) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const m = method === 0 ? 0 : 8;
    const body = m === 0 ? data : zlib.deflateRawSync(data, { level: 9 });
    if (m === 8) deflated++;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(m, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(m, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(payload.length, 8);
  eocd.writeUInt16LE(payload.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const unsigned = path.join(work, 'unsigned.apk');
  fs.writeFileSync(unsigned, Buffer.concat([...chunks, centralBuf, eocd]));
  console.log('     deflate ' + deflated + ' 条 / store ' + (payload.length - deflated) + ' 条（逐条沿用原包）');
  console.log('     unsigned ' + fs.statSync(unsigned).size + 'B（原 APK ' + srcBuf.length + 'B）');

  // 4) zipalign
  const aligned = path.join(work, 'aligned.apk');
  run(ZIPALIGN, ['-f', '-p', '4', unsigned, aligned], { quiet: true });
  console.log('[4/5] zipalign 完成 ' + fs.statSync(aligned).size + 'B');

  // 5) 同 keystore 重签（必须同一签名，否则装不上/覆盖不了已装 App）
  run(APKSIGNER, [
    'sign',
    '--ks', KEYSTORE,
    '--ks-key-alias', KEY_ALIAS,
    '--ks-pass', 'pass:' + KEY_PASS,
    '--key-pass', 'pass:' + KEY_PASS,
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--out', dst,
    aligned,
  ], { quiet: true });
  const v = run(APKSIGNER, ['verify', '--print-certs', dst], { quiet: true });
  const sha = (v.match(/SHA-256 digest: ([0-9a-f]+)/) || [])[1] || '(未知)';
  console.log('[5/5] 重签完成 → ' + dst);
  console.log('     签名 SHA-256 = ' + sha + '（须与原 APK 一致：b01d06180d003e79c7b9088993b8e5ae7a19b0da1161aa097c7f398a6f514fa7）');
  console.log(sha === 'b01d06180d003e79c7b9088993b8e5ae7a19b0da1161aa097c7f398a6f514fa7'
    ? '     ✓ 签名一致，可直接覆盖安装'
    : '     ✗ 签名不一致！不能覆盖安装');
}

main();
