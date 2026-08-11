---
title: Golang Interview AI Ask Companion 设计
date: 2026-08-10
status: draft-for-approval
---
<!-- [skill: go-team-standards · 技术方案 · dev-dna] 定义离线刷题卡「复制带过去」AI 伴读交接契约 -->

# Golang Interview AI Ask Companion 设计

## 1. 背景与决策效力

当前应用是零依赖的 Go 面试 B1 单卡快刷静态 PWA：`file://` 可完整刷题；HTTPS / localhost 可注册 Service Worker。`AGENTS.md` 禁止在运行时代码中增加远程 URL、`fetch`、动态 import、XHR、WebSocket、CDN、远程字体或远程图片。唯一网络例外是同源 Service Worker 缓存。

用户已锁定 Mode 1：

- 优先把问题上下文交到手机上已安装的 ChatGPT / Gemini / Claude 或其他 AI App。
- 机制为 **「复制带过去」**：先把题面（及可选参考答案）写入剪贴板，再通过系统分享或用户手动打开 AI App 粘贴。
- 不重写为原生 App。
- 免费云端 LLM API 仅在不违反仓库约束时可作为可选后备；**禁止硬编码 API Key**。本设计结论见 §8：首版不实现云端 API。

本文件定义 AI Ask Companion 的产品与技术契约；不修改 XP、打卡 20 题、待复习、题库正文或导入导出语义。打卡伙伴 UI（`2026-08-10-daily-checkin-companion-design.md`）与 B1 单卡布局继续有效。

## 2. 术语与不变量

- **交接（handoff）**：用户主动把当前题上下文送到外部 AI 客户端；应用本身不代发、不代答、不代登录。
- **载荷（payload）**：写入剪贴板或交给 `navigator.share` 的纯文本。
- **参考答案可见**：当前题 `answerVisible === true`（用户已揭晓）。
- **安全上下文**：HTTPS、localhost，或部分浏览器对 Clipboard API 要求的 secure context。`file://` 通常不是 secure context。

以下规则不可被实现绕过：

1. 任何交接必须由用户显式点击触发；禁止页面加载、切题、揭晓或自评时自动复制 / 自动分享。
2. 应用运行时代码不得 `fetch` / XHR / WebSocket 调用任何 LLM 或遥测端点。
3. 应用运行时代码不得硬编码第三方 HTTPS 远程资源地址用于业务功能（含为了「一键打开 ChatGPT 网页并带 `?q=`」而写死 `https://chatgpt.com/...`）。
4. 不得声称能检测「本机是否安装了 ChatGPT / Gemini / Claude」；浏览器与 PWA 没有可靠、跨平台的 App 安装探测 API。
5. 不得把用户进度、邮箱、导出文件或本地存储密钥拼进 AI 载荷。

## 3. 目标与非目标

### 3.1 目标

- 在不破坏 B1 单卡专注的前提下，为当前题提供「问 AI / 复制带过去」入口。
- 手机上以 **Web Share API**（可用时）作为首选交接路径；桌面与不支持分享的环境以降级为复制 + 粘贴指引。
- 载荷结构化、可粘贴、默认中文说明，便于外部 AI 扮演「面试追问教练」而非替用户背答案。
- 隐私默认本地：不自动上传；用户自己粘贴到第三方 App 后的数据处理归属该 App，本应用在交接前给出明示。
- `file://` 与 HTTPS / PWA 双路径均可用；`file://` 允许剪贴板失败时的可读降级。
- 复用现有 `dialog` / `utility-button` / `live-region` / `openDialog` / `closeDialog` 模式。

### 3.2 非目标（Out of Scope）

- 原生 App、Capacitor / Cordova、应用内嵌 WebView 桥。
- 应用内聊天 UI、流式回答、多轮会话持久化。
- 云端 LLM API（含「用户自填 Key 的免费模型」）——见 §8；需要修改 `AGENTS.md` 网络边界后才能另开规格。
- 依赖未文档化 / 易碎的 URL Scheme 自动预填官方 ChatGPT / Gemini 输入框。
- 自动探测已安装 AI App、强制跳转某一 App、或「打开失败则静默改走网页」。
- 把整本题库、错题本批量、或学习进度 JSON 一键交给 AI。
- 修改题库内容、参考答案措辞、或把 AI 生成内容写回题库。
- 遥测、账号、云同步。

