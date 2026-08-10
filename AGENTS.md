<!-- [skill: go-team-standards · dev-dna] 定义每日冲刺 PWA 的仓库级维护与验证契约 -->
# AGENTS.md

本文件是所有后续 AI 或自动化代理进入仓库后的第一阅读入口。修改任何文件前先读本文件；题库任务再读 `docs/prompts/update-questions.md`，界面任务再读 `docs/prompts/improve-ui.md`。

## 项目目标与运行边界

这是一个零依赖的 Go 面试 B1 单卡快刷静态应用：

- 直接双击 `index.html` 时通过普通脚本在 `file://` 完整刷题，此时不注册 Service Worker，也不显示原生 PWA 安装入口。
- GitHub Pages、其他 HTTPS 地址和 `http://localhost` 可注册 Service Worker，并在浏览器支持时安装为 PWA。
- 应用页面、题库和业务脚本保持远程网络零依赖。唯一例外是 `service-worker.js` 可拦截同源 GET 请求，用于应用壳缓存、离线回退和版本更新；不得请求、拦截或缓存第三方地址。

## 文件职责

- `index.html`：语义结构、ARIA 与本地资源引用；不放题库、内联脚本或内联事件。
- `assets/styles.css`：B1 视觉、320px 响应式、焦点、状态和 reduced-motion。
- `assets/app.js`：可测试的 v2 状态引擎、v1 迁移、DOM 行为、键盘、导入导出和 PWA 适配。
- `data/questions.js`：确定性生成的题库，只注册 `window.GO_INTERVIEW_QUESTIONS`。
- `manifest.webmanifest`：相对 `start_url`/`scope`、主题色和本地图标声明。
- `service-worker.js`：同源应用壳预缓存、导航离线回退、旧缓存清理和更新通知。
- `assets/icons/`：可维护 SVG 源与 192、512、maskable PNG 安装图标。
- `scripts/extract_questions.py`、`scripts/build_questions.py`：清理本地存档并生成题库。
- `scripts/verify_project.py`：验证题库、PWA、远程网络边界、页面拆分和维护文件。
- `tests/`：Python 与 Node 内置测试，不引入第三方依赖。
- `docs/CONTENT-SOURCES.md`：内容来源、缺口、补充策略和免责声明。

## 题库数据契约

```javascript
{
  id: 1,
  question: "= 和 := 的区别？",
  promptHtml: "<pre><code>...</code></pre>", // 可选，揭晓前显示
  answerHtml: "<p>...</p>",
  source: "zhihu-archive"
}
```

- 记录必须按 ID `1..100` 排列，ID 唯一，问题和答案均不得为空。
- `promptHtml` 是可选的题目补充内容，用于原文中标题后的代码或示例，必须在答案揭晓前显示。
- `promptHtml` 与 `answerHtml` 只能使用提取器允许的安全标签；禁止脚本、事件属性、远程资源和任意样式。
- 来源只能是 `zhihu-archive` 或 `supplemented`。
- 只有 ID 73、89、90 是 `supplemented`，不得描述成源文章原文。
- 其余 97 条为存档提取内容，未做全面事实校订，不要静默重写。

## 训练与状态契约

- 基础轮次始终是完整唯一题序；每轮完成后自动洗牌进入下一轮，一轮内不重复出题。
- 自评固定为不会 `+2 XP / 加入待复习`、模糊 `+8 XP / 加入待复习`、掌握 `+20 XP / 移出待复习`。
- 不会和模糊都不再按次数自动插回随机题序，只在「待复习」模式和错题本中出现，由用户主动练；`reviewQueue` 是仅为兼容 v3 存档保留的空字段，读取、导入和导出都必须归零。
- 每个浏览器本地自然日完成 20 道不同题目的自评才计入打卡与连续学习；揭晓或跳过不计。事件时间保存为 ISO 8601 UTC，活动日另存 `localDay` 与 `ratedQuestionIds`。
- 打卡从未达成跨到达成的那一次自评弹出恭喜对话框，每天只弹一次；该「已庆祝」状态由跨越事件派生，不写入本地状态，刷新页面不再弹。达成后继续刷题不受限制。
- 主状态键为 `go-interview-progress-v3`。优先读取 v3；仅在 v3 不存在时迁移有效 v2，再否则迁移有效 v1。无效状态安全重置，迁移不得把旧不会题标成掌握，也不得用旧 10 次阈值冒充新打卡。
- 等级、掌握率和成就由源状态派生，不独立持久化。
- 两种模式分别恢复导航位置；实际访问历史最多保留 200 项，活动日最多保留 400 项。

## 安装与进度转移

- 首次安装与应用壳缓存需要 HTTPS 或 localhost 在线访问；`file://` 继续以普通静态应用运行。
- `localStorage` 按浏览器配置和设备隔离，安装 PWA 不会创建云端账号或同步。
- 导出生成不含题目正文和个人信息的 v2 JSON；支持时可交给系统分享，否则下载文件。
- 导入必须完整校验并经用户确认后一次性替换本机进度；不自动合并，不提供云同步。

## 修改与验证流程

1. 先读对应提示词与来源说明，确认本次边界。
2. JavaScript、Service Worker 或验证器行为变更先写测试并观察预期失败，再实现并跑绿。
3. 题库变更修改提取/构建逻辑后重新生成，不手改 `data/questions.js`。
4. UI 变更保留文件拆分、键盘、无障碍、PWA 与 `file://` 双路径。
5. 数据或 UI 改动后运行：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
node --check assets/app.js
node --check service-worker.js
```

## 禁止事项

- 不得把题库移动或复制到 `index.html`。
- 不得在应用运行时代码中增加远程 URL、`fetch`、动态 import、XHR、WebSocket、CDN、远程字体或远程图片。
- Service Worker 的同源 GET 拦截是上述网络禁令的唯一窄例外；不得扩展到第三方资源或遥测。
- 不得改变题目来源归属，不得复制原始下载文章、其 `_files` 目录、密钥、个人数据、终端输出或临时文件进仓库。
- 不得跳过完整验证，也不得在没有证据时宣称测试通过。
