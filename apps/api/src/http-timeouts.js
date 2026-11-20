/**
 * 30001 传输层超时。
 * headersTimeout 必须大于 keepAliveTimeout，否则长连接上的下一个请求会被提前掐掉。
 * requestTimeout 保持 Node 默认的 5 分钟。120 秒会把大文件上传收成 408，
 * 而 req.setTimeout 只改套接字空闲时间，放宽不了收完整请求体的限制。
 */
module.exports = {
  headersTimeout: 70000,
  requestTimeout: 300000,
  keepAliveTimeout: 65000,
};
