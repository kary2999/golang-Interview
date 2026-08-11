<!-- [skill: go-team-standards · dev-dna] 提供可复制的 B1 每日冲刺 UI 改进提示词 -->
# 改进界面提示词

复制下面整段给维护本仓库的 AI：

> 你正在改进 Golang Interview 的 B1「Sprint Companion」静态应用。先阅读 `AGENTS.md`、`docs/AI-MAINTENANCE.md`、已批准的 Daily Check-in Companion 设计、`index.html`、`assets/styles.css`、`assets/app.js` 和相关测试，再说明准备调整的视觉或交互范围。
>
> 保持文件分离：`index.html` 只负责语义结构与本地资源，`assets/styles.css` 负责视觉，`assets/app.js` 负责状态和 DOM，`data/questions.js` 独立加载。禁止把题库、内联脚本或内联事件放进 HTML；禁止 ES module、CDN、远程字体/图片、框架和运行时远程请求。直接双击 `index.html` 的 `file://` 场景必须继续完整刷题，并跳过 Service Worker。
>
> 保留 v3 训练契约：优先读取 v3；仅在 v3 不存在时迁移有效 v2，再否则迁移有效 v1；完整随机基础轮次无限续轮且一轮内不重复；不会/模糊/掌握固定结算 2/8/20 XP，不会与模糊加入待复习、掌握移出待复习；每 20 XP 升一级并播放非阻断升级特效；不会与模糊都不再按次数插回随机题序，只在待复习模式与错题本中出现，`reviewQueue` 恒为空；每天完成 20 道不同题自评才计入打卡与连续学习，并在跨过第 20 道时弹出每天仅一次的恭喜对话框。应用内吉祥物心情与打卡庆祝均派生不落库；日历与错题本仅作二级对话框；PWA 安装图标固定。两种模式分别保存导航位置，跳过不结算 XP，来源徽标与题库正文不得改写。
>
> 保留 PWA 与转移契约：仅 HTTPS 或 localhost 可安装和注册 Service Worker；manifest、Service Worker 和本地图标保持相对路径。应用运行时仍不访问远程网络，唯一窄例外是 Service Worker 对受控同源 GET 的缓存拦截。进度只保存在每设备/浏览器的 `localStorage`；导出可下载或系统分享 JSON，导入必须完整校验并由用户确认后整体替换，不自动合并、不云同步。
>
> 视觉保持 B1 方向：奶油画布、海军蓝描边、紫色品牌、橙色主要操作、黄色 XP 状态、紧凑冲刺伙伴与明确的不会/模糊/掌握层级。桌面应像专注练习应用，320px 下自评与导航堆叠且页面不横向溢出；长答案自然页面滚动，代码块独立横向滚动。
>
> 保留并改进无障碍：语义标题与标签、原生或等价可访问对话框、`aria-expanded`、`aria-pressed`、`aria-live`、进度属性、可见焦点、至少 44px 触控目标、逻辑 DOM/焦点顺序和 reduced motion。空格揭晓，`1 / 2 / 3` 自评，方向键切题，`J` 切换待复习；不得拦截输入控件、可编辑区域或组合键。评级鼓励文案为主、XP 为次，全局直播区只播报一次。
>
> JavaScript、Service Worker 或验证器行为变更先写失败测试并确认 RED，再实现并确认 GREEN。纯视觉改动也要运行现有静态与交互回归测试。不要为了界面调整改变题目内容或来源归属。
>
> 完成后运行并原样报告：
>
> ```bash
> python3 -m unittest discover -s tests -v
> node --test tests/test_app.js
> python3 scripts/verify_project.py
> node --check assets/app.js
> node --check service-worker.js
> ```
>
> 最终列出改动文件、移动端与键盘/读屏检查、RED/GREEN 证据、PWA 与 `file://` 双路径结果、完整验证输出，以及任何未完成的人工浏览器检查。
