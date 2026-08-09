<!-- [skill: go-team-standards · dev-dna] 提供 Golang Interview 的中文使用与维护说明 -->
# Golang Interview

## 项目简介

Golang Interview 是一个零安装、零运行时网络依赖的 Go 面试随机刷题页面。每次只展示一道题，参考答案默认隐藏，适合在电脑或手机浏览器中进行短时、专注的面试复习。

项目只使用原生 HTML、CSS、JavaScript、Python 标准库和 Node.js 内置测试。页面既可直接双击离线运行，也可部署到 GitHub Pages。

## 在线访问地址

<https://kary2999.github.io/golang-Interview/>

首次发布后需要在仓库设置中启用 GitHub Pages；启用前该地址可能暂时不可访问。

## 本地使用

无需安装依赖，也无需启动本地服务器：

1. 下载或克隆本仓库。
2. 在文件管理器中直接双击根目录的 `index.html`。
3. 页面会通过本地普通脚本加载题库，可在 `file://` 环境离线使用。

## 功能说明

- 每轮使用 Fisher–Yates 随机排列 100 道题，轮内顺序保持稳定。
- 首次打开和每次切题后都隐藏答案，可随时显示或收起。
- 可把题目标记为“不会”，并切换到独立的不会题复习模式。
- 上一题、下一题支持首尾循环；可随时重新洗牌。
- 模式、题序、当前位置和不会题 ID 使用版本化 `localStorage` 保存。
- 本地存储损坏或被浏览器禁用时，页面会安全重置或退化为当前页面内存状态，并显示非阻断提示。
- ID 73、89、90 会显示“补充整理”徽标。

## 键盘快捷键

- `Space`：显示或收起参考答案。
- `←`：上一题。
- `→`：下一题。
- `J`：标记或取消当前不会题。

焦点位于按钮、链接、输入控件或可编辑区域时不会触发快捷键；带修饰键的组合操作也不会被拦截。

## 项目目录结构

```text
golang-Interview/
├── index.html                         # 语义页面，不包含题库
├── assets/
│   ├── styles.css                     # 响应式视觉与无障碍样式
│   └── app.js                         # 状态、持久化和 DOM 行为
├── data/
│   └── questions.js                   # 独立的浏览器题库
├── scripts/
│   ├── extract_questions.py           # 提取并清理本地文章
│   ├── build_questions.py             # 合并补充内容并生成题库
│   └── verify_project.py              # 仓库契约验证
├── tests/                             # Python 与 Node 内置测试
├── docs/                              # 来源和 AI 维护说明
├── .cursor/rules/project-maintenance.mdc
└── AGENTS.md                          # 后续 AI 的第一入口
```

`index.html`、`assets/styles.css`、`assets/app.js` 和 `data/questions.js` 分别负责结构、样式、行为和内容。题库不得重新内嵌到主页面，这一拆分同时保证人工维护清晰和 AI 修改边界明确。

## 题库来源与免责声明

题库主体从本地保存的知乎文章《2025Go面试八股（含100道答案）》提取。原始下载文章和其 `_files` 资源目录仅作为本地输入，不属于本仓库，也不应被提交。

源存档存在三处明确缺口：

- ID 73 在原文中不存在，本项目补充“值接收者和指针接收者”相关题目及答案。
- ID 89 保留原文问题“如何优化内存使用？”，答案由本项目补充。
- ID 90 保留原文问题“如何优化垃圾回收？”，答案由本项目补充。

这三条统一使用 `source: "supplemented"` 并显示“补充整理”；其余 97 条使用 `source: "zhihu-archive"`。除结构提取和安全清理外，97 条导入答案没有完成逐条、全面的事实校订，内容仅供面试复习参考，不应视为 Go 官方或标准答案。完整 provenance 说明见 `docs/CONTENT-SOURCES.md`。

## 更新题库与重新生成

不要直接编辑生成文件 `data/questions.js`。先修改并测试 `scripts/extract_questions.py` 或 `scripts/build_questions.py`，再从仓库外的本地源文章生成：

```bash
python3 scripts/build_questions.py "/本地路径/2025Go面试八股（含100道答案） - 知乎.html" data/questions.js
```

构建脚本会检查源文章结构，补齐 ID 73、89、90，验证 1..100 的顺序、唯一性、非空内容、安全 HTML 和来源标签，并原子写入确定性 JavaScript。更新前请先阅读 `docs/CONTENT-SOURCES.md` 和 `docs/prompts/update-questions.md`。

## 测试和验证

在项目根目录依次运行：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
node --check assets/app.js
```

验证范围包括题库完整性与来源、安全 HTML、确定性数据格式、页面文件拆分、本地资源存在性、无远程依赖、无内联事件，以及 AI 维护文件是否齐全。

## 后续 AI 维护

未来的 AI 代理必须先阅读根目录 `AGENTS.md`，再按任务选择可直接复制的提示词：

- 更新题库：`docs/prompts/update-questions.md`
- 改进界面：`docs/prompts/improve-ui.md`

完整工作流和状态版本注意事项见 `docs/AI-MAINTENANCE.md`。数据或 UI 变化后必须运行全部四条验证命令，并报告真实输出。

## GitHub Pages 部署

仓库内容是纯静态文件，不需要构建步骤：

1. 将审核后的内容提交并推送到 GitHub 默认分支。
2. 打开仓库 `Settings` → `Pages`。
3. 在 `Build and deployment` 中选择 `Deploy from a branch`。
4. 选择默认分支和根目录 `/ (root)`，保存配置。
5. 等待 Pages 发布完成后访问 <https://kary2999.github.io/golang-Interview/>。

页面只引用相对本地文件，因此 GitHub Pages 与直接双击使用同一套代码。
