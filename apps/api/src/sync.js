/**
 * 夸克网盘自动同步模块 (已于 Phase 3 彻底退役)
 * 保留接口签名供存量调用无副作用返回
 */

const { toEpochMs } = require('./snapshot');

async function runScan(services, options = {}) {
  console.log('[sync] 夸克网盘同步已下线退役，跳过网盘扫描');
  return {
    newImg: 0,
    known: 0,
    decommissioned: true,
    message: '夸克网盘吸收链路已彻底停用'
  };
}

module.exports = {
  runScan,
  toEpochMs
};
