---
title: Golang Interview 独立仓库设计
date: 2026-08-09
status: approved
---
<!-- [skill: go-team-standards · 技术方案 · dev-dna] 可维护的 Go 面试随机刷题项目 -->

# Golang Interview 独立仓库设计

## 1. 变更背景

项目从“单个内嵌 HTML”调整为独立 GitHub 仓库。题库、页面结构、样式和交互脚本分开维护，并增加面向后续 AI 的长期维护规则与提示词。

目标仓库：`https://github.com/kary2999/golang-Interview`

本地目录：`/Users/karp/Documents/golang-Interview`

## 2. 项目结构

```text
golang-Interview/
├── index.html
├── assets/
│   ├── app.js
│   └── styles.css
├── data/
│   └── questions.js
├── scripts/
│   ├── extract_questions.py
│   └── verify_project.py
├── tests/
│   ├── fixtures/article_sample.html
│   ├── test_extract_questions.py
│   └── test_app.js
├── docs/
│   ├── AI-MAINTENANCE.md
│   ├── CONTENT-SOURCES.md
│   ├── prompts/
│   │   ├── update-questions.md
│   │   └── improve-ui.md
│   └── superpowers/
├── .cursor/rules/
│   └── project-maintenance.mdc
├── AGENTS.md
└── README.md
```

## 3. 运行架构

`index.html` 只保留语义页面结构，依次通过普通 `script` 标签加载 `data/questions.js` 和 `assets/app.js`。题库文件向全局注册只读数组 `window.GO_INTERVIEW_QUESTIONS`。

选择 JavaScript 数据文件而非运行时 `fetch("questions.json")`，是为了同时满足：

- 双击 `index.html` 时在 `file://` 环境直接运行。
- GitHub Pages 静态部署。
- 题目与主页面分离，便于人工或 AI 独立更新。
- 不依赖构建工具、CDN或网络接口。

## 4. 题库契约

每道题包含：

```javascript
{
  id: 1,
  question: "= 和 := 的区别？",
  answerHtml: "<p>...</p>",
  source: "zhihu-archive"
}
```

题号必须为 1–100 且唯一，问题和答案不得为空。`answerHtml` 仅允许经过提取器验证的安全标签。

原始知乎存档存在三处缺失：

- 第 73 题在原文中不存在。
- 第 89、90 题只有题目，没有答案。

为满足“100 道附答案”的既定目标，项目将补充一道人为整理的高频题，并为第 89、90 题补充答案。三条记录统一使用 `source: "supplemented"`，页面显示“补充整理”标识，禁止冒充原文内容。

## 5. 学习功能

- 每轮使用 Fisher–Yates 随机打乱，轮内顺序稳定。
- 每次切题默认隐藏参考答案。
- 支持标记不会、仅复习不会题和重新洗牌。
- 使用带版本号的 `localStorage` 保存题序、位置和不会题。
- 本地存储不可用时降级为内存状态，并显示提示。
- 支持按钮操作以及空格、方向键、`J` 快捷键。
- 桌面和移动端使用已确认的专注卡片界面。

## 6. AI 维护资料

`AGENTS.md` 作为仓库级入口，明确文件职责、数据契约、验证命令和禁止事项。

`.cursor/rules/project-maintenance.mdc` 始终生效，要求 AI：

- 修改前先读 `AGENTS.md` 和对应提示词。
- 不把题库重新塞回 `index.html`。
- 不引入远程依赖或破坏 `file://` 可用性。
- 更新题库后运行完整验证。
- 不把补充内容标记为知乎原文。

`docs/prompts/` 保存可直接复制给其他 AI 的两类提示词：更新题库、优化界面。提示词必须要求先审查、后修改、再验证，并报告事实来源与测试结果。

## 7. 验证与发布

提交前必须运行：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
```

验证内容：

- 题号完整、唯一且答案非空。
- 题库不包含危险标签、事件属性或远程资源。
- 页面引用的是独立题库和脚本文件。
- 页面、样式和脚本不依赖远程网络。
- 随机、状态恢复和不会题逻辑测试通过。

提交信息使用 Conventional Commits，英文小写祈使语气。推送到目标仓库默认分支，不创建未经用户要求的额外远程分支。
