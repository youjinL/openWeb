# OpenWeb — SDCV Dashboard

面向 IC 验证（SDC/CDC）报告审查的端到端 Web 工具，覆盖三种模式（**ac / dc / func**）的完整流程：**解析 → 逐行检查 → AI 辅助分析 → waive 导出**。

- 需求规格：[`development.md`](./development.md)
- 交付 / 实现细节：[`details.md`](./details.md)

## 环境要求

- WSL Ubuntu（项目设计为在 WSL 内运行）
- Node.js 22+（建议通过 nvm 安装）
- opencode CLI —— Agent Copilot 功能必需（`npm install -g opencode-ai`，在 WSL 内安装）

## 安装

```bash
npm install
```

若 WSL 内没有 opencode：

```bash
npm install -g opencode-ai
opencode auth login   # 配置 LLM 提供商，否则 copilot 无法对话
```

## 运行

### 开发模式（前端 + 后端热更新）

```bash
npm run dev
```

- Web 后端（API + 静态文件）：`http://localhost:5173`
- Vite 前端 dev server（代理 `/api` 到 5173）：`http://localhost:5174`

> 注意：修改前端源码后需运行 `npm run build`，`:5173` 提供的静态 bundle 才会更新（`:5174` 直接服务源码）。后端改动需重启 dev server。

### 生产模式（构建前端，单端口提供全部）

```bash
npm start
```

- 打开 `http://localhost:5173`

### 后台运行 / 停止（WSL）

```bash
bash scripts/start.sh   # 后台启动 Web 后端（opencode serve 会自动拉起）
bash scripts/stop.sh    # 停止 Web 后端
```

## 功能概述

- **首页仪表盘**：选择 / 新增 / 删除根目录；自动扫描 `{mode}_sdcV_summary/rpt/{mode}_summary.json`，按 mode（ac/dc/func）列出所有 check item，带状态 LED 与状态徽标。
- **详情页**：report 内容逐行检查（text / csv / xlsx），支持：
  - 正则过滤：`&&` 多条件 AND、区分大小写、排除匹配、隐藏已 waive 行
  - 逐行勾选 waive；注释（`#`）与空行不可勾选
  - **Export Waiver**：填写 reason → 追加到 `{mode}.waive_val.list`（已存在则追加）
  - 已导出行变为灰色 + 删除线 + `waived` 标签，持久化到 SQLite，刷新保留
  - 当某一 item 的所有可检行均被 waive 后，其状态变为 **"pass by waive"**（绿色）而非 fail
- **Agent Copilot**：可停靠 / 缩放的悬浮窗，按 check item 复用固定的 opencode session；首条预制 prompt + report 内容自动填入（不自动发送）；回复通过 SSE 流式展示并渲染 markdown。

## Agent（Copilot）配置

OpenWeb 后端通过 HTTP（REST + SSE）与 **`opencode serve`** 服务器通信，支持**两种连接模式**，用环境变量切换，无需改前端或代码。

### 连接模式

| 模式 | 条件 | 行为 |
|---|---|---|
| **本地（默认）** | 未设置 `OPENCODE_BASE_URL` | 后端探测 `127.0.0.1:{OPENCODE_PORT}`（默认 4096），若已有 `opencode serve` 则直接连接，否则**自动拉起**（`opencode serve --hostname 127.0.0.1 --port <p>`）。 |
| **远程（公司内网）** | 设置了 `OPENCODE_BASE_URL` | 后端**直连**该服务器，**跳过**本地探测/拉起。启动时对 `/global/health` 做健康检查（仅告警、不阻塞启动）。REST 与 SSE 事件流都转发到该远程地址。 |

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_BASE_URL` | 未设置 | 远程 opencode 服务器地址，如 `http://opencode.corp.internal:4096`；设置即切换到远程模式 |
| `OPENCODE_TOKEN` | 空 | Bearer token；对所有 opencode REST + SSE 请求以 `Authorization: Bearer <token>` 发送（用于公司服务器鉴权） |
| `OPENCODE_PORT` | `4096` | 本地 opencode 端口 —— 仅在未设置 `OPENCODE_BASE_URL` 时使用 |
| `OPENWEB_PORT` | `5173` | Web 端口 |
| `OPENWEB_HOST` | `0.0.0.0` | Web 监听地址；`0.0.0.0` 表示内网可访问 |
| `OPENWEB_DATA_DIR` | `server/data` | SQLite 数据库所在目录 |

