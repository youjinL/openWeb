# OpenWeb - SDC/CDC Report Checker

对 IC 验证（SDC/CDC）报告的三模式（**ac / dc / func**）验证结果进行 **解析 → 逐行检查 → AI 辅助分析 → waive 输出** 的全链路 Web 工具。

详细需求见 [`development.md`](./development.md)。

## 环境要求

- WSL Ubuntu（项目运行于 WSL 内）
- Node.js 22+（建议通过 nvm 安装）
- opencode CLI（用于 Agent Copilot；通过 `npm install -g opencode-ai` 在 WSL 内安装）

## 安装

```bash
npm install
```

若 WSL 内没有 opencode，安装：

```bash
npm install -g opencode-ai
opencode auth login   # 配置 LLM 提供商，否则 copilot 无法对话
```

## 启动

开发模式（前后端热更新）：

```bash
npm run dev
```

- Web 后端 API + 静态文件：`http://localhost:5173`
- Vite 前端 dev server（代理 `/api` 到 5173）：`http://localhost:5174`

生产模式（构建前端并由后端一体提供）：

```bash
npm start
```

- 访问 `http://localhost:5173`

### 后台运行 / 停止（WSL）

```bash
bash scripts/start.sh   # 后台启动 Web 后端（自动拉起 opencode serve）
bash scripts/stop.sh    # 停止 Web 后端
```

## 功能

- **首页**：选择/新增根目录 → 自动扫描 `{mode}_sdcV_summary/rpt/{mode}_summary.json`，按 mode（ac/dc/func）展示各 check item 及状态
- **详情页**：report 内容逐行展示（text/csv/xlsx），支持：
  - 正则过滤（区分大小写、`&&` 多条件 AND、匹配/反匹配）
  - 逐行勾选 waive；注释行/空行不参与
  - Export Waiver：填写 reason → 输出到 `{mode}.waive_val.list`（已存在则追加并提示）
  - 已导出行永久灰色（持久化），刷新保留；未导出勾选刷新即还原
  - 详情中 `/xxx/xxx` 路径可点击，新页面加载内容
- **Agent Copilot**：可拖拽悬浮窗，复用 opencode session（按 item 固定，可继续对话），首条预制 prompt + report 内容自动填入，SSE 流式显示回复

## 端口

| 服务 | 端口 |
|---|---|
| Web 后端（API + 静态） | 5173 |
| Vite dev server | 5174 |
| opencode serve | 4096（被占用则自动 +1） |

## 数据存储

- SQLite：`server/data/openweb.db`（根目录配置、waive 状态、item↔session 映射）
- opencode session：由 opencode 自身管理