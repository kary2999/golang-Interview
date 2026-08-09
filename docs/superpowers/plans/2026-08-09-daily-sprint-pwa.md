# Daily Sprint PWA Implementation Plan
<!-- [skill: go-team-standards · 技术方案 · dev-dna] 实现 B1 单卡快刷、PWA 安装与本地进度转移 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有离线 Go 面试题卡升级为可安装的 B1 单卡快刷 PWA，提供三级自评、XP、复习调度、localStorage v2 迁移及跨设备进度导入导出。

**Architecture:** 继续由 `index.html`、`assets/styles.css`、`assets/app.js` 和 `data/questions.js` 组成无依赖静态应用。`assets/app.js` 保存可独立测试的纯状态函数和浏览器适配层；新增 manifest、Service Worker 与本地图标提供 PWA 安装和离线应用壳，但 `file://` 始终跳过 Service Worker 并保留完整刷题能力。

**Tech Stack:** HTML5、CSS、原生 JavaScript、Service Worker、Web App Manifest、localStorage、Web Share API、Python 3.9 标准库、Node.js 22 内置测试、GitHub Pages。

---

## File map

- Modify `assets/app.js`: v2 状态、迁移、自评、XP、复习调度、导入导出、安装提示及 DOM 行为。
- Modify `tests/test_app.js`: 纯状态、存储、导入导出和浏览器交互测试。
- Modify `index.html`: B1 语义结构、三级自评、进度管理、安装与更新控件。
- Replace `assets/styles.css`: B1 视觉、响应式、焦点、状态反馈和 reduced motion。
- Create `manifest.webmanifest`: PWA 安装元数据。
- Create `service-worker.js`: 同源应用壳缓存、离线回退和更新生命周期。
- Create `assets/icons/app-icon.svg`: 可维护的图标源文件。
- Create `assets/icons/icon-192.png`: 192×192 安装图标。
- Create `assets/icons/icon-512.png`: 512×512 安装图标。
- Create `assets/icons/icon-maskable-512.png`: 512×512 maskable 图标。
- Modify `scripts/verify_project.py`: 校验 PWA 资源和 Service Worker 同源边界。
- Modify `tests/test_verify_project.py`: PWA 契约与违规回归测试。
- Modify `AGENTS.md`, `.cursor/rules/project-maintenance.mdc`, `README.md`, `docs/AI-MAINTENANCE.md`, `docs/prompts/improve-ui.md`: 同步新架构与维护契约。
- Keep `data/questions.js`, `scripts/extract_questions.py`, `scripts/build_questions.py` unchanged.

## Task 1: Add the v2 practice-state engine

**Files:**
- Modify: `tests/test_app.js:5-350`
- Modify: `assets/app.js:5-347`

- [ ] **Step 1: Replace v1 state tests with explicit v2 RED tests**

Add imports and tests for the new pure API:

