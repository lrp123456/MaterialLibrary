/**
 * 供应商钥匙只放在项目根目录的 .env。
 * 统一委托给 src/env-secrets.js，保持向后兼容。
 */
module.exports = require('./env-secrets');
