# Material Studio Pro (Web 桌面端) Agent 开发规范与架构守则

## 1. 核心定位与职责边界
- **核心定位**：服务于专业设计师与创意运营人员的桌面端生产力工作台。
- **纯容器渲染 (Pure Container Pattern)**：
  - Web 端**绝不硬编码**具体的分类树列表、过滤维度或模型列表；
  - 必须通过消费服务端 `/api/viewer/dict/menu-tree` 与 `/api/viewer/studio/schema` 动态驱动渲染。
- **大屏交互深度优化**：
  - 支持快捷键、双击全屏检查、大画廊瀑布流、右侧 Inspector 检查器；
  - 提供富文本行内图文混排，严禁退化为简陋的纯文本输入体验。

---

## 2. 关键业务规范

### 2.1 素材库 (LibraryView.vue) 三层渲染体系
- **Level 1 (顶栏胶囊)**：渲染 `menuTree` 的一级分类节点；
- **Level 2 (次顶栏)**：根据选中的一级分类，自适应渲染其 `children`（二级子品类）。若 `children.length === 0`，自动收起该栏，不占屏幕空间；
- **Level 3 (联动过滤带)**：
  - 动态遍历渲染 `primary` 维度（主色调色板圆点、画幅单选、品类单选/多选）；
  - `advanced` 维度统一收纳至右侧【高级维度 ▾】抽屉中；
  - 主色圆点 100% 使用服务端下发的 12 色 Hex，杜绝色差。

### 2.2 创作中心 (ChatStudio.vue) 输入交互规范
- **禁止使用纯 `<textarea>` 做带引用的图文混排**；
- **统一采用 `contenteditable="true"` 富文本架构**：
  - 用户键盘敲击 `@` 或点击工具栏按钮触发素材浮层；
  - 选中素材后，光标处原 `@` 字符被替换为行内不可分割的 DOM 卡片：
    ```html
    <span class="mention-chip" contenteditable="false" data-fid="..." data-name="..." data-url="...">
      <img src="..." />
      <span>@名称</span>
      <button class="chip-remove">&times;</button>
    </span>&nbsp;
    ```
  - 彻底杜绝双重 `@@`；
  - 提取指令内容时，纯文本与 `data-fid` 引用资产结构化解耦。
- **固定高优保留插槽：【✨ 优化提示词】**：
  - 无论服务端下发何种参数，**右上角【✨ 优化提示词】按钮位置必须固定醒目**；
  - 带有金色微光与动效，点击时携带 `{ prompt, modelId, mode, imageUrls }` 请求服务端专属 Skill。

### 2.3 客户端缓存策略 (Cache-First + Revalidate)
- 在 `localStorage` 中持久化 `menu_tree_cache` 与 `studio_schema_cache`；
- 页面加载时优先读缓存立即可视化，后台静默请求服务端新 Schema 并热更新，实现 0 闪烁极速直开。

---

## 3. Web Agent 开发红线
1. 严禁在页面代码中 `const categories = [...]` 硬编码业务分类；
2. 严禁破坏已编译产物与 30002 端口的代理通道；
3. 修改代码后必须执行 `npm run build` 确保生产环境 `dist` 同步。
