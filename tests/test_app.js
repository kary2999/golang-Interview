// [skill: go-team-standards · dev-dna] 验证离线题库的状态与导航契约
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  STATE_VERSION,
  createInitialState,
  getActiveDeck,
  loadStoredState,
  navigateIndex,
  normalizeQuestions,
  normalizeState,
  saveStoredState,
  shuffle,
  startBrowserApp,
  toggleHardId,
} = require("../assets/app.js");

const ROOT = path.resolve(__dirname, "..");

function makeQuestions() {
  return [
    {
      id: 1,
      question: "问题 1",
      answerHtml: "<p>答案 1</p>",
      source: "zhihu-archive",
    },
    {
      id: 2,
      question: "问题 2",
      answerHtml: "<pre><code class=\"language-go\">func main() {}</code></pre>",
      source: "zhihu-archive",
    },
    {
      id: 3,
      question: "问题 3",
      answerHtml: "<p><strong>答案 3</strong></p>",
      source: "supplemented",
    },
  ];
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.attributes = new Map();
    this.disabled = false;
    this.hidden = false;
    this.innerHTML = "";
    this.isContentEditable = false;
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {};
    this.tagName = id.endsWith("button") ? "BUTTON" : "DIV";
    this.textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    if (this.disabled) {
      return;
    }
    for (const listener of this.listeners.get("click") || []) {
      listener({ target: this });
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function makeFakeDocument() {
  const ids = [
    "app",
    "app-error",
    "storage-warning",
    "mode-all",
    "mode-hard",
    "hard-count",
    "progress-text",
    "progress-bar",
    "progress-fill",
    "question-card",
    "question-number",
    "source-badge",
    "question-text",
    "answer-panel",
    "answer-content",
    "empty-state",
    "previous-button",
    "answer-button",
    "next-button",
    "hard-button",
    "reshuffle-button",
    "review-actions",
    "live-region",
  ];
  const elements = new Map(
    ids.map((id) => [id, new FakeElement(id)]),
  );
  return {
    addEventListener() {},
    body: new FakeElement("body"),
    elements,
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector !== "button") {
        return [];
      }
      return [...elements.values()].filter(
        (element) => element.tagName === "BUTTON",
      );
    },
  };
}

test("shuffle returns every item once without mutating the input", () => {
  const input = [1, 2, 3, 4, 5];
  const original = input.slice();
  const result = shuffle(input, () => 0);

  assert.deepEqual(input, original);
  assert.deepEqual(result.slice().sort((left, right) => left - right), original);
  assert.equal(new Set(result).size, original.length);
  assert.notDeepEqual(result, original);
});

test("normalizeState resets malformed stored state", async (context) => {
  const ids = [1, 2, 3];
  const malformedStates = {
    "wrong version": {
      version: STATE_VERSION + 1,
      mode: "all",
      deck: ids,
      index: 0,
      hardIds: [],
    },
    "invalid deck ID": {
      version: STATE_VERSION,
      mode: "all",
      deck: [1, 2, 99],
      index: 0,
      hardIds: [],
    },
    "duplicate deck ID": {
      version: STATE_VERSION,
      mode: "all",
      deck: [1, 1, 3],
      index: 0,
      hardIds: [],
    },
    "invalid mode": {
      version: STATE_VERSION,
      mode: "unknown",
      deck: ids,
      index: 0,
      hardIds: [],
    },
    "out-of-range index": {
      version: STATE_VERSION,
      mode: "all",
      deck: ids,
      index: ids.length,
      hardIds: [],
    },
    "duplicate hard ID": {
      version: STATE_VERSION,
      mode: "all",
      deck: ids,
      index: 0,
      hardIds: [2, 2],
    },
    "invalid hard ID": {
      version: STATE_VERSION,
      mode: "all",
      deck: ids,
      index: 0,
      hardIds: [99],
    },
  };

  for (const [label, candidate] of Object.entries(malformedStates)) {
    await context.test(label, () => {
      const normalized = normalizeState(candidate, ids, () => 0);

      assert.equal(normalized.recovered, true);
      assert.equal(normalized.state.version, STATE_VERSION);
      assert.equal(normalized.state.mode, "all");
      assert.equal(normalized.state.index, 0);
      assert.deepEqual(normalized.state.hardIds, []);
      assert.deepEqual(
        normalized.state.deck.slice().sort((left, right) => left - right),
        ids,
      );
    });
  }
});

test("hard mode filters the stable round deck in deck order", () => {
  const state = {
    version: STATE_VERSION,
    mode: "hard",
    deck: [4, 2, 1, 3],
    index: 0,
    hardIds: [1, 4],
  };

  assert.deepEqual(getActiveDeck(state), [4, 1]);
  assert.deepEqual(state.deck, [4, 2, 1, 3]);
});

