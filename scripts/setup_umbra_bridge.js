const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('/home/lrp/my_folder/smu/KX2BFK_umbra_quick/node_modules/@prisma/client');
const prisma = new PrismaClient();

const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const dbPath = '/home/lrp/.dsh-material-library/material.db';
const db = new betterSqlite(dbPath);

async function main() {
  console.log('=== Step 1: 启用 KX2BFK_umbra_quick 远程访问 ===');
  const remoteRes = await fetch('http://127.0.0.1:3001/api/v1/creation/remote/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const remoteData = await remoteRes.json();
  if (!remoteData.success) {
    throw new Error('启动远程访问失败: ' + JSON.stringify(remoteData));
  }
  const token = remoteData.data.token;
  console.log('远程访问已开启');
  const { setEnvAssignments } = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/src/env-keys');
  setEnvAssignments({ UMBRA_TOKEN: token });
  console.log('UMBRA_TOKEN 已写入 .env');

  console.log('\n=== Step 2: 检查并创建/发布契约模板 ===');
  const templates = await prisma.creationTemplate.findMany();
  let walkthroughTpl = templates.find(t => t.name.includes('漫游') && t.status === 'published');
  let touchTpl = templates.find(t => t.name.includes('触控') && t.status === 'published');

  const pkg = require('/home/lrp/my_folder/smu/KX2BFK_umbra_quick/packages/creation-workflow/dist/index.js');
  console.log('pkg exports:', Object.keys(pkg).filter(k => /walk|touch|dag|preset|project/i.test(k)));

  const getDag = (val) => (typeof val === 'function' ? val() : val);

  if (!walkthroughTpl) {
    console.log('创建并发布 spatial_walkthrough_video 模板...');
    const dagRaw = pkg.walkthroughDag || pkg.spatialWalkthroughVideoDag;
    const dag = getDag(dagRaw);
    const io = pkg.projectIo ? pkg.projectIo(dag) : (dag.ioSchema || { inputs: [], outputs: [] });
    walkthroughTpl = await prisma.creationTemplate.create({
      data: {
        name: '多空间室内漫游 (spatial_walkthrough_video)',
        description: '基于 Seedance 2.0 的多空间室内视频漫游成片工作流',
        status: 'published',
        engine: 'dag',
        draftDag: dag,
        publishedDag: dag,
        ioSchema: io
      }
    });
    console.log('漫游模板创建并发布成功! ID:', walkthroughTpl.id);
  } else {
    console.log('已存在漫游模板 ID:', walkthroughTpl.id);
  }

  if (!touchTpl) {
    console.log('创建并发布 touch_photo_editor 模板...');
    const dagRaw = pkg.touchPhotoEditorDag || pkg.touchDag;
    const dag = getDag(dagRaw);
    const io = pkg.projectIo ? pkg.projectIo(dag) : (dag.ioSchema || { inputs: [], outputs: [] });
    touchTpl = await prisma.creationTemplate.create({
      data: {
        name: '触控照片精修 (touch_photo_editor)',
        description: '室内设计局部替换/消除/插入/扩图/超分触控工作流',
        status: 'published',
        engine: 'dag',
        draftDag: dag,
        publishedDag: dag,
        ioSchema: io
      }
    });
    console.log('触控模板创建并发布成功! ID:', touchTpl.id);
  } else {
    console.log('已存在触控模板 ID:', touchTpl.id);
  }

  console.log('\n=== Step 3: 将配置持久化写入 MaterialLibraryServer kv 表 ===');
  const upsertKv = db.prepare(`
    INSERT INTO kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const configs = {
    umbra_base_url: 'http://127.0.0.1:3001',
    TPL_WALKTHROUGH: walkthroughTpl.id,
    TPL_TOUCH_EDITOR: touchTpl.id,
    bff_public_base: 'http://127.0.0.1:30001'
  };

  for (const [k, v] of Object.entries(configs)) {
    upsertKv.run(k, v);
    console.log(`KV [${k}] -> ${v}`);
  }

  console.log('\n=== Step 4: 验证公共契约端点联通性 ===');
  const listRes = await fetch('http://127.0.0.1:3001/api/v1/creation/public/templates', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  console.log('公共模板接口查询结果:', listData.success ? `成功! 共 ${listData.data.length} 个模板` : '失败!');
  for (const t of listData.data) {
    if (t.id === walkthroughTpl.id || t.id === touchTpl.id) {
      console.log(` - 匹配模板: ${t.name} (id: ${t.id})`);
    }
  }

  console.log('\n=== 全链路流程打通成功! ===');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    db.close();
  });
