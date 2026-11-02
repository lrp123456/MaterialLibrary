/**
 * 灵感空间素材库内存事件总线 (AppEventBus)
 * 支撑客户端 SSE 实时推送与长任务/Worker 状态解耦
 */
const EventEmitter = require('events');

class AppEventBus extends EventEmitter {}
const eventBus = new AppEventBus();
eventBus.setMaxListeners(200);

const EVENTS = {
  TASK_UPDATED: 'task:updated',
  ASSET_INGESTED: 'asset:ingested',
  ASSET_DELETED: 'asset:deleted',
  RECONCILE_DONE: 'sync:reconcile_done'
};

module.exports = {
  eventBus,
  EVENTS
};
