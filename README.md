<!-- [skill: go-team-standards · dev-dna] 提供 Daily Sprint PWA 的使用、安装、转移与维护说明 -->
# Golang Interview

## 项目简介

Golang Interview 是一个零构建、零第三方依赖的 Go 面试 B1 单卡快刷应用。它把“主动回忆 → 揭晓答案 → 三级自评 → 自动下一题”组织成可持续的每日冲刺，并通过 XP、等级、连续学习和待复习调度记录投入。

同一套静态文件支持两条运行路径：

- 直接双击 `index.html`：在 `file://` 中完整刷题，不启动 Service Worker。
- 通过 GitHub Pages、其他 HTTPS 地址或 localhost 访问：浏览器支持时可安装为 PWA，并在首次完整缓存后离线启动。

应用页面、题库与业务脚本没有远程运行时依赖。Service Worker 只拦截受控的同源 GET 请求，用于应用壳缓存和离线回退。

## 在线访问地址

<https://kary2999.github.io/golang-Interview/>

首次发布后需要在仓库设置中启用 GitHub Pages；启用前该地址可能暂时不可访问。

## 直接本地使用

无需安装依赖，也无需启动服务器：

1. 下载或克隆本仓库。
2. 在文件管理器中直接双击根目录的 `index.html`。
3. 页面通过普通本地脚本加载题库，可在 `file://` 离线刷题和保存本机进度。

`file://` 不具备浏览器要求的安全上下文，因此不会注册 Service Worker，也不能触发原生 PWA 安装；这不会影响题库、XP、自评、待复习或 JSON 导入导出。

## 每日冲刺规则

- 每轮使用 Fisher–Yates 生成完整的 100 道唯一题序；完成后自动洗牌开始下一轮。
- 参考答案默认隐藏；揭晓后才出现三级自评。
- **不会**：获得 2 XP，加入待复习。
- **模糊**：获得 8 XP，保留待复习。
- **掌握**：获得 20 XP，并从待复习中移除。
- 跳过当前题不获得 XP，也不修改掌握统计。
- 不会和模糊都不会被强行插回随机题序，同一轮内不重复出题；要复习就主动切到“待复习”或从错题本进入，不会卡在同一道题上。
- 一轮结束会非阻断地结算，并自动进入下一轮；待复习列表继续保留。
- 每累计 100 XP 提升一级，也就是约 5 道“掌握”升一级；XP 表示练习投入，不等同于掌握率。
- 升级时播放一次非阻断的彩带 + 等级徽章特效，约 1.3 秒自动消失，不打断答题；开启“减少动态效果”时只显示静态徽章。
- 同一浏览器本地自然日完成 20 道不同题目的自评，该日才计入打卡与连续学习；揭晓或跳过不计。
- 当天第 20 道达成的那一次自评会弹出恭喜对话框，每天只弹一次，刷新不再弹；达成后可以继续刷题。
- 应用内冲刺伙伴按本地时间在未完成时显示普通 / 焦虑 / 抓狂；完成后固定为普通并提示“今日打卡成功”。PWA 安装图标保持不变。
- “学习记录”提供月历打卡与错题本；错题本收录最近评为不会/模糊的题，掌握后移出，“去练习”复用待复习模式。
- “随机刷题”和“待复习”分别保存导航位置；手动重新洗牌保留 XP、统计和待复习。

主状态保存为 `go-interview-progress-v3`。升级时优先读取 v3；仅在 v3 不存在时迁移有效 `go-interview-progress-v2`，再否则迁移有效 `go-interview-progress-v1`。v2 迁移会保留训练与 XP，但连续打卡按新的 20 道不同题规则重算。旧不会题不会被静默标记为掌握。存储不可访问、损坏或写入失败时，页面会以当前内存状态继续运行并显示非阻断提示。

## 安装为 PWA

PWA 安装需要 GitHub Pages 等 HTTPS 地址，或本机 `http://localhost`：

1. 在线打开站点并等待页面完整加载。
2. 在支持 `beforeinstallprompt` 的浏览器中点击页面的“安装应用”。
3. Chrome、Edge 或 Android 也可使用浏览器菜单中的“安装应用”或“添加到主屏幕”。
4. iPhone/iPad 请使用 Safari 的分享菜单，再选择“添加到主屏幕”。
5. 首次安装需要联网；应用壳成功缓存后，已安装应用才可离线启动。

浏览器是否展示安装入口由平台策略决定。处于 standalone 模式时页面会隐藏重复安装入口。安装不会改变进度的存储位置：每个设备和浏览器配置仍使用各自的 `localStorage`。