## 4. 方案对比与推荐

### 4.1 方案 A — 剪贴板 + 系统分享（推荐）

**流程**：用户点「问 AI」→ 组装纯文本载荷 →（优先）`navigator.share({ text, title })` → 用户在系统分享面板选择 ChatGPT / Gemini / Claude / 备忘录等；若不可用或取消，则 `clipboard.writeText` 并提示「已复制，请到 AI App 粘贴」。

| 优点 | 缺点 |
|---|---|
| 符合 Mode 1 与离线优先；不引入远程 URL / fetch | 不能保证目标 App 出现在分享面板 |
| 复用已有导出进度的 `navigator.share` 能力探测模式 | `file://` / 部分 WebView 上 Clipboard / Share 可能失败 |
| 用户明确知情：自己选 App、自己粘贴 | 需要手动一步「粘贴」才能开聊 |
| 跨 ChatGPT / Gemini / Claude / 任意接收文本的 App | 不自动预填对方输入框 |

### 4.2 方案 B — 剪贴板 + 硬编码 Deep Link / 网页 `?q=`

**流程**：复制后尝试 `chatgpt://...`、`https://chatgpt.com/?q=`、`claude://...` 等。

| 优点 | 缺点 |
|---|---|
| 看似「一键直达」 | **与 `AGENTS.md` 远程 URL 禁令冲突**（写死第三方 HTTPS） |
| 部分网页端 `?q=` 可预填 | 官方 ChatGPT / Gemini **原生 App 无稳定、公开的「预填并发送」接口**；未文档化 scheme 易碎 |
| | Claude 公开文档的 `claude://code/...` 面向 **Claude Code**，不适合普通面试问答伴读 |
| | 未安装时行为因 OS 而异（错误页、商店、空白），无法优雅探测 |

### 4.3 方案 C — 可选免费云端 LLM（用户自配 Key）

**流程**：设置里填 API Key / Base URL，应用内直接问答。

| 优点 | 缺点 |
|---|---|
| 少一步切 App | **必然 `fetch` 远程**，直接违反当前 `AGENTS.md` |
| | Key 管理、密钥泄露风险、CORS、配额、模型质量 |
| | 偏离「Prefer local AI apps」的 Mode 1 |

### 4.4 推荐结论

**采用方案 A。** 它唯一同时满足：用户锁定的 Mode 1、B1 单卡、离线优先、以及「不硬编码密钥 / 不默认远程依赖」。方案 B/C 仅记录为明确拒绝项，除非未来单独修订 `AGENTS.md` 并新开规格。

## 5. 信息架构与 UI 入口

### 5.1 入口位置（保持单卡焦点）

在 `#review-actions .review-buttons` 中，于「加入待复习」「重新洗牌」旁增加一个次要按钮：

- `id="ask-ai-button"`
- `class="review-button"`（与现有辅助按钮同级，不升级为卡片主 CTA）
- 可见文案：**问 AI**
- `aria-haspopup="dialog"`、`aria-controls="ask-ai-dialog"`、`aria-expanded`
- 无障碍名可补充为「问 AI：复制题目并带到外部应用」
- **不**占用「揭晓参考答案」主按钮位，**不**进入头部 mode-switch，**不**新增常驻侧栏

空题 / 待复习清空态（`#empty-state` 可见、题目卡隐藏）时，按钮禁用或不渲染，避免无题交接。

### 5.2 二级对话框

复用现有 `<dialog class="app-dialog">` + `openDialog` / `closeDialog`：

- `id="ask-ai-dialog"`
- 标题：`问 AI · 复制带过去`
- 简短说明（固定文案）：说明本应用只复制/分享本地文本；打开外部 AI App 并粘贴后，内容由该服务处理；不会自动上传。
- 主体操作（纵向，触控友好）：
  1. **主要**：`分享给 AI App`（`id="ask-ai-share"`）— 仅当 `typeof navigator.share === "function"` 时启用；否则隐藏或 disabled，并显示「当前环境不支持系统分享」。
  2. **次要**：`复制带过去`（`id="ask-ai-copy"`）— 始终提供。
  3. **可选开关**（同一对话框内，非新设置页）：
     - 「包含参考答案」checkbox，默认规则见 §6.2。
     - 「包含题目补充（promptHtml 纯文本）」checkbox，默认开启（若本题无 `promptHtml` 则忽略该项且不展示）。
