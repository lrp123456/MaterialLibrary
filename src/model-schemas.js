/**
 * 模型 Schema 兼容代理层 (Single Source of Truth 统一由 src/models-contract.js 动态派生)
 * 采用惰性加载彻底消除与 studio-catalog.js 的循环依赖警告，不保留任何硬编码重复 Schema 定义。
 */
let _mc = null;
function mc() {
  if (!_mc) _mc = require('./models-contract');
  return _mc;
}

const MODEL_SCHEMAS = new Proxy({}, {
  get(_target, prop) {
    const map = mc().getUnifiedSchemasMap(null);
    return map[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(mc().getUnifiedSchemasMap(null));
  },
  getOwnPropertyDescriptor(_target, prop) {
    const map = mc().getUnifiedSchemasMap(null);
    if (prop in map) {
      return { enumerable: true, configurable: true, value: map[prop] };
    }
    return undefined;
  }
});

module.exports = {
  MODEL_SCHEMAS,
  schemaFor: (...args) => mc().schemaFor(...args),
  optionLabel: (...args) => mc().optionLabel(...args),
  slotLimit: (...args) => mc().slotLimit(...args),
  applyConstraints: (...args) => mc().applyConstraints(...args),
  assertFreeTier: (...args) => mc().assertFreeTier(...args),
  uniqueUrls: (...args) => mc().uniqueUrls(...args),
  mapSubmitParams: (...args) => mc().mapSubmitParams(...args),
  enumOptionsOf: (...args) => mc().enumOptionsOf(...args),
  sizeOptionsOf: (...args) => mc().sizeOptionsOf(...args),
  buildSchemaForContract: (...args) => mc().buildSchemaForContract(...args),
  getUnifiedSchemasMap: (...args) => mc().getUnifiedSchemasMap(...args),
};
