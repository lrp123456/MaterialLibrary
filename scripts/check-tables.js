const { openDb } = require('../src/db');
const db = openDb('./data');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('tables:', tables);
