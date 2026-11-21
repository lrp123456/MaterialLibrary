process.env.WEB_PRO_PORT = '30003';
process.env.WEB_PRO_DIST = 'C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer-test\\web-pro\\dist';
process.env.APP_CHANNEL = 'gray';
process.env.API_TARGET = 'http://127.0.0.1:30000';
process.env.EDITOR_TARGET = 'http://127.0.0.1:3010';

console.log('[web-runner] Starting web-pro on port 30003 proxying to 30000...');
require('../web-pro/server.cjs');
