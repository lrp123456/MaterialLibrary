const { openDb } = require('../src/db');
const os = require('os');
const path = require('path');
const db = openDb(path.join(os.homedir(), '.dsh-material-library'));
console.log('colors_with_basic', db.prepare("SELECT COUNT(*) c FROM asset_colors WHERE basic_color IS NOT NULL AND basic_color!=''").get());
console.log('sample', db.prepare('SELECT hex, role, basic_color FROM asset_colors LIMIT 8').all());
console.log('color_style_tags', db.prepare("SELECT COUNT(*) c FROM asset_tags WHERE source='derived'").get());
console.log('presets', db.prepare('SELECT COUNT(*) c FROM presets').get());
// provider keys still usable
const p = db.prepare("SELECT id, length(api_key) kl FROM llm_providers").all();
console.log('providers_keylen', p);
db.close();
