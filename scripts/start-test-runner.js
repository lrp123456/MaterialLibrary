process.on('exit', code => console.log('[test-runner] process.exit with code:', code));
process.on('uncaughtException', err => console.error('[test-runner] uncaughtException:', err));
process.on('unhandledRejection', reason => console.error('[test-runner] unhandledRejection:', reason));

process.env.ML_PORT = '30000';
process.env.ML_DATA_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test';
process.env.ML_TEST_DATA_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test';
process.env.APP_CHANNEL = 'gray';
process.env.ML_WATCH_RESTART = '0';
process.env.ML_SKIP_CREATION_BACKFILL = '1';

require('./shims/better-sqlite3-win.js');
console.log('[test-runner] Starting test server on port 30000 with dataDir:', process.env.ML_DATA_DIR);
require('../server.js');
