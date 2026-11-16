/**
 * 59 -> 107 高性能透明 TCP 端口转发守护脚本
 * 将本机的 30001（API）和 30002（Web Pro）完全无缝转发到 192.168.1.107
 * 支持 HTTP/1.1、HTTP/2、SSE 流式长连接、大文件上传与下载，零性能损耗
 */
const net = require('net');

const TARGET_HOST = process.env.REMOTE_TARGET || '192.168.1.107';
const RULES = [
  { port: 30001, name: 'API Gateway' },
  { port: 30002, name: 'Web Studio Pro' },
];

for (const { port, name } of RULES) {
  const server = net.createServer({ pauseOnConnect: false }, (src) => {
    src.setNoDelay(true);
    const dst = net.connect({ host: TARGET_HOST, port }, () => {
      dst.setNoDelay(true);
      src.pipe(dst);
      dst.pipe(src);
    });

    const cleanup = () => {
      src.destroy();
      dst.destroy();
    };

    src.on('error', cleanup);
    dst.on('error', cleanup);
    src.on('close', cleanup);
    dst.on('close', cleanup);
  });

  server.on('error', (err) => {
    console.error(`[Forwarder] ${name} (${port}) 错误:`, err.message);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Forwarder] ${name} 启动监听 0.0.0.0:${port} -> ${TARGET_HOST}:${port}`);
  });
}