- 页脚：`关闭`（`method="dialog"` 关闭按钮，与成就/进度对话框一致）。
- `Escape` / 关闭后焦点回到 `#ask-ai-button`。
- 不支持原生 `<dialog>` 时沿用现有受控面板降级。

### 5.3 成功 / 失败反馈

- 成功复制：`live-region` 播报「已复制，可到 ChatGPT、Gemini 或 Claude 粘贴」。
- 成功拉起分享：不强制二次 toast；若分享被用户取消，不报错，可保留对话框打开。
- 复制失败：对话框内 `role="alert"` 短文案 + 展开「手动复制」只读 `<textarea readonly>`（预填同一载荷，用户可长按全选）。不得用 `prompt()`。
- 不得用 `alert()` 打断刷题流。

### 5.4 键盘与快捷键

- 对话框打开后 Tab 环仅在对话框内（沿用现有 dialog 行为即可；若当前实现无 focus trap，本特性不强制新增完整 trap，但关闭后必须还原触发按钮焦点）。
- **不**新增全局单键快捷键（避免与空格揭晓、1/2/3 自评、←/→、J 冲突）。若未来需要，另开变更；首版仅按钮入口。

## 6. 载荷格式

### 6.1 纯文本模板（实现必须稳定，便于测试快照）

载荷为 UTF-8 纯文本，使用换行分隔，**不含 HTML 标签**。从 `promptHtml` / `answerHtml` 提取可见文本时：

- 使用 DOM 或等价安全方式得到 `textContent` 风格纯文本；
- 折叠连续空行为至多一个空行；
- 保留代码块换行；
- 不得把原始 HTML、脚本、或 `localStorage` 键值写入载荷。

固定模板：

```text
【Go 面试伴读 · 请扮演资深面试官】
请基于下面题目帮我：
1) 指出我可能的知识漏洞；
2) 用追问检验理解，不要直接要求我背诵整段标准答案；
3) 若我贴了参考答案，请对照指出遗漏与易错点，并给出更口语的回答结构。

题号：第 {id} 题
题目：{question}

{optional_prompt_block}

{optional_answer_block}

来源标记：{source_label}
（内容来自本地题库伴读；请勿假设我已完全掌握。）
```

- `{source_label}`：`zhihu-archive` → `存档提取`；`supplemented` → `补充整理`。
- `{optional_prompt_block}` 仅当用户勾选且存在纯文本补充时输出：

```text
题目补充：
{prompt_plain}
```

- `{optional_answer_block}` 仅当用户勾选包含参考答案时输出：

```text
参考答案（可能不完整或不严谨，仅供对照）：
{answer_plain}
```

### 6.2 「包含参考答案」默认规则

| 当前状态 | Checkbox 默认 | 说明 |
|---|---|---|
| 答案未揭晓 | **关闭** | 保护先回忆；用户可显式打开以带答案对照 |
| 答案已揭晓 | **打开** | 用户已看过参考答案，默认便于对照追问 |

打开对话框时按当时 `answerVisible` 设置默认；用户手动改动后，**仅本次对话框会话内**记住，切题或关闭后下次按上表重算。不写入 `localStorage`（避免设置膨胀；若日后要持久化另开规格）。

### 6.3 分享字段

调用 Web Share 时：

```javascript
{
  title: "Go 面试 · 第 {id} 题",
  text: "<完整载荷>"
  // 不传 url（避免暗示应用主页或远程题库）
  // 不传 files
}
```

探测方式对齐现有导出逻辑：存在 `navigator.share` 即可尝试分享文本；若实现想更稳，可在支持时调用 `navigator.canShare({ text })`，不支持则只显示复制。

### 6.4 长度

单题答案可能较长。不做硬截断；若某环境对 share/clipboard 有隐式上限导致失败，走 §5.3 手动 textarea 降级。不在首版做「摘要模式」。

## 7. 分享 / 打开目标策略

### 7.1 主路径（手机）

1. 用户确认载荷选项 → 点「分享给 AI App」。
2. 系统分享面板出现后，用户自选 ChatGPT、Gemini、Claude、信息、邮件等。
3. 若目标 App 只接受纯文本分享，载荷即消息正文；若 App 忽略分享正文，用户仍可依赖事先或随后的「复制带过去」在 App 内粘贴。

