const { openDb } = require('../src/db');
const db = openDb('/home/lrp/.dsh-material-library');

for (const t of ['chat_messages', 'runs', 'node_runs']) {
  try {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid DESC LIMIT 3`).all();
    console.log(`=== ${t} ===`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.log(`Table ${t} error:`, e.message);
  }
}
