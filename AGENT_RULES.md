# MaterialLibraryServer Agent 开发规范与职责界定 (Server-Driven Contract)

## 1. 核心定位与职责边界
- **核心定位**：整个系统的数据中心、业务规则中枢与 AI 算力管线网关。
- **唯一真实数据源 (Single Source of Truth)**：任何分类层级、品类选项、打标字典、模型列表、参数控制项（快捷项/高级项），**必须由服务端统一收敛与定义**，严禁在客户端写死！
- **向后兼容与容灾兜底**：元数据契约接口（如 `/dict/menu-tree` 与 `/studio/schema`）必须保持高可用、无死锁，支持公开只读或低鉴权探测，确保客户端在未登录或网络抖动时依然能渲染完整 UI 框架骨架。

---

## 2. 关键核心契约 (Contract API)

### 2.1 统一菜单树契约 (`GET /api/dict/menu-tree`)
- **源码实现**：`src/menu-tree.js` 中的 `getMenuTree(db)`
- **数据结构**：
  ```ts
  interface MenuNode {
    key: string;              // 分类唯一标识 (如 all, interior, furniture...)
    label: string;            // 中文显示标签
    icon: string;             // 图标代号
    children: Array<{         // 二级子品类
      key: string;
      label: string;
    }>;
    facets: Array<{           // 该分类专属与通用的关联过滤维度
      key: string;            // dominant_color, orientation, space_type...
      label: string;
      type: 'color_palette' | 'radio_group' | 'tag_single' | 'tag_multi';
      placement: 'primary' | 'advanced'; // 明确指示快捷展平还是放入折叠抽屉
      options: Array<{ value: string; label: string; hex?: string; isLight?: boolean }>;
    }>;
  }
  ```
- **打标系统 100% 统一**：
  - 主色必须采用 12 色标准板 (`src/tags-seed.js` 与 `src/menu-tree.js`)；
  - 严禁出现客户端自行发明的色彩定义。

### 2.2 工作台 Studio Schema 契约 (`GET /api/studio/schema`)
- **源码实现**：`src/menu-tree.js` 中的 `getStudioSchema()`
- **数据结构**：
  - `models`: 可用生成模型列表（`Seedream 5.0 Flash`、`Seedream 5.0 Pro`、`Seedance 2.0` 等）及推荐位。
  - `inputControls.quick`: 快捷操作栏参数（如画幅比例、画质等级）。
  - `inputControls.advanced`: 高级抽屉参数（负向提示词、Seed、采样步数 Steps、CFG Scale）。
  - `fixedActions`: 客户端固定高优独立保留插槽（如 `✨ 优化提示词`）。

### 2.3 提示词系统专属 Skill 优化器 (`POST /api/chat/optimize-prompt`)
- **参数要求**：必须携带 `{ prompt, modelId, mode, imageUrls }`；
- **业务职责**：调用服务端为该生成模型预设的专属优化 Skill 系统提示词，结合挂载的参考素材图，扩写为空间、材质、光影层次严谨的电影级描述，去除违规参数词。

---

## 3. Server Agent 开发红线
1. **四端口双通道结构（2026-10-23 起，禁止改端口）**：
   - 正式：`30001` 核心 API + `30002` 桌面 Web 端，WSL 内由 `scripts/watchdog.sh` 统一守护；
   - 灰测：`30000` 灰测 API + `30003` 灰测 Web 端，Windows 侧由 `scripts/gray-release.js` 拉起，
     产物目录 `web-pro/dist-gray`、数据目录 `~/.dsh-material-library-gray`；
   - 所有改动必须先发到 30003 验证，再在灰测页面「系统设置 → 双通道灰度发布」点「发布到正式版」；
   - 30002 是给用户看的唯一客户端入口，30003 只用于灰测；临时调试不得占用 30000/30001/30002/30003。
   - 详细流程与故障排查见 `docs/双通道灰度发布与语音输入.md`。
2. **契约变更须升级 Version**：
   - 若增加新的维度或修改模型参数结构，必须更新 `getStudioSchema()` 中的 `version` 字段，方便客户端缓存协商更新。
3. **白名单与权限管理**：
   - 客户端必需的 Schema 与通用元数据必须纳入 `VIEWER_WHITELIST`。
   - 包括媒体流与文件端点：`/assets/:fid/image`、`/assets/:fid/file`、`/assets/:fid/video`、`/assets/:fid/poster` 必须全量支持 Range 206 流式传输与 Token 鉴权。

---

## 4. 全局色彩与 UI 规范唯一真相源 (Theme Single Source of Truth)

### 4.1 三大官方主题模式与定义
1. **专业暗黑尊享 (Obsidian Titanium - `dark`)**：
   - 底色 `#0A0E17` / `#131A29`，主文本 `#F8FAFC`，边框 `#27354D`。
2. **极简白瓷明朗 (Porcelain Studio - `light`)**：
   - 底色 `#F1F5F9` / `#FFFFFF`，主文本 `#0F172A`，边框 `#CBD5E1`。
3. **沉香宣纸·温润茶道护眼 (Warm Parchment - `eye-care`)**：
   - 底色 `#F6F1E5` / `#FAF5EB` / `#FFFDF8`，主文本 `#241E15`，强调色 `#B45309` (焦糖香木)，次级色 `#2D5A43` (沉静松青)。

### 4.2 严禁违规项 (Agent 铁律)
1. **严禁硬编码暗黑专属类**：
   - 禁止在组件中直接书写 `bg-slate-900`、`bg-slate-950`、`bg-black/80`、`bg-rose-950`、`bg-blue-950`、`bg-indigo-950` 等。必须统一使用 `bg-studio-*` 映射类或 CSS Token。
2. **严禁浅底浅字与深底深字 (WCAG AAA/AA 规范)**：
   - 任何状态胶囊（如 `1080×1920` 分辨率徽标）、状态徽章、输入框、按钮，必须确保对比度 >= 4.5:1。
   - 状态为激活态时（如按钮高亮背景），内嵌小字徽标禁止使用透明灰/浅底色造成文字融进背景，必须具备清晰的对比反差。
3. **危险/警告按钮必须语义化自适应**：
   - 「移入回收站」、「彻底清除」等危险操作，暗黑模式下为深红微光，明亮模式下为浅粉底深红字（`bg-rose-50 text-rose-700 border-rose-200`），护眼模式下为温润赭红深酒红字（`bg-amber-950/10 text-rose-900 border-rose-300/40`），绝不允许出现灰泥粉色或不可读低对比。
4. **老年人/视力友好规范**：
   - 全站字号根基保持 15px ~ 15.5px，标题与操作项行高 >= 1.5，交互元素点击区域 >= 32px。