**推荐 UX 顺序**：点分享前 **先写入剪贴板**（若 Clipboard API 可用），再调用 `share`。这样即使目标 App 只打开不带入文本，用户仍可立即粘贴。若先 share 再 copy 也可，但必须在规格测试中固定一种顺序：**先 copy（最佳努力）再 share**。

### 7.2 次路径（桌面 / 无 Share）

仅「复制带过去」+ 对话框内简短指引：打开已安装的 AI App 或网页 → 新建对话 → 粘贴。

### 7.3 Deep Link 政策（明确不做）

| 目标 | 现状（调研结论） | 本设计 |
|---|---|---|
| ChatGPT 原生 App 预填 | 无稳定公开「预填发送」；网页 `?q=` 有限可用 | **不做**硬编码打开 |
| Gemini 原生 App 预填 | 无可靠公开预填 Intent / scheme | **不做** |
| Claude 聊天预填 | 公开 `claude://code` 面向 Claude Code，不匹配伴读场景 | **不做** |
| 通用 `navigator.share` | 移动端可靠主路径 | **做** |
| `clipboard.writeText` | 广泛可用；`file://` 常失败 | **做** + textarea 降级 |

对话框说明文案可列举「ChatGPT / Gemini / Claude」作为**用户侧建议**，但不生成指向它们的 `<a href="https://...">` 业务链接，也不 `location.assign` 到第三方。

### 7.4 「App 未安装」

无法可靠检测。文案只说：「若分享列表里没有目标 App，请先安装，或使用复制后在浏览器打开该服务并粘贴。」不引导应用商店深链（避免远程 URL 与错误商店页）。

## 8. 免费云端模型后备政策

在 **不修改 `AGENTS.md` 网络禁令** 的前提下：

- **首版不实现**任何云端 LLM 调用、代理、或「粘贴 Key 即问答」。
- 不在 UI 预留灰掉的「在线问」入口，以免暗示即将上线却无法交付。
- 若未来要做：必须先修订 `AGENTS.md`（明确允许用户显式启用的出站请求）、单独规格（Key 仅存内存或用户自管、禁止入库、超时、错误码、CORS、模型列表）、并保持默认关闭。

因此「Free cloud LLM API」对本特性的结论是：**当前约束下无用且违规 → 排除出范围**，而不是做成半成品开关。

## 9. 隐私

- 默认本地：组装载荷只读当前题内存态与题库字段。
- 无自动上传、无后台同步、无匿名遥测。
- 用户主动分享或粘贴到第三方后，数据处理受该第三方条款约束；对话框首段必须用白话说明这一点。
- 载荷不含：进度 JSON、成就、打卡日历、设备信息、`localStorage` 键名、导入文件名。
- 日志：本应用无远程日志；若实现调试 `console`，不得打印完整答案正文（开发期临时调试除外，合并前删除）。符合仓库敏感数据不入日志的精神。

## 10. 无障碍（a11y）

- 触发按钮与对话框控件均可键盘聚焦；可见焦点环沿用全局样式。
- 对话框有 `aria-labelledby`；说明段落可供读屏顺序读到。
- 分享/复制按钮在进行中使用 `aria-busy` 或临时 disabled，防止双击重复拉起多个分享表。
- 成功/失败通过 `aria-live` 区域播报，不单独依赖颜色。
- Checkbox 使用原生 `<input type="checkbox">` + `<label>`，不自造不可聚焦控件。
- 尊重 `prefers-reduced-motion`：本特性不新增装饰动画；若有微反馈，跟随现有 reduced-motion 规则。
- 触控目标不小于现有 `review-button` 规格；320px 宽下按钮可折行，不得水平溢出遮挡主卡片。

## 11. `file://` 与 PWA 行为

| 环境 | Share | Clipboard | 预期 |
|---|---|---|---|
| HTTPS / localhost PWA（移动） | 通常可用 | 通常可用 | 主路径：先 copy 再 share |
| HTTPS 桌面 | 视浏览器 | 通常可用 | 复制为主；有 Share 则可选 |
| `file://` | 通常不可用 | 常失败或不稳定 | 隐藏/禁用分享；复制失败 → textarea 手动全选 |
| 不注册 SW 的 `file://` | 同左 | 同左 | 功能仍可用，不依赖 SW |

