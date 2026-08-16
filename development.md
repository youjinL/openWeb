# 开发需求文档

> 本文档是后续开发的**唯一依据**。所有实现细节以此为准。

## 1. 项目概述

一个交互式 Web 应用，实现对 IC 验证（SDC/CDC）报告的三模式（**ac / dc / func**）验证结果进行**统一解析 → 逐行检查 → AI 辅助分析 → waive 输出**的全链路工具。

- 解析 `{mode}_sdcV_summary/rpt/{mode}_summary.json` 报告，按 mode 展示各 check item 及其状态
- 每个 item 进入详情页，逐行展示 report 内容，支持正则匹配/反匹配过滤、逐行勾选 waive、生成 waive list
- 内嵌 **Agent Copilot** 悬浮窗，通过 `opencode serve` 的 HTTP API 实现按 item 的对话 session，实现 AI 协助分析
- 目标场景为本地/单机使用，运行于 WSL Ubuntu 环境，浏览器通过 `localhost` 访问

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | React 18 + Vite + TypeScript | 单页应用 |
| UI | Ant Design + 自定义样式 | 表格、对话框、树形目录浏览 |
| 后端 | Node.js + Express | 报告解析、waive 读写、session 代理 |
| 数据库 | SQLite（better-sqlite3） | waive 状态、根目录配置、item↔session 映射 |
| 文件解析 | 内置 fs 读文本；`csv-parse` 解析 CSV；`exceljs` 解析 xlsx | |
| AI 集成 | opencode HTTP Server API（`opencode serve`） | session 管理复用 opencode 原生能力 |
| 流式输出 | SSE（后端代理 opencode 事件流 → 前端 EventSource） | |

## 3. 架构

```
浏览器 (React SPA)
   │  REST + SSE
   ▼
Web 后端 (Express, :5173)  ── SQLite
   │  HTTP Server API
   ▼
opencode serve (:4096)  ← 后端启动时自动拉起
```

- 后端负责：目录/报告扫描、report 文件读取与格式转换、waive 文件读写、item↔session 映射持久化、opencode 代理
- opencode 负责：对话 session 的生命周期与消息存储（复用其原生 session 能力）
- Web 仅作为信息传输与显示窗口

## 4. 目录结构

```
openWeb/
├── 开发需求文档.md
├── package.json          # root scripts（dev / start）
├── server/               # Express 后端
│   ├── index.js          # 入口：启动服务 + 拉起 opencode serve
│   ├── config/           # 配置（端口、预制 prompt 模板）
│   ├── routes/           # roots / modes / waive / copilot / browse
│   ├── services/
│   │   ├── report.js     # 扫描 & 解析 summary.json
│   │   ├── loader.js     # 读取 text/csv/xlsx → 文本行
│   │   ├── waive.js      # waive 文件读写
│   │   └── opencode.js   # opencode API 客户端 + SSE 代理
│   └── db.js             # better-sqlite3
└── web/                  # React 前端 (Vite)
```

## 5. 数据模型

### 5.1 报告扫描
- 根目录 `R` 下按固定规则查找：`{R}/{mode}_sdcV_summary/rpt/{mode}_summary.json`，`mode ∈ {ac, dc, func}`
- 存在的 mode 即展示（支持只有 1~2 个 mode）；找不到视为该 mode 不存在
- summary.json 结构（实测）：
```json
{ "检查项名": { "Status": "Pass/Fail/To be review/...", "Report": "/abs/path/to/report" } }
```
- Status 值不做硬编码约束，原样展示；首页按状态着色（Pass=绿、Fail=红、To be review=橙、其他=蓝）

### 5.2 report 内容加载（详情页）
- Report 字段指向本地文件；按扩展名处理：
  - `.log/.txt/.rpt/无扩展名` → 按行读取文本
  - `.csv` → csv-parse 解析，每行单元格以 **TAB** 拼接为一行文本
  - `.xlsx` → exceljs 解析首个 sheet，每行单元格以 TAB 拼接为一行文本
- 文件不存在时：显示占位提示 + 该行不可勾选
- 行属性：`{ lineNo, text, isComment(以#开头), isEmpty }`

## 6. 核心功能详细设计

### 6.1 首页（Mode 概览）
- 顶部：**根目录选择器**（下拉展示历史根目录，可新增/删除；切换后重新扫描，waive 状态按根目录隔离）
- 主体：三个 mode 区块（ac/dc/func），存在才展示；每区列出全部 check item，显示状态徽标与 report 路径
- 点击 item → 进入详情页

### 6.2 详情页（report 逐行检查）
- 顶部工具栏：
  - **正则过滤框**：输入正则（区分大小写，勾选项），支持 `&&` 连接多个条件（AND，全部满足才命中），"包含即匹配"
  - **匹配 / 反匹配** 开关：匹配=仅显示命中的行；反匹配=排除命中的行
  - **"选中所有显示的行"** 按钮、**"清空选择"** 按钮
  - **Export Waiver** 按钮
- 行展示：
  - 每行前有勾选框；**注释行（`#` 开头）与空行无勾选框**（非 violation 内容）
  - **已 waive（导出成功）的行**：灰色背景 + 勾选框禁用，刷新后仍保持（SQLite 持久化）
  - **勾选中（未导出）的行**：灰色背景，可再点击勾选框取消恢复原色（刷新后还原，不持久化）
- 详情正文中识别出的 `/xxx/xxx` 路径显示为可点击链接，点击→新页面加载该文件内容（同样支持正则过滤与勾选，共享 waive 状态）
- 表格(csv/xlsx)形式 report 亦按文本行展示，勾选/过滤/waive 完全一致

