/**
 * 实机验证 2：编译失败链路
 * 在隔离目录的副本里注入一个 import 路径错误（不碰用户源码），
 * 确认：① 闸门如实报错并带出真实错误  ② 不产出任何 wgt  ③ 不回退旧产物
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildWgt } = require('./lib/wgt-pipeline');

const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const OUT = path.join(require('os').tmpdir(), 'pack-studio-test-out');

function listWgt() {
  try {
    return fs.readdirSync(OUT).filter((f) => f.endsWith('.wgt'));
  } catch (e) {
    return [];
  }
}

console.log('[setup] 出包目录:', OUT, '现有 wgt:', listWgt().length);

// 注入真实的 import 路径错误 —— 这正是 10-03 那次事故的根因
// （QuickModelPicker.vue 写成了 ../../common/jobModels，实际应为 ../common/jobModels）
process.env.FAULT_INJECT = 'bad-import';
console.log('[setup] FAULT_INJECT =', process.env.FAULT_INJECT, '（仅注入隔离副本，用户源码不动）');

buildWgt(APP, { outDir: OUT, note: '故障注入测试', onLog: (l) => process.stdout.write(l) })
  .then((m) => {
    console.log('\n[结果] 竟然出包了 => FAIL', m.file);
    process.exitCode = 1;
  })
  .catch((e) => {
    console.log('\n[结果1] 如实报错 => PASS');
    console.log('  message:', e.message.split('\n')[0]);
    console.log('  buildErrors:', JSON.stringify(e.buildErrors || [], null, 2));
    const wgts = listWgt();
    console.log('[结果2] 未产出新 wgt =>', wgts.length === 0 ? 'PASS' : 'FAIL ' + wgts.join(','));
    process.exitCode = 0;
  });