本特性 **不**注册新的 Service Worker 路由，**不**缓存第三方源。

## 12. 技术落点（设计约束，非实现任务）

计划改动文件（实现阶段）：

- `index.html`：按钮 + `ask-ai-dialog` 结构。
- `assets/styles.css`：对话框内表单间距；不新增远程字体。
- `assets/app.js`：纯函数 `buildAskAiPayload(question, options)` + DOM 绑定；便于 Node 测试。
- `tests/test_app.js`：载荷快照、默认 checkbox 规则、HTML 剥除。
- `scripts/verify_project.py`：若有远程 URL 扫描，确保本特性不引入第三方 URL 字符串（说明文案中的品牌名是纯文本，不是 URL）。

禁止：

- 在 `app.js` 写入 `https://chatgpt.com`、`https://gemini.google.com`、`https://claude.ai` 等业务跳转常量。
- 新增 `fetch`。

## 13. 错误与边界

1. 题库未加载 / 无当前题：入口禁用。
2. `share` 抛出 `AbortError`（用户取消）：静默，不算失败。
3. `share` 其他错误：提示「无法打开系统分享，请改用复制」。
4. Clipboard 拒绝权限：进入 textarea 降级。
5. 超长文本失败：同一降级。
6. 切题时若对话框仍打开：关闭对话框或立即按新题重绘载荷；**选定：切题时关闭对话框**，避免载荷与屏幕题目不一致。

## 14. 验收标准（Acceptance Criteria）

1. 随机刷题与待复习模式下，当前有题时可见「问 AI」；空态不可发起交接。
2. 打开对话框不自动复制、不自动 share。
3. 未揭晓时默认不包含参考答案；揭晓后默认包含；用户可改。
4. 「复制带过去」成功后 live-region 有明确中文反馈；失败时出现可手动全选的 textarea，内容与目标载荷一致。
5. 在支持 `navigator.share` 的移动浏览器（或模拟）中，「分享给 AI App」会调用 share，且 `text` 为完整载荷；`title` 含题号。
6. 载荷为纯文本，不含 HTML 标签；含题号、题目、角色说明；来源标记正确区分存档/补充。
7. `file://` 打开时功能可完成「手动复制」路径，不抛未捕获异常，不尝试注册与本特性相关的网络请求。
8. `python3 scripts/verify_project.py` 与现有 JS/Python 测试在实现后仍通过；验证器不因本特性放宽「运行时零远程依赖」。
9. 无硬编码 API Key；无 LLM `fetch`；无第三方业务 URL 常量。
10. 不增加头部导航项，不把题目卡挤出首屏主要工作区（辅助行可折行）。

## 15. 残留风险

- 系统分享面板是否列出 ChatGPT 等，取决于 OS / App 是否注册文本分享意图，应用无法保证。
- 部分 AI App 接收分享后只打开 App 而不填入输入框 → 依赖「先 copy」策略缓解，但不能 100% 消除。
- iOS / Android WebView 内嵌（如从笔记 App 打开页面）可能同时禁用 share 与 clipboard。
- 参考答案可能过时；载荷已要求 AI「对照而非盲信」，但无法阻止模型一本正经地讲错。
- 用户可能在未揭晓时手动勾选带上答案，削弱回忆练习——这是显式选择，可接受。

## 16. 实现前唯一待决问题

见交付回传；规格正文默认采用 §6.2 规则。若产品否决该默认，仅改 §6.2 与验收第 3 条，不改方案 A。

## 17. 自审记录（Spec Self-Review）

| 检查项 | 结果 |
|---|---|
| TBD / TODO / 模糊措辞 | 已消除实现级 TBD；§16 仅保留一项产品确认门闩 |
| 内部一致性 | 推荐方案 A；§7.3 / §8 / §3.2 一致排除 deep link 与云端 API |
| 与 AGENTS.md | 无运行时远程 URL / fetch；符合 offline-first |
| 与 B1 / 打卡伙伴 | 入口在 review-actions，二级 dialog，不抢主 CTA |
| 范围 | 单特性可单次实现计划；未混入聊天 UI 或 API |
| 歧义 | 「先 copy 再 share」已选定；切题关对话框已选定 |

---

**状态**：`draft-for-approval` — 待人工确认后改为 `approved` 再进入 implementation plan。本文件按用户要求 **不提交 git、不 push**。
