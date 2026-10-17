const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db', { readonly: true });
const umbra = require('../src/umbra');

async function test() {
  console.log('=== 测试 umbra.js 与 KX2BFK_umbra_quick 联调 ===');
  const cfg = umbra.getUmbraConfig(db);
  console.log('Resolved Umbra Config:', cfg);

  console.log('\n--- 1. 测试空间漫游提交 ---');
  try {
    const bindings = umbra.buildWalkthroughBindings({
      imageUrls: ['http://127.0.0.1:30001/mock1.jpg', 'http://127.0.0.1:30001/mock2.jpg'],
      spaces: '客厅,卧室',
      cameraStyle: 'smooth_walk'
    });
    console.log('Walkthrough Bindings:', bindings);

    const submitRes = await umbra.submitUmbraRun(db, {
      type: 'spatial_walkthrough',
      bindings
    });
    console.log('submitUmbraRun 成功! 返回:', submitRes);

    console.log('\n--- 2. 测试任务状态轮询 ---');
    const pollRes = await umbra.pollUmbraRun(db, submitRes.runId);
    console.log('pollUmbraRun 成功! 状态:', pollRes);
  } catch (e) {
    console.error('测试失败:', e.message);
  }
}

test().finally(() => db.close());