test("navigation wraps in both directions and handles an empty deck", () => {
  assert.equal(navigateIndex(0, 3, -1), 2);
  assert.equal(navigateIndex(2, 3, 1), 0);
  assert.equal(navigateIndex(1, 3, 1), 2);
  assert.equal(navigateIndex(0, 0, 1), 0);
});

test("hard-ID toggling adds once, removes cleanly, and clamps hard mode", () => {
  const initial = {
    version: STATE_VERSION,
    mode: "hard",
    deck: [1, 2, 3],
    index: 1,
    hardIds: [1, 2],
  };

  const removed = toggleHardId(initial, 2);
  assert.deepEqual(removed.hardIds, [1]);
  assert.equal(removed.index, 0);
  assert.deepEqual(initial.hardIds, [1, 2]);

  const added = toggleHardId(removed, 3);
  assert.deepEqual(added.hardIds, [1, 3]);
  assert.equal(new Set(added.hardIds).size, added.hardIds.length);
});

test("removing the last hard question resets and hides review controls", () => {
  const documentObject = makeFakeDocument();
  const storedState = {
    version: STATE_VERSION,
    mode: "hard",
    deck: [1],
    index: 0,
    hardIds: [1],
  };
  const browserGlobal = {
    GO_INTERVIEW_QUESTIONS: [makeQuestions()[0]],
    localStorage: {
      getItem() {
        return JSON.stringify(storedState);
      },
      setItem() {},
    },
    setTimeout(callback) {
      callback();
    },
  };

  startBrowserApp(documentObject, browserGlobal);
  const hardButton = documentObject.elements.get("hard-button");
  assert.equal(hardButton.textContent, "取消不会");
  assert.equal(hardButton.getAttribute("aria-pressed"), "true");

  hardButton.click();

  assert.equal(documentObject.elements.get("empty-state").hidden, false);
  assert.equal(documentObject.elements.get("question-card").hidden, true);
  assert.equal(documentObject.elements.get("review-actions").hidden, true);
  assert.equal(hardButton.disabled, true);
  assert.equal(hardButton.textContent, "标记不会");
  assert.equal(hardButton.getAttribute("aria-pressed"), "false");
});

test("storage failures and corrupt payloads degrade without throwing", () => {
  const ids = [1, 2, 3];
  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  const loaded = loadStoredState(throwingStorage, ids, () => 0);
  assert.equal(loaded.state.version, STATE_VERSION);
  assert.match(loaded.warning, /无法读取/);

  const saved = saveStoredState(
    throwingStorage,
    createInitialState(ids, () => 0),
  );
  assert.equal(saved.ok, false);
  assert.match(saved.warning, /无法保存/);

  const corruptStorage = {
    getItem() {
      return "{not-json";
    },
  };
  const corrupt = loadStoredState(corruptStorage, ids, () => 0);
  assert.equal(corrupt.state.mode, "all");
  assert.match(corrupt.warning, /已重置/);
});

test("question validation accepts safe records and rejects malformed input", async (context) => {
  const valid = makeQuestions();
  const normalized = normalizeQuestions(valid);

  assert.deepEqual(normalized, valid);
  assert.notEqual(normalized, valid);

  const invalidInputs = {
    "non-array dataset": null,
    "empty dataset": [],
    "duplicate ID": [valid[0], { ...valid[1], id: 1 }],
    "boolean ID": [{ ...valid[0], id: true }],
    "empty question": [{ ...valid[0], question: " " }],
    "empty answer": [{ ...valid[0], answerHtml: "<p><br></p>" }],
    "unknown source": [{ ...valid[0], source: "unknown" }],
    "unsafe answer tag": [{ ...valid[0], answerHtml: "<script>alert(1)</script>" }],
    "unsafe answer attribute": [
      { ...valid[0], answerHtml: "<p onclick=\"alert(1)\">答案</p>" },
    ],
  };

  for (const [label, input] of Object.entries(invalidInputs)) {
    await context.test(label, () => {
      assert.throws(() => normalizeQuestions(input), TypeError);
    });
  }
});

test("mobile action layout preserves DOM and visual focus order", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const previousIndex = html.indexOf('id="previous-button"');
  const answerIndex = html.indexOf('id="answer-button"');
  const nextIndex = html.indexOf('id="next-button"');

  assert.ok(previousIndex >= 0);
  assert.ok(previousIndex < answerIndex);
  assert.ok(answerIndex < nextIndex);

  const css = fs.readFileSync(
    path.join(ROOT, "assets", "styles.css"),
    "utf8",
  );
  const mobileStart = css.indexOf("@media (max-width: 430px)");
  const mobileEnd = css.indexOf(
    "@media (prefers-reduced-motion: reduce)",
    mobileStart,
  );
  const mobileCss = css.slice(mobileStart, mobileEnd);

  assert.match(
    mobileCss,
    /\.card-actions\s*\{[^}]*grid-template-columns:\s*1fr\s*;/s,
  );
  assert.doesNotMatch(mobileCss, /\b(?:grid-row|order)\s*:/);
});