### 连接公司内网 opencode server

1. 向 opencode 运维方获取：基础地址、端口、（若启用鉴权）token。
2. 带上变量启动后端：
   ```bash
   OPENCODE_BASE_URL=http://opencode.corp.internal:4096 \
   OPENCODE_TOKEN=<token-if-any> \
   OPENWEB_HOST=0.0.0.0 \
   npm start
   ```
3. 确认启动日志出现 `[opencode] connected to remote server at ...`。
4. 冒烟测试：打开某个 check item 详情页启动 **Agent Copilot**，回复由远程服务器经 SSE 流式返回。

> 若公司服务器使用不同于 `Authorization: Bearer <token>` 的鉴权头/方案，修改 `server/src/services/opencode.js` 中的 `authHeaders()`（单函数）。

### 更换模型 / 提供商（真正的 AI）

模型与提供商在 **opencode 自身**中配置，而非 OpenWeb：

- **本地模式**：用 `opencode` CLI 选择模型，或编辑 `~/.config/opencode/opencode.json`（provider、model、API key）。无需改 OpenWeb 代码。
- **远程模式**：请公司服务器运维方在那边设置模型；OpenWeb 只负责对接他们的服务器。

### 自定义 copilot 预制 prompt

首条消息模板在 `server/src/config.js` → `defaultPrompts[0].template`（占位符 `{mode}`、`{item}`、`{status}`、`{reportPath}`、`{log}`）。编辑后重启后端即可改变首次打开时要求 agent 做的事。

## 部署到公司 Linux 服务器

项目可运行在任何 Linux 主机（无需 WSL）。要让内网访问：

1. **安装 Node.js 22+**（系统包或 nvm）。
2. **安装并构建**：
   ```bash
   npm install
   npm run build        # 构建 web/dist（生产 bundle）
   ```
3. **带环境变量运行**（远程 agent / 内网访问）：
   ```bash
   OPENCODE_BASE_URL=http://opencode.corp.internal:4096 \
   OPENCODE_TOKEN=<token-if-any> \
   OPENWEB_HOST=0.0.0.0 \
   OPENWEB_PORT=5173 \
   node server/src/index.js
   ```
   同事访问 `http://<主机IP>:5173`。设置 `OPENCODE_BASE_URL` 后本机无需安装 opencode CLI。
4. **systemd 开机自启**（共享服务器推荐）：创建 `/etc/systemd/system/openweb.service`：
   ```ini
   [Unit]
   Description=OpenWeb SDCV Dashboard
   After=network.target

   [Service]
   WorkingDirectory=/path/to/openWeb
   Environment=OPENCODE_BASE_URL=http://opencode.corp.internal:4096
   Environment=OPENCODE_TOKEN=<token-if-any>
   Environment=OPENWEB_HOST=0.0.0.0
   Environment=OPENWEB_PORT=5173
   ExecStart=/usr/bin/node server/src/index.js
   Restart=on-failure
   User=<run-as-user>

   [Install]
   WantedBy=multi-user.target
   ```
   然后 `sudo systemctl enable --now openweb`。

> **安全提示**：应用没有内置鉴权。可信内网可直接 LAN 访问；若需更大范围暴露，建议在前方加 nginx 反向代理 + 基础鉴权 / 企业 SSO + HTTPS。

## 端口

| 服务 | 端口 |
|---|---|
| Web 后端（API + 静态） | 5173 |
| Vite dev server | 5174 |
| opencode serve | 4096（被占用则自动 +1） |

## 数据存储

- SQLite：`server/data/openweb.db` —— 根目录、持久化 waive 状态、item↔opencode session 映射
- Waive 列表文件：`{waive_dir}/{mode}.waive_val.list`（追加式，每个 mode 一个文件）
- opencode session：由 opencode 自身管理
