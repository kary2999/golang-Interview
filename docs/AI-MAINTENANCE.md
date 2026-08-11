<!-- [skill: go-team-standards · 技术方案 · dev-dna] 说明 AI 安全维护每日冲刺 PWA 的工作流 -->
# AI 维护指南

## 进入项目

任何 AI 代理都应先阅读根目录 `AGENTS.md`，再按任务选择：

- 题库新增、修订或重新生成：`docs/prompts/update-questions.md`
- 视觉、响应式、训练交互或 PWA 改进：`docs/prompts/improve-ui.md`

先声明准备修改的文件、行为边界和验证方式。禁止把本地源文章、下载资源目录、密钥、个人数据或临时产物复制到仓库。

## 题库维护

`data/questions.js` 是确定性生成文件，不直接编辑：

1. `scripts/extract_questions.py` 从本地 HTML 提取正文并清理标签。
2. 标题后的前置代码若由“答：”或“答案，”与答案明确分隔，则写入可选的 `promptHtml`，保证题目上下文在揭晓前可见。
3. `scripts/build_questions.py` 检查源文章结构，补齐 ID 73、89、90。
4. 构建脚本验证 100 条记录后写入 `data/questions.js`。
5. `scripts/verify_project.py` 再次检查顺序、来源、安全 HTML 和加载边界。

重新生成示例：

```bash
python3 scripts/build_questions.py "/本地路径/2025Go面试八股（含100道答案） - 知乎.html" data/questions.js
```

来源标签不可混用。ID 73、89、90 必须保持 `supplemented` 并显示“补充整理”；其余记录保持 `zhihu-archive`。除非任务明确包含事实校订与来源审查，不要改写 97 条存档答案。

## B1 训练状态维护

核心状态和浏览器适配位于 `assets/app.js`，DOM 位于 `index.html`，视觉位于 `assets/styles.css`。当前状态键为 `go-interview-progress-v3`：

- 加载时优先完整校验 v3；仅当 v3 不存在时迁移有效的 `go-interview-progress-v2`，再否则迁移有效 `go-interview-progress-v1`。
- v2 迁移保留训练、XP、题目统计与复习调度，但每日 `ratedQuestionIds` 为空、连续打卡清零；旧 10 次阈值不得冒充新打卡。
- v1 的模式、完整题序、当前位置和不会题保留；XP、活动日、题目统计与复习调度从零初始化，旧不会题不得静默标为掌握。
- 等级、掌握率、成就、吉祥物心情、打卡进度、打卡庆祝与错题本是派生数据，不写入本地状态。
- 等级门槛由 `XP_PER_LEVEL = 100` 单点决定，`deriveLevel` 不得再出现字面量；改门槛时同步 `index.html` 的静态 XP 文案与 `aria-valuemax`。
- 基础题序每轮包含全部唯一题，完成后自动洗牌继续；一轮内不重复出题，也不再向题序注入复习题。
- 不会、模糊、掌握固定获得 2、8、20 XP；不会与模糊加入待复习，掌握移出待复习。待复习只在「待复习」模式和错题本里出现，不按次数插回随机题序。
- `reviewQueue` 只为兼容 v3 存档保留，恒为空数组：读取、导入与导出都必须清空历史条目，不得新增调度。
- 打卡跨过 20 道的那一次自评弹出恭喜对话框，每天只弹一次；是否已庆祝由跨越事件派生，不落库，刷新后不再弹。
- 每个浏览器本地自然日完成 20 道不同题目的自评，才把该日计入打卡与连续学习；揭晓或跳过不计。活动桶保存 `localDay`、`ratingCount` 与升序 `ratedQuestionIds`。持久化时间必须使用 ISO 8601 UTC。
- 实际访问历史最多 200 项，活动日桶最多 400 项；两个模式分别恢复导航位置。
- 跳过未自评题目不结算 XP；答案揭晓前不开放三级自评。

修改状态结构时必须提升 `STATE_VERSION`，明确迁移或安全重置策略，并覆盖损坏状态、存储拒绝和时钟回拨等边界。

## PWA 与远程网络边界

- `manifest.webmanifest` 维护相对 `start_url`、`scope`、主题色和本地 192、512、maskable 图标。
- `service-worker.js` 负责预缓存应用壳、同源导航离线回退、静态资源缓存、旧缓存删除和等待更新通知。
- Service Worker 只在 HTTPS、`http://localhost` 或 `http://127.0.0.1` 注册；`file://` 必须跳过注册，继续通过普通脚本完整刷题。
- 应用运行时代码保持远程网络零依赖。允许的唯一窄例外是 Service Worker 拦截受控同源 GET 请求；不得请求、缓存或透传第三方资源。
- 应用壳文件变化时同步提升缓存版本，避免安装用户长期停留在旧资源。
- 更新不得强制打断当前答题：不自动重载，等待中的版本只显示非阻断提示。
- 用户点击更新即视为明确意图，不得因为答案已揭晓而拒绝；仅在自评正在写入的瞬间短暂拒绝，且更新前必须先落盘进度。
- 任何拒绝更新的理由必须写进可见的更新横幅文案，不能只发给屏幕阅读器直播区，否则用户点了按钮却看不到任何反馈。

## 本地进度转移

进度属于当前设备和浏览器配置中的 `localStorage`，PWA 安装不会创建账号或云端副本：

1. 导出完整 v3 源状态，并附 `schemaVersion` 与 ISO 8601 UTC `exportedAt`。
2. 支持 Web Share 文件分享时交给系统分享；否则下载 JSON。
3. 导入只接受不超过 1MB 的 JSON，并完整校验版本、枚举、题号、完整题序、`localDay` 与每日题目 ID。
4. 合法 v2 导出可在兼容周期内迁移导入，但须提示连续打卡按新规则清零；校验成功后明确提示会覆盖本机进度，仅在用户确认后一次性替换并保存。
5. 首版不自动合并、不云同步；取消或校验失败时不得修改内存与本地存储。

## 无障碍与响应式

- 保持语义标题、逻辑 DOM/焦点顺序、可访问对话框、可见焦点、ARIA 展开/按下/直播/进度状态。
- 所有操作目标至少 44px；320px 下不得横向溢出，三级自评与主导航应堆叠。
- 长答案使用页面自然滚动，不设置固定高度；代码块独立横向滚动。
- 空格揭晓，`1 / 2 / 3` 自评，方向键切题，`J` 切换待复习；不得拦截输入控件、可编辑区域或组合键。
- 动画必须遵守 `prefers-reduced-motion`，不能依赖动画才能完成操作。

## 测试优先流程

JavaScript、Service Worker 或验证器行为变更遵循 RED → GREEN：

1. 先在 `tests/test_app.js` 或 `tests/test_verify_project.py` 写预期行为。
2. 运行目标测试并确认因缺少新行为而失败，而不是语法或环境错误。
3. 做最小实现并跑绿，重构后再运行完整验证。

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
node --check assets/app.js
node --check service-worker.js
```

交付报告必须写明实际命令与输出、`file://` 和 PWA 双路径、未执行的人工检查及剩余风险。
