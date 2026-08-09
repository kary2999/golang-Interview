<!-- [skill: go-team-standards · dev-dna] 定义仓库级 AI 维护入口与验证契约 -->
# AGENTS.md

本文件是所有后续 AI 或自动化代理进入仓库后的第一阅读入口。修改任何文件前，先阅读本文件；题库任务再读 `docs/prompts/update-questions.md`，界面任务再读 `docs/prompts/improve-ui.md`。

## 项目目标

这是一个零依赖的 Go 面试刷题静态站点。它必须同时支持直接双击 `index.html` 的 `file://` 场景和 GitHub Pages，不经过安装、构建或运行时网络请求。

## 文件职责

- `index.html`：只放语义页面结构、无障碍属性和本地资源引用，不放题库或内联行为。
- `assets/styles.css`：专注卡片的视觉、响应式、焦点和 reduced-motion 样式。
- `assets/app.js`：纯状态函数、DOM 行为、键盘操作和版本化本地存储。
- `data/questions.js`：由脚本生成的浏览器题库，只注册 `window.GO_INTERVIEW_QUESTIONS`。
- `scripts/extract_questions.py`：从本地存档提取并清理允许的 HTML。
- `scripts/build_questions.py`：合并补充内容并确定性生成题库文件。
- `scripts/verify_project.py`：验证题库、离线边界、页面拆分和维护文件。
- `tests/`：Python 与 Node 内置测试，不引入第三方依赖。
- `docs/CONTENT-SOURCES.md`：内容来源、缺口、补充策略和免责声明。

## 题库数据契约

```javascript
{
  id: 1,
  question: "= 和 := 的区别？",
  answerHtml: "<p>...</p>",
  source: "zhihu-archive"
}
```

- 记录必须按 ID `1..100` 排列，ID 唯一；问题和答案均不得为空。
- `answerHtml` 只能使用提取器允许的安全标签；禁止脚本、事件属性、远程资源和任意样式。
- 来源只能是 `zhihu-archive` 或 `supplemented`。
- 只有 ID 73、89、90 是 `supplemented`；不得将其描述成源文章原文。
- 其余 97 条为存档提取内容，未做全面事实校订，不要静默重写。

## 修改流程

1. 先读对应提示词与来源说明，确认本次改动边界。
2. 行为变更先写测试并观察预期失败，再实现并跑绿。
3. 题库变更应修改提取/构建逻辑后重新生成，不手改生成文件。
4. UI 变更必须保留文件拆分、现有功能、键盘行为、无障碍和 `file://` 支持。
5. 数据或 UI 改动后总是运行完整验证：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
node --check assets/app.js
```

## 禁止事项

- 永远不要把题库移动或复制到 `index.html`。
- 永远不要增加会破坏 `file://` 的网络依赖、`fetch`、ES module、CDN、远程字体或远程图片。
- 永远不要把补充整理条目标记成源文章内容。
- 不要复制原始下载文章、其 `_files` 目录、密钥、个人数据、终端输出或临时文件进仓库。
- 不要跳过完整验证，也不要在没有证据时宣称测试通过。
