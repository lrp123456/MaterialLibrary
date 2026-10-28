import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { installFetchGuard, ensureServerBase } from './server-resolve.js';
import StudioIcon from './components/StudioIcon.vue';

// 必须在任何业务请求之前安装：透明接管 fetch，实现
// 同源网关 → 本机 → 局域网 → 公网 的三级自动回退。
installFetchGuard();
// 后台预热探活（不阻塞首屏；候选命中缓存时几乎零成本）
ensureServerBase().catch(() => { /* 全挂时由各视图的错误态承接 */ });

const app = createApp(App);
// 全局注册 Morphicons 统一动效图标组件
app.component('StudioIcon', StudioIcon);
app.mount('#app');
