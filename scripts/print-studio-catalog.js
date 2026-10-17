const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const lab = require('../src/lab');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const cat = lab.getCapabilityCatalog({ db, config: { dataDir }, logger: console });
const img = cat.studio?.image?.models || [];
console.log('image', img.length);
for (const m of img) console.log(' -', m.name, '|', m.id, '|', m.model_code);
const vid = cat.studio?.video?.models || [];
console.log('video', vid.length);
for (const m of vid) console.log(' -', m.name, '|', m.id, '|', m.model_code);
const chat = cat.studio?.chat?.models || [];
console.log('chat', chat.length);
for (const m of chat) console.log(' -', m.name, '|', m.id);
db.close();
