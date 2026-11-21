const fs = require('fs');
const path = require('path');
const { emptyReport } = require('./contract');

function safeFid(fid) {
  const text = String(fid || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!text) throw new Error('缺少图片资产编号');
  return text;
}

function reportFile(dir, fid) {
  return path.join(dir, `${safeFid(fid)}.json`);
}

function readReport(dir, fid) {
  const file = reportFile(dir, fid);
  if (!fs.existsSync(file)) return emptyReport(safeFid(fid));
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...emptyReport(safeFid(fid)), ...parsed, fid: safeFid(fid) };
}

function writeReport(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  const file = reportFile(dir, report.fid);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report));
  fs.renameSync(tmp, file);
  return report;
}

module.exports = { readReport, writeReport, reportFile };