## 导出、分享与导入进度

项目没有账号、云同步或自动合并。跨设备转移需要用户主动操作：

1. 在源设备打开“进度管理”，选择“导出或分享进度”。
2. 浏览器支持 Web Share 文件分享时可交给系统分享，否则会下载 JSON。
3. 将 JSON 文件通过用户选择的渠道传到目标设备。
4. 在目标设备选择“导入进度文件”。
5. 应用会完整校验版本、结构、题号、完整题序和时间；校验成功后提示将覆盖本机进度。
6. 只有用户确认后才一次性替换并保存。取消、非法文件、未知版本或超过 1MB 的文件都不会修改当前进度。

导出文件包含 v2 练习源状态、`schemaVersion` 和 UTC 导出时间，不包含题目正文、答案、浏览器信息或个人信息。首版不自动合并两端数据，避免 XP 重复累计、连续天数冲突和题目统计失真。

## 键盘快捷键

- `Space`：揭晓或收起参考答案。
- `1`：答案显示后评为“不会”。
- `2`：答案显示后评为“模糊”。
- `3`：答案显示后评为“掌握”。
- `←`：上一题。
- `→`：跳过并前往下一题。
- `J`：加入或移出待复习。

焦点位于按钮、链接、文件输入、其他输入控件或可编辑区域时不会触发快捷键；带修饰键的组合操作也不会被拦截。

## 无障碍与移动端

- 题目、答案、自评、通知与进度提供语义标题和对应 ARIA 状态。
- 所有主要触控目标至少 44px，键盘焦点始终可见。
- 320px 宽度下导航和三级自评堆叠，页面不应横向溢出。
- 长答案使用页面自然滚动，代码块可单独横向滚动。
- 动画遵守 `prefers-reduced-motion`。

## 项目目录结构

```text
golang-Interview/
├── index.html                         # B1 语义页面，不包含题库
├── manifest.webmanifest               # 相对 PWA 安装元数据
├── service-worker.js                  # 同源应用壳缓存与离线回退
├── assets/
│   ├── app.js                         # v2 状态、迁移、DOM 与浏览器适配
│   ├── styles.css                     # B1 响应式视觉与无障碍状态
│   └── icons/                         # SVG 源与本地 PNG 安装图标
├── data/
│   └── questions.js                   # 独立生成的浏览器题库
├── scripts/
│   ├── extract_questions.py           # 提取并清理本地文章
│   ├── build_questions.py             # 合并补充内容并生成题库
│   └── verify_project.py              # 题库、PWA 与离线边界验证
├── tests/                             # Python 与 Node 内置测试
├── docs/                              # 来源、设计和 AI 维护说明
├── .cursor/rules/project-maintenance.mdc
└── AGENTS.md                          # 后续 AI 的第一入口
```

`index.html`、`assets/styles.css`、`assets/app.js` 和 `data/questions.js` 分别负责结构、样式、行为和内容。`manifest.webmanifest`、`service-worker.js` 与 `assets/icons/` 只负责安装与同源离线应用壳，不得成为第三方网络入口。

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
node --check service-worker.js
```

验证范围包括题库完整性与来源、安全 HTML、v2/v1 状态、XP 与复习调度、导入导出、页面文件拆分、本地资源、manifest、图标、Service Worker 同源边界、`file://` 降级、无远程依赖、无内联事件和 AI 维护文件。

人工检查还应覆盖：桌面和 320px 布局、纯键盘与触控、读屏状态、reduced motion、直接双击、安装入口、离线重开、更新提示、导出分享及确认替换导入。

## 后续 AI 维护

未来的 AI 代理必须先阅读根目录 `AGENTS.md`，再按任务选择：

- 更新题库：`docs/prompts/update-questions.md`
- 改进界面或 PWA：`docs/prompts/improve-ui.md`

完整状态、PWA 和进度转移工作流见 `docs/AI-MAINTENANCE.md`。数据或 UI 变化后必须运行全部验证命令并报告真实输出。

## GitHub Pages 部署

仓库是纯静态应用，不需要构建步骤：

1. 将人工审核后的内容提交并推送到 GitHub 默认分支。
2. 打开仓库 `Settings` → `Pages`。
3. 在 `Build and deployment` 中选择 `Deploy from a branch`。
4. 选择默认分支和根目录 `/ (root)`，保存配置。
5. 等待 HTTPS 页面发布后访问 <https://kary2999.github.io/golang-Interview/>。

所有应用壳资源使用相对路径，因此可部署在 GitHub Pages 子路径。Service Worker 的 scope 也保持相对，不硬编码仓库名或生产地址。
