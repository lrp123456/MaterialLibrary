process.on('exit', (code) => console.log('>>> PROCESS EXIT EVENT with code:', code));
process.on('beforeExit', (code) => console.log('>>> PROCESS BEFORE_EXIT EVENT with code:', code));
process.on('uncaughtException', (err) => console.error('>>> UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('>>> UNHANDLED REJECTION:', reason));

process.env.ML_PORT = '30000';
process.env.ML_DATA_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test';
process.env.ML_TEST_DATA_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test';
process.env.APP_CHANNEL = 'gray';
process.env.ML_WATCH_RESTART = '0';

console.log('Loading server.js...');
require('../server.js');