```javascript
const {
  STATE_VERSION,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  applyRating,
  createInitialState,
  deriveAchievements,
  deriveLevel,
  getCurrentQuestionId,
  migrateLegacyState,
  normalizeState,
  toggleHardId,
} = require("../assets/app.js");

test("v2 initial state starts an infinite all-question round", () => {
  const state = createInitialState([1, 2, 3], () => 0);
  assert.equal(state.version, 2);
  assert.equal(state.mode, "all");
  assert.deepEqual(state.deck.slice().sort(), [1, 2, 3]);
  assert.equal(state.views.all.history.length, 1);
  assert.equal(getCurrentQuestionId(state), state.deck[0]);
  assert.equal(state.profile.totalXp, 0);
});

test("ratings award XP and schedule deterministic review", () => {
  const initial = createInitialState([1, 2, 3], () => 0);
  const questionId = getCurrentQuestionId(initial);
  const hard = applyRating(
    initial,
    "hard",
    [1, 2, 3],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  );
  assert.equal(hard.outcome.xpEarned, 2);
  assert.equal(hard.state.profile.totalXp, 2);
  assert.ok(hard.state.hardIds.includes(questionId));
  assert.deepEqual(hard.state.reviewQueue, [{
    questionId,
    dueAfterRatingCount: 8,
  }]);

  const fuzzy = applyRating(
    hard.state,
    "fuzzy",
    [1, 2, 3],
    "2026-08-09T09:01:00.000Z",
    () => 0,
  );
  assert.equal(fuzzy.outcome.xpEarned, 8);
  assert.equal(fuzzy.state.profile.totalXp, 10);
});

test("mastered rating removes review and derives levels", () => {
  assert.deepEqual(deriveLevel(0), {
    level: 1,
    currentXp: 0,
    requiredXp: 1000,
  });
  assert.deepEqual(deriveLevel(2680), {
    level: 3,
    currentXp: 680,
    requiredXp: 1000,
  });
});

test("achievements are derived from source progress only", () => {
  const state = createInitialState([1, 2, 3], () => 0);
  state.ratingCount = 100;
  state.round.number = 2;
  state.profile.longestStudyStreakDays = 7;
  state.questionStats = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [
      String(index + 1),
      {
        attempts: 1,
        hardCount: 0,
        fuzzyCount: 0,
        masteredCount: 1,
        lastRating: "mastered",
        lastReviewedAt: "2026-08-09T09:00:00.000Z",
      },
    ]),
  );
  assert.deepEqual(
    deriveAchievements(state).map((achievement) => achievement.id),
    ["first_rating", "hundred_ratings", "full_round", "seven_days", "fifty_mastered"],
  );
});

test("ten ratings in one local day earn one study day", () => {
  let state = createInitialState([1, 2, 3], () => 0);
  for (let index = 0; index < 10; index += 1) {
    state = applyRating(
      state,
      "mastered",
      [1, 2, 3],
      `2026-08-09T09:${String(index).padStart(2, "0")}:00.000Z`,
      () => 0,
    ).state;
  }
  assert.equal(state.profile.studyStreakDays, 1);
  assert.equal(state.activityDays[0].ratingCount, 10);
});

test("valid v1 state migrates without losing hard IDs", () => {
  const legacy = {
    version: 1,
    mode: "all",
    deck: [3, 1, 2],
    index: 1,
    hardIds: [2],
  };
  const migrated = migrateLegacyState(legacy, [1, 2, 3]);
  assert.equal(migrated.version, STATE_VERSION);
  assert.equal(getCurrentQuestionId(migrated), 1);
  assert.deepEqual(migrated.hardIds, [2]);
  assert.equal(migrated.profile.totalXp, 0);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
node --test --test-name-pattern="v2|ratings|mastered|ten ratings|migrates" tests/test_app.js
```

Expected: FAIL because v2 constants and functions do not exist or still return v1 state.

- [ ] **Step 3: Implement the pure v2 state API**

Start `assets/app.js` with these exact contracts:

```javascript
const STATE_VERSION = 2;
const STORAGE_KEY = "go-interview-progress-v2";
const LEGACY_STORAGE_KEY = "go-interview-progress-v1";
const MAX_HISTORY_LENGTH = 200;
const MAX_ACTIVITY_DAYS = 400;
const RATING_CONFIG = Object.freeze({
  hard: Object.freeze({ xp: 2, reviewAfter: 7 }),
  fuzzy: Object.freeze({ xp: 8, reviewAfter: 20 }),
  mastered: Object.freeze({ xp: 20, reviewAfter: null }),
});

function deriveLevel(totalXp) {
  if (!Number.isInteger(totalXp) || totalXp < 0) {
    throw new TypeError("total XP must be a nonnegative integer");
  }
  return {
    level: Math.floor(totalXp / 1000) + 1,
    currentXp: totalXp % 1000,
    requiredXp: 1000,
  };
}
```

Implement `createInitialState`, `normalizeState`, `migrateLegacyState`, `getCurrentQuestionId`, `applyRating`, `toggleHardId`, review-queue replacement, 200-item history trimming, all/hard view navigation, round rollover and 400-day activity retention with the exact field names from `docs/superpowers/specs/2026-08-09-daily-sprint-ui-design.md`.

Add `deriveAchievements(state)` returning achievement objects in this fixed order:

```javascript
[
  { id: "first_rating", title: "初次出发", unlocked: state.ratingCount >= 1 },
  { id: "hundred_ratings", title: "百题热身", unlocked: state.ratingCount >= 100 },
  { id: "full_round", title: "完整一轮", unlocked: state.round.number >= 2 },
  {
    id: "seven_days",
    title: "坚持一周",
    unlocked: state.profile.longestStudyStreakDays >= 7,
  },
  {
    id: "fifty_mastered",
    title: "渐入佳境",
    unlocked: Object.values(state.questionStats).filter(
      (stats) => stats.lastRating === "mastered",
    ).length >= 50,
  },
]
```