### 6.3 waive 输出流程
1. 用户勾选行（临时变灰）
2. 点击 **Export Waiver** → 弹出对话框输入 **waive reason**（必填）
3. 确认后写入文件，格式：
```
# Waive Item: <item 名>
# Waive Reason: <reason>
<violation 行1>
<violation 行2>
```
4. 写入成功后：本次勾选的行变为**永久灰色**（禁用勾选框，持久化到 SQLite，刷新保留）；弹 toast 提示
5. 保存目录：每个根目录首次导出时弹出**目录树浏览对话框**（后端文件系统树 + 手动输入绝对路径），确定后记住（SQLite），后续不再询问

### 6.4 waive 文件规则
- 文件名：`{waive_dir}/{mode}.waive_val.list`（如 `ac.waive_val.list`），按 mode 分文件
- 文件已存在 → **直接追加**，并提示用户"基于原有文件追加"
- 文件不存在 → 创建新文件写入
- **允许重复**：同一行内容可多次追加，不做去重
- 同 item 多次导出 → 追加新的 `# Waive Item:` 块

### 6.5 Agent Copilot（AI 悬浮窗）
- 详情页提供 **"Agent Copilot"** 按钮 → 打开**可拖拽/缩放悬浮窗**，含：
  - **信息输出区**（agent 回复，SSE 流式滚动显示，markdown 渲染）
  - **聊天输入区** + 发送按钮；可关闭悬浮窗，再次打开同一 item 恢复原 session 与历史
- **session 按 item 固定**：键 = `(rootId, mode, itemName)`，映射存 SQLite
  - 首次打开：`POST /session` 创建 opencode session 并记录映射
  - 再次打开：`GET /session/:id/message` 加载历史消息回显
- 首次打开时，**预制 prompt + 该 item 的 report/log 内容**预置到输入框（可编辑），用户**手动点发送**才提交
- 预制 prompt：内置通用分析模板（含 mode/item/status/log），可通过配置文件 `server/config/copilot-prompts.json` 覆盖
- 发送流程：`POST /session/:id/message`（后端代理），同时订阅 opencode `/event` SSE，将回复 part 实时转发给前端

### 6.6 opencode serve 生命周期
- 后端启动时：检测 `:4096` 是否已运行 opencode；未运行则 `spawn opencode serve --hostname 127.0.0.1 --port 4096`
- 端口被占用且非 opencode → 自动尝试 `4096+n`，并持久化实际端口
- 后端退出时释放子进程（可选设置 `OPENCODE_SERVER_PASSWORD` 启用鉴权）

## 7. API 设计（后端）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/roots` | 根目录列表 |
| POST | `/api/roots` | 新增根目录 |
| DELETE | `/api/roots/:id` | 删除根目录 |
| GET | `/api/roots/:id/modes` | 扫描并返回各 mode 及其 items |
| GET | `/api/roots/:id/modes/:mode/items/:item` | 返回 report 内容（行列表） |
| GET | `/api/roots/:id/modes/:mode/items/:item/waived` | 该 item 已 waive 的行 |
| POST | `/api/roots/:id/modes/:mode/items/:item/waive` | 导出 waive（body: `{ reason, lines[] }`），检测文件存在并追加 |
| GET | `/api/roots/:id/modes/:mode/waive-file` | 读取当前 waive 文件内容 |
| POST | `/api/roots/:id/waive-dir` | 设置 waive 保存目录 |
| GET | `/api/browse?path=` | 目录树浏览 |
| GET | `/api/copilot/:rootId/:mode/:item` | 获取 session 信息与历史 |
| POST | `/api/copilot/:rootId/:mode/:item/message` | 发送消息 |
| GET | `/api/copilot/:rootId/:mode/:item/stream` | SSE 流式转发 |

## 8. 数据库 Schema（SQLite）

```sql
CREATE TABLE roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  waive_dir TEXT,            -- 记住的 waive 保存目录
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE waived_lines (   -- 永久 waive 状态
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  item TEXT NOT NULL,
  line_no INTEGER NOT NULL,   -- 基于行号
  content TEXT NOT NULL,      -- 行内容（用于恢复展示）
  waive_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(root_id, mode, item, line_no)
);
CREATE TABLE copilot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  item TEXT NOT NULL,
  session_id TEXT NOT NULL,   -- opencode session id
  created_at TEXT, updated_at TEXT,
  UNIQUE(root_id, mode, item)
);
```

## 9. 边界情况与注意点

1. report 文件不存在 → 详情页显示提示，不可勾选
2. summary.json 某个 item 的 Report 为空 → 显示占位
3. 大文件性能 → 前端虚拟滚动（仅渲染可视区域），过滤在前端内存完成
4. xlsx 大文件 → 仅读首个 sheet、限制行数上限（可配置，默认 100k 行）
5. waive 目录变更 → 再次导出时若文件已存在，仍追加并提示
6. 根目录被删除 → 其 SQLite 记录（waive 状态、session 映射）一并删除，避免悬挂
7. opencode session 被清理/丢失 → 检测 `GET /session/:id` 失败则重建 session
8. 同一 item 多用户并行编辑不在范围内（单机工具）

## 10. 开发阶段划分

1. **阶段一（基础框架）**：项目脚手架、数据库、根目录管理、报告扫描与 mode 概览页
2. **阶段二（详情页）**：report 加载(text/csv/xlsx)、逐行展示、正则过滤、勾选与 waive 输出、永久灰色持久化、waive 文件追加、目录树选择
3. **阶段三（Agent Copilot）**：opencode serve 拉起、session 映射与恢复、悬浮窗、SSE 流式、预制 prompt
4. **阶段四（完善）**：文件路径点击加载、边界情况、UI 打磨、示例数据验证