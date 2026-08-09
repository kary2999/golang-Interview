<!-- [skill: go-team-standards · dev-dna] 说明 AI 安全维护题库与静态界面的工作流 -->
# AI 维护指南

## 进入项目

任何 AI 代理都应先阅读根目录 `AGENTS.md`，再按任务选择：

- 题库新增、修订或重新生成：`docs/prompts/update-questions.md`
- 视觉、响应式或交互改进：`docs/prompts/improve-ui.md`

先说明准备修改的文件与不修改的边界，再开始工作。禁止把本地源文章或下载资源目录复制到仓库。

## 题库维护

`data/questions.js` 是确定性生成文件，不直接编辑。内容路径为：

1. `scripts/extract_questions.py` 从本地 HTML 提取正文并清理标签。
2. `scripts/build_questions.py` 检查源文章结构，补齐 ID 73、89、90。
3. 构建脚本验证 100 条记录后写入 `data/questions.js`。
4. `scripts/verify_project.py` 再次检查顺序、来源、HTML 和静态加载边界。

重新生成示例：

```bash
python3 scripts/build_questions.py "/本地路径/2025Go面试八股（含100道答案） - 知乎.html" data/questions.js
```

来源标签不可混用。ID 73、89、90 必须保持 `supplemented` 并在页面显示“补充整理”；其余记录保持 `zhihu-archive`。除非任务明确包含事实校订与来源审查，不要改写 97 条存档答案。

## 交互维护

核心状态逻辑位于 `assets/app.js`，DOM 结构位于 `index.html`，视觉位于 `assets/styles.css`。修改时必须保持：

- Fisher–Yates 洗牌且轮内顺序稳定。
- 初始与切题后答案隐藏。
- 前后题循环、不会题模式、重新洗牌和来源徽标。
- 版本化本地存储及损坏、拒绝访问时的非阻断降级。
- 空格、方向键和 `J` 快捷键；输入控件和组合键不拦截。
- 键盘焦点、ARIA 状态、44px 触控目标、窄屏和 reduced motion。
- `file://` 与 GitHub Pages 均可运行，不增加运行时网络依赖。

改变状态模型时应提升 `STATE_VERSION`，并用测试明确旧状态如何安全重置。不要在没有迁移策略时复用旧版本号。

## 测试优先流程

JavaScript 或验证器行为变更遵循 RED → GREEN：

1. 先在 `tests/test_app.js` 或 `tests/test_verify_project.py` 写预期行为。
2. 运行目标测试并确认因缺少新行为而失败，而不是语法或环境错误。
3. 做最小实现并跑绿。
4. 重构后再次运行完整验证。

完整命令：

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
node --check assets/app.js
```

交付报告必须写明实际执行的命令、输出结果、未执行的人工检查和任何剩余风险。
