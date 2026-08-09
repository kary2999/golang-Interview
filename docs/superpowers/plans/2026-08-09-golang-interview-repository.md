# Golang Interview Repository Implementation Plan
<!-- [skill: go-team-standards · 技术方案 · dev-dna] 拆分题库并建立可持续 AI 维护流程 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task with specification and quality reviews.

**Goal:** 在独立 GitHub 仓库中交付题库与主页面分离、可双击运行、可由后续 AI 安全维护的 Go 面试随机刷题网站。

**Architecture:** `index.html` 加载独立的 `data/questions.js`、`assets/app.js` 和 `assets/styles.css`。Python 脚本从本地文章生成题库并显式补齐原文缺失内容；项目规则、维护文档和提示词约束后续 AI 更新流程。

**Tech Stack:** HTML5、CSS、原生 JavaScript、Python 3.9 标准库、Node.js 22 内置测试、GitHub。

---

## Task 1: Create the independent repository workspace

**Files:**
- Create repository directory: `/Users/karp/Documents/golang-Interview`
- Copy reviewed files: `scripts/extract_questions.py`, `tests/test_extract_questions.py`, `tests/fixtures/article_sample.html`
- Copy design and plan documents under `docs/superpowers/`

- [ ] Authenticate GitHub CLI and clone `kary2999/golang-Interview`.
- [ ] Verify `origin` points to `https://github.com/kary2999/golang-Interview`.
- [ ] Copy only reviewed source, tests, and current design/plan documents.
- [ ] Run `python3 -m unittest tests/test_extract_questions.py -v`.
- [ ] Confirm no secrets, downloaded Zhihu asset bundle, or original 700 KB article is copied into the repository.

## Task 2: Generate a separate 100-question data file

**Files:**
- Create: `scripts/build_questions.py`
- Create: `tests/test_build_questions.py`
- Create: `data/questions.js`
- Create: `docs/CONTENT-SOURCES.md`

- [ ] Write failing tests that require:
  - IDs exactly 1–100.
  - Every question and answer is nonempty.
  - Original records use `source: "zhihu-archive"`.
  - IDs 73, 89, and 90 use `source: "supplemented"`.
  - The generated JavaScript assigns `window.GO_INTERVIEW_QUESTIONS`.
- [ ] Run tests and confirm failure because the builder is absent.
- [ ] Implement `build_questions.py` using the reviewed extractor.
- [ ] Add supplemental content:
  - 73: value receiver versus pointer receiver, including method-set implications.
  - 89: memory optimization based on profiling, allocation reduction, preallocation, streaming, and careful pooling.
  - 90: GC optimization based on allocation/live-heap reduction, `GOGC`, `GOMEMLIMIT`, profiling, and avoiding request-path `runtime.GC()`.
- [ ] Validate merged data through the strict answer HTML validator.
- [ ] Generate deterministic UTF-8 `data/questions.js`.
- [ ] Document exact source gaps and supplemental records in `docs/CONTENT-SOURCES.md`.
- [ ] Run all Python tests green.

## Task 3: Implement tested learning-state logic

**Files:**
- Create: `tests/test_app.js`
- Create: `assets/app.js`

- [ ] Write failing Node tests for:
  - Fisher–Yates returns every ID once and does not mutate input.
  - Stored state rejects invalid IDs, duplicate deck entries, invalid modes, and out-of-range indices.
  - Hard-mode deck contains only marked questions.
  - Index navigation wraps at both ends.
  - Hard marking toggles without duplicates.
  - Storage exceptions degrade without throwing.
- [ ] Run `node --test tests/test_app.js` and confirm the missing-module failure.
- [ ] Implement pure functions and export them through CommonJS and `window.GoInterviewCore`.
- [ ] Guard all DOM startup behind `typeof document !== "undefined"`.
- [ ] Run the Node suite green.

## Task 4: Implement the split static interface

**Files:**
- Create: `index.html`
- Create: `assets/styles.css`
- Modify: `assets/app.js`

- [ ] Create semantic HTML using the approved focus-card design.
- [ ] Load files in this order:

```html
<link rel="stylesheet" href="assets/styles.css">
<script src="data/questions.js"></script>
<script src="assets/app.js"></script>
```

- [ ] Render one question at a time and hide answers on startup and navigation.
- [ ] Add all-questions mode, hard-question mode, reshuffle, previous/next, answer reveal, and hard toggle.
- [ ] Persist versioned state in `localStorage`; show a nonblocking warning on failure.
- [ ] Bind Space, ArrowLeft, ArrowRight, and J without intercepting interactive controls.
- [ ] Show `source: "supplemented"` as a visible “补充整理” badge.
- [ ] Keep code blocks horizontally scrollable and mobile actions reachable at 320px width.
- [ ] Ensure no CDN, remote font, remote image, module import, or runtime `fetch` exists.
- [ ] Run `node --check assets/app.js` and the Node tests.

## Task 5: Add future-AI maintenance guidance

**Files:**
- Create: `AGENTS.md`
- Create: `.cursor/rules/project-maintenance.mdc`
- Create: `docs/AI-MAINTENANCE.md`
- Create: `docs/prompts/update-questions.md`
- Create: `docs/prompts/improve-ui.md`
- Create: `README.md`

- [ ] Write an always-applied Cursor rule under 50 lines.
- [ ] Make `AGENTS.md` the single entry point for future AI agents.
- [ ] Document file ownership, data schema, source labels, commands, and prohibited changes.
- [ ] Add a question-update prompt that requires source review, nonempty answers, accurate provenance, and full verification.
- [ ] Add a UI-improvement prompt that protects data separation, `file://` support, accessibility, and current behavior.
- [ ] Document local usage, GitHub Pages compatibility, shortcuts, test commands, and source disclaimer in README.

## Task 6: Add project-level verification

**Files:**
- Create: `scripts/verify_project.py`
- Create or modify tests as required by discovered regressions.

- [ ] Write failing verifier tests before implementing new verification behavior.
- [ ] Verify:
  - 100 unique sequential IDs.
  - Nonempty question and answer.
  - Only known source labels.
  - Safe answer HTML.
  - Local references from `index.html` resolve.
  - No remote `src`, `href`, `fetch`, or dynamic import.
  - `index.html` references the separate question file rather than embedding data.
  - Required maintenance files exist.
- [ ] Run:

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_app.js
python3 scripts/verify_project.py
```

- [ ] Open `index.html` directly and manually smoke-test answer hiding, navigation, hard mode, refresh persistence, supplemental badges, keyboard shortcuts, and narrow-screen layout.

## Task 7: Review, commit, and publish

- [ ] Run a specification-compliance review against the approved repository design.
- [ ] Run a code-quality and security review; fix all Critical and Important findings.
- [ ] Re-run the full verification suite after fixes.
- [ ] Inspect `git status`, complete staged/unstaged diff, and recent log.
- [ ] Ensure no secret, original downloaded page, temporary file, or generated browser state is staged.
- [ ] Create reviewable Conventional Commits with lowercase English imperative subjects.
- [ ] Push the default branch to `origin` without force.
- [ ] Verify the remote branch and return the GitHub repository URL and final local path.
