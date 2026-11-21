'use strict';
const fs = require('fs');

let c = fs.readFileSync('src/assets-delete.js', 'utf8');
const startMarker = '// 血缘同步清除（软删时即断开孤儿引用）';
const endMarker = "logger?.warn?.('[assets-delete] 软删清理血缘异常:', lineageErr.message);\r\n    }";
const endMarkerLF = "logger?.warn?.('[assets-delete] 软删清理血缘异常:', lineageErr.message);\n    }";

const start = c.indexOf(startMarker);
let end = c.indexOf(endMarker);
let matchedEnd = endMarker;
if (end === -1) {
  end = c.indexOf(endMarkerLF);
  matchedEnd = endMarkerLF;
}

if (start === -1 || end === -1) {
  console.error('Markers not found! start:', start, 'end:', end);
  process.exit(1);
}

const replacement = '// 注意：软删严禁清空其他资产的 parent_fid / source_asset_id 或清洗 lineage_json（保留引用关系，恢复素材时血缘自动复原）。';
c = c.slice(0, start) + replacement + c.slice(end + matchedEnd.length);
fs.writeFileSync('src/assets-delete.js', c, 'utf8');
console.log('Successfully updated assets-delete.js!');