Return only entries whose `unlocked` value is true and never persist this array.

`applyRating` must return:

```javascript
{
  state: nextState,
  outcome: {
    xpEarned: 20,
    leveledUp: false,
    roundCompleted: false,
  },
}
```

All state transitions must clone arrays and nested objects instead of mutating input.

- [ ] **Step 4: Run all state tests GREEN**

Run:

```bash
node --test tests/test_app.js
```

Expected: all existing navigation, validation and new v2 state tests PASS.

## Task 2: Add versioned persistence and safe progress transfer

**Files:**
- Modify: `tests/test_app.js`
- Modify: `assets/app.js:286-347`

- [ ] **Step 1: Add RED tests for v2 load, export and import**

```javascript
test("load migrates legacy state and writes v2 only after validation", () => {
  const writes = new Map();
  const storage = {
    getItem(key) {
      if (key === LEGACY_STORAGE_KEY) {
        return JSON.stringify({
          version: 1,
          mode: "all",
          deck: [1, 2, 3],
          index: 1,
          hardIds: [3],
        });
      }
      return writes.get(key) ?? null;
    },
    setItem(key, value) {
      writes.set(key, value);
    },
  };
  const loaded = loadStoredState(storage, [1, 2, 3], () => 0);
  assert.equal(loaded.state.version, 2);
  assert.ok(writes.has(STORAGE_KEY));
  assert.deepEqual(loaded.state.hardIds, [3]);
});

test("progress export excludes question content and round-trips safely", () => {
  const state = createInitialState([1, 2, 3], () => 0);
  const exported = createProgressExport(state, "2026-08-09T09:00:00.000Z");
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.exportedAt, "2026-08-09T09:00:00.000Z");
  assert.equal(JSON.stringify(exported).includes("answerHtml"), false);
  assert.deepEqual(
    parseProgressImport(JSON.stringify(exported), [1, 2, 3]),
    state,
  );
});

test("invalid or oversized imports never return replacement state", () => {
  assert.throws(
    () => parseProgressImport("{not-json", [1, 2, 3]),
    /无法解析/,
  );
  assert.throws(
    () => parseProgressImport("x".repeat(1_000_001), [1, 2, 3]),
    /1MB/,
  );
});
```

- [ ] **Step 2: Run import tests and confirm RED**

Run:

```bash
node --test --test-name-pattern="load migrates|progress export|imports" tests/test_app.js
```

Expected: FAIL because export/import helpers are absent.

- [ ] **Step 3: Implement strict transfer helpers**

Implement:

```javascript
const MAX_IMPORT_BYTES = 1_000_000;

function createProgressExport(state, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: STATE_VERSION,
    exportedAt,
    data: normalizeState(state, state.deck, () => 0).state,
  };
}

function parseProgressImport(serialized, questionIds) {
  if (typeof serialized !== "string") {
    throw new TypeError("导入内容必须是 JSON 文本。");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_IMPORT_BYTES) {
    throw new TypeError("导入文件不能超过 1MB。");
  }
  let payload;
  try {
    payload = JSON.parse(serialized);
  } catch (error) {
    throw new TypeError("导入文件无法解析。");
  }
  if (
    payload === null
    || typeof payload !== "object"
    || payload.schemaVersion !== STATE_VERSION
    || typeof payload.exportedAt !== "string"
    || Number.isNaN(Date.parse(payload.exportedAt))
  ) {
    throw new TypeError("导入文件版本或导出时间无效。");
  }
  const normalized = normalizeState(payload.data, questionIds, () => 0);
  if (normalized.recovered) {
    throw new TypeError("导入进度结构无效。");
  }
  return normalized.state;
}
```

Update `loadStoredState` to read v2 first, migrate valid v1 only when v2 is absent, persist migrated v2, and retain in-memory fallback warnings. Update `saveStoredState` to write only `STORAGE_KEY`.

- [ ] **Step 4: Run persistence tests GREEN**

Run:

```bash
node --test tests/test_app.js
```

Expected: all storage, migration and transfer tests PASS.

## Task 3: Build the B1 single-card browser flow

**Files:**
- Modify: `index.html:1-183`
- Replace: `assets/styles.css:1-522`
- Modify: `assets/app.js:349-700`
- Modify: `tests/test_app.js:48-378`

- [ ] **Step 1: Extend the fake DOM and add RED interaction tests**

Add required element IDs to `makeFakeDocument`:

```javascript
const ids = [
  "app", "app-error", "storage-warning", "update-notice",
  "install-button", "install-help", "mode-all", "mode-hard", "hard-count",
  "achievements-button", "achievements-dialog", "achievements-list",
  "level-text", "xp-text", "xp-fill", "study-streak",
  "daily-count", "mastery-combo", "progress-text",
  "question-card", "question-number", "source-badge",
  "question-text", "answer-panel", "answer-content",
  "rating-panel", "rate-hard", "rate-fuzzy", "rate-mastered",
  "previous-button", "answer-button", "next-button",
  "hard-button", "reshuffle-button", "progress-dialog",
  "export-button", "import-input", "reset-button",
  "empty-state", "review-actions", "live-region",
];
```

Add tests that verify:

```javascript
test("answer reveal exposes rating controls and rating advances", () => {
  const { documentObject, browserGlobal } = makeBrowserHarness();
  startBrowserApp(documentObject, browserGlobal);
  const before = documentObject.elements.get("question-text").textContent;

  documentObject.elements.get("answer-button").click();
  assert.equal(documentObject.elements.get("rating-panel").hidden, false);
  documentObject.elements.get("rate-mastered").click();

  assert.notEqual(
    documentObject.elements.get("question-text").textContent,
    before,
  );
  assert.equal(documentObject.elements.get("answer-panel").hidden, true);
  assert.match(documentObject.elements.get("xp-text").textContent, /\d+/);
});

test("number shortcuts rate only after the answer is visible", () => {
  const { documentObject, browserGlobal } = makeBrowserHarness();
  startBrowserApp(documentObject, browserGlobal);
  documentObject.dispatchKey({ key: "1" });
  assert.equal(documentObject.elements.get("rating-panel").hidden, true);
  documentObject.elements.get("answer-button").click();
  documentObject.dispatchKey({ key: "1" });
  assert.match(documentObject.elements.get("live-region").textContent, /不会/);
});
```

- [ ] **Step 2: Run browser-flow tests and confirm RED**

Run:

```bash
node --test --test-name-pattern="answer reveal|number shortcuts" tests/test_app.js
```

Expected: FAIL because rating controls and v2 DOM rendering are absent.

- [ ] **Step 3: Replace `index.html` with the approved semantic structure**

The body must contain:

```html
<main id="app" class="app-shell">
  <header class="app-header">
    <a class="brand" href="./" aria-label="Go 冲刺营首页">
      <span class="brand-mark" aria-hidden="true">GO</span>
      <span>Go 冲刺营</span>
    </a>
    <nav class="mode-switch" aria-label="训练模式">
      <button id="mode-all" type="button" aria-pressed="true">随机刷题</button>
      <button id="mode-hard" type="button" aria-pressed="false">
        待复习 <span id="hard-count">0</span>
      </button>
      <button id="achievements-button" type="button">成就</button>
      <button type="button" aria-disabled="true" title="题目分类将在后续版本上线">
        分类即将上线
      </button>
    </nav>
    <button id="install-button" type="button" hidden>安装应用</button>
  </header>

  <section class="stats-strip" aria-label="学习状态">
    <p><span id="study-streak">0</span> 天连续</p>
    <div>
      <p><span id="level-text">Level 1</span> <span id="xp-text">0 / 1000 XP</span></p>
      <div role="progressbar" aria-label="等级经验">
        <span id="xp-fill"></span>
      </div>
    </div>
    <p>今日 <span id="daily-count">0</span> 题</p>
  </section>

  <article id="question-card" class="question-card">
    <header>
      <p id="question-number">第 1 题</p>
      <span id="source-badge" hidden>补充整理</span>
    </header>
    <h1 id="question-text">题库加载中…</h1>
    <section id="answer-panel" hidden>
      <h2>参考答案</h2>
      <div id="answer-content"></div>
    </section>
    <section id="rating-panel" hidden aria-label="掌握程度">
      <button id="rate-hard" type="button">不会 <small>+2 XP</small></button>
      <button id="rate-fuzzy" type="button">模糊 <small>+8 XP</small></button>
      <button id="rate-mastered" type="button">掌握 <small>+20 XP</small></button>
    </section>
  </article>
</main>
```

Keep notices, empty state, previous/reveal/next controls, hard toggle, reshuffle, live region, progress dialog, achievements dialog, install-help dialog, import input and scripts. Scripts remain ordered as `data/questions.js` then `assets/app.js`; no inline event handlers or module scripts.

- [ ] **Step 4: Implement the v2 DOM adapter**

Update `collectElements`, `render`, mode changes, reveal/rating handlers, navigation, import/export/reset, derived-achievement rendering, install prompt capture and keyboard handlers.

When `beforeinstallprompt` is unavailable, show install help only for non-standalone iPhone/iPad browsers. The help text must instruct Safari users to open Share and choose “添加到主屏幕”; do not claim installation succeeded until `appinstalled` fires or standalone display mode is detected.

Registration must be protocol-gated:

```javascript
function canRegisterServiceWorker(locationObject, navigatorObject) {
  return (
    navigatorObject !== null
    && "serviceWorker" in navigatorObject
    && (
      locationObject.protocol === "https:"
      || (
        locationObject.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(locationObject.hostname)
      )
    )
  );
}
```

Use `Blob`, `URL.createObjectURL` and a temporary download link as the universal export path. If `navigator.canShare({ files: [file] })` is true, offer system sharing; failure or cancellation falls back to download without losing the export.

Import must read the chosen file, call `parseProgressImport`, request overwrite confirmation, persist once, rerender, and clear the file input.

- [ ] **Step 5: Replace CSS with the B1 visual contract**

Implement local system typography, cream canvas, navy outlines, purple brand, orange primary action and yellow XP panel. Preserve:

- 44px minimum controls.
- 320px layout without horizontal overflow.
- visible `:focus-visible`.
- answer code horizontal scrolling.
- no fixed-height answer pane.
- rating buttons stacked on narrow screens.
- `[hidden] { display: none !important; }`.
- `@media (prefers-reduced-motion: reduce)` disabling transitions and animations.

- [ ] **Step 6: Run DOM, syntax and project tests GREEN**

Run:

```bash
node --test tests/test_app.js
node --check assets/app.js
python3 scripts/verify_project.py
```

Expected: Node tests and syntax PASS; verifier may remain RED only for not-yet-added PWA contract from Task 4.

## Task 4: Add installable PWA assets and verifier coverage

**Files:**
- Create: `manifest.webmanifest`
- Create: `service-worker.js`
- Create: `assets/icons/app-icon.svg`
- Create: `assets/icons/icon-192.png`
- Create: `assets/icons/icon-512.png`
- Create: `assets/icons/icon-maskable-512.png`
- Modify: `scripts/verify_project.py:19-69,320-367,455-570,627-642`
- Modify: `tests/test_verify_project.py:41-70,125-170,203-301`

- [ ] **Step 1: Add RED verifier tests for PWA resources**

Extend `write_valid_page` to create a manifest, Service Worker and icon fixtures. Add:

```python
def test_pwa_contract_requires_relative_manifest_icons_and_cache(self):
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        write_valid_page(root)
        verify_pwa(root)

        manifest = json.loads(
            (root / "manifest.webmanifest").read_text(encoding="utf-8")
        )
        manifest["start_url"] = "https://example.com/"
        (root / "manifest.webmanifest").write_text(
            json.dumps(manifest),
            encoding="utf-8",
        )
        with self.assertRaises(VerificationError):
            verify_pwa(root)

def test_service_worker_rejects_remote_cache_entries(self):
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        write_valid_page(root)
        service_worker = root / "service-worker.js"
        service_worker.write_text(
            service_worker.read_text(encoding="utf-8")
            + '\nconst remote = "https://example.com/app.js";\n',
            encoding="utf-8",
        )
        with self.assertRaises(VerificationError):
            verify_pwa(root)
```

- [ ] **Step 2: Run verifier tests and confirm RED**

Run:

```bash
python3 -m unittest tests.test_verify_project.VerifyProjectTest.test_pwa_contract_requires_relative_manifest_icons_and_cache -v
```

Expected: FAIL because `verify_pwa` does not exist.

- [ ] **Step 3: Create the manifest and Service Worker**

Use this manifest:

```json
{
  "name": "Go 面试冲刺营",
  "short_name": "Go 冲刺营",
  "description": "可离线安装的 Go 面试单卡快刷应用",
  "lang": "zh-CN",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f7f3e9",
  "theme_color": "#6857e5",
  "icons": [
    {
      "src": "assets/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "assets/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "assets/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

`service-worker.js` must declare a versioned cache and only relative assets:

```javascript
const CACHE_NAME = "go-interview-v2";
const APP_SHELL = Object.freeze([
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/app.js",
  "./data/questions.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
]);
```

Install with `cache.addAll(APP_SHELL)`, delete noncurrent `go-interview-` caches on activate, use network-first navigation with cached `./index.html` fallback, and cache-first same-origin static GET requests.

- [ ] **Step 4: Generate local icons**

Create `assets/icons/app-icon.svg` using only local vector markup: cream background, rounded navy border, purple inset card, white `GO` lettering and orange lightning accent. Convert it with macOS `sips`:

```bash
sips -s format png -z 192 192 assets/icons/app-icon.svg --out assets/icons/icon-192.png
sips -s format png -z 512 512 assets/icons/app-icon.svg --out assets/icons/icon-512.png
sips -s format png -z 512 512 assets/icons/app-icon.svg --out assets/icons/icon-maskable-512.png
```

Verify dimensions:

```bash
sips -g pixelWidth -g pixelHeight assets/icons/icon-192.png assets/icons/icon-512.png assets/icons/icon-maskable-512.png
```

Expected: 192×192, 512×512 and 512×512.

- [ ] **Step 5: Implement `verify_pwa` and allow only scoped Service Worker fetch**

Add JSON validation for exact manifest fields, relative paths, local icon existence and PNG signatures. Parse `service-worker.js` separately from `assets/app.js`: allow its `fetch` event and same-origin request handling, but continue rejecting remote URLs, dynamic import, XMLHttpRequest, WebSocket, EventSource, WebTransport and sendBeacon everywhere.

`verify_project` must call:

```python
verify_index(root)
verify_static_code(root)
verify_pwa(root)
verify_required_files(root)
```

- [ ] **Step 6: Run all verifier tests GREEN**

Run:

```bash
python3 -m unittest tests.test_verify_project -v
python3 scripts/verify_project.py
```

Expected: all tests PASS and summary reports PWA resources OK.

## Task 5: Update maintenance documentation and verify delivery

**Files:**
- Modify: `AGENTS.md`
- Modify: `.cursor/rules/project-maintenance.mdc`
- Modify: `README.md`
- Modify: `docs/AI-MAINTENANCE.md`
- Modify: `docs/prompts/improve-ui.md`
- Modify: `docs/superpowers/specs/2026-08-09-daily-sprint-ui-design.md`
- Add: `docs/superpowers/plans/2026-08-09-daily-sprint-pwa.md`

- [ ] **Step 1: Update repository contracts**

Document:

- v2 state and v1 migration.
- rating values 2/8/20 XP.
- 10-rating daily streak threshold.
- install support only on HTTPS/localhost.
- `file://` fallback without Service Worker.
- manual JSON replacement import, no automatic merge or cloud sync.
- required manifest, Service Worker and icon files.
- the narrow exception allowing same-origin Service Worker fetch interception while application code remains network-free.

Keep `.cursor/rules/project-maintenance.mdc` below 50 lines.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
node --check assets/app.js
node --check service-worker.js
```

Expected: every command exits 0 with no failures.

- [ ] **Step 3: Perform targeted manual checks**

Open `index.html` directly and confirm no Service Worker registration error, then serve the repository over localhost and confirm manifest and worker registration:

```bash
python3 -m http.server 8080
```

Check desktop keyboard flow, 320px responsive layout, export/download, valid import replacement, invalid import preservation, install-button eligibility, offline reload and nonblocking update notice. Stop the local server after checks.

- [ ] **Step 4: Review the complete diff**

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff
```

Confirm no generated preview files under `.superpowers/`, no remote resources, no question-data edits and no secrets.

- [ ] **Step 5: Commit the verified implementation**

Read the repository commit convention, stage only implementation, tests, PWA assets and approved docs, then commit:

```bash
git add \
  .cursor/rules/project-maintenance.mdc \
  AGENTS.md README.md index.html \
  assets/app.js assets/styles.css assets/icons \
  manifest.webmanifest service-worker.js \
  scripts/verify_project.py \
  tests/test_app.js tests/test_verify_project.py \
  docs/AI-MAINTENANCE.md docs/prompts/improve-ui.md \
  docs/superpowers/specs/2026-08-09-daily-sprint-ui-design.md \
  docs/superpowers/plans/2026-08-09-daily-sprint-pwa.md
git commit -m "feat(web): add installable daily sprint practice"
git status --short
```

Expected: commit succeeds and the worktree is clean except any intentionally retained, untracked visual-companion files.
