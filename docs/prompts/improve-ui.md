<!-- [skill: go-team-standards · dev-dna] 提供可复制的离线 UI 改进提示词 -->
# 改进界面提示词

复制下面整段给维护本仓库的 AI：

> 你正在改进 Golang Interview 静态刷题界面。先阅读 `AGENTS.md`、`docs/AI-MAINTENANCE.md`、`index.html`、`assets/styles.css`、`assets/app.js` 和相关测试，再说明准备调整的视觉或交互范围。
>
> 必须保留文件分离：`index.html` 只负责语义结构，`assets/styles.css` 负责视觉，`assets/app.js` 负责状态与 DOM 行为，`data/questions.js` 独立加载。禁止把题库或内联事件放进 HTML，禁止 fetch、ES module、CDN、远程字体/图片、框架和任何运行时网络依赖；直接双击 `index.html` 的 `file://` 场景必须继续工作。
>
> 保留全部行为：一轮 Fisher–Yates 随机顺序、切题隐藏答案、前后循环、不会题标记与独立复习模式、重新洗牌、版本化持久化、存储异常警告、补充整理徽标和空不会题状态。
>
> 保留并改进无障碍：语义标题和按钮标签、`aria-expanded`、`aria-pressed`、`aria-live`、进度属性、可见焦点、至少 44px 触控目标、320px 窄屏、长答案自然页面滚动、代码横向滚动和 reduced motion。空格、方向键、`J` 快捷键不得拦截输入控件、可编辑区域或组合键。
>
> 状态或行为变更先在 `tests/test_app.js` 写失败测试并确认 RED，再实现并确认 GREEN。不要为了视觉调整改写题库内容或来源标签。
>
> 完成后运行并原样报告：
>
> ```bash
> python3 -m unittest discover -s tests -v
> node --test tests/test_app.js
> python3 scripts/verify_project.py
> node --check assets/app.js
> ```
>
> 最终列出改动文件、移动端与键盘/读屏检查、RED/GREEN 证据、完整验证结果，以及任何未完成的人工浏览器检查。
