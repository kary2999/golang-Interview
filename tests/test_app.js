// [skill: go-team-standards · dev-dna] 验证离线题库的状态与导航契约
// [skill: code-review v2] 已自检 · 覆盖状态、存储、交互与 PWA 边界
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CHECKIN_CELEBRATION_MESSAGE,
  CHECKIN_CELEBRATION_TITLE,
  CHECKIN_SUCCESS_LABEL,
  DAILY_CHECKIN_UNIQUE_QUESTIONS,
  LEGACY_STORAGE_KEY,
  MASCOT_MOOD_LABELS,
  MAX_ACTIVITY_DAYS,
  MAX_HISTORY_LENGTH,
  MAX_IMPORT_BYTES,
  PREVIOUS_STORAGE_KEY,
  RATING_CONFIG,
  RATING_PRIMARY_FEEDBACK,
  RATING_SECONDARY_FEEDBACK,
  STATE_VERSION,
  STORAGE_KEY,
  V2_MIGRATION_NOTICE,
  XP_PER_LEVEL,
  applyRating,
  buildRatingAnnouncement,
  canRegisterServiceWorker,
  createExportPayload,
  createInitialState,
  createProgressExport,
  deriveAchievements,
  deriveCalendarMonth,
  deriveDailyCheckIn,
  deriveLevel,
  deriveMascotMood,
  deriveNotebookItems,
  getActiveDeck,
  getCurrentQuestionId,
  loadStoredState,
  localDayKey,
  migrateLegacyState,
  migrateV2State,
  navigateIndex,
  normalizeQuestions,
  normalizeState,
  parseImportPayload,
  parseProgressImport,
  saveStoredState,
  shuffle,
  startBrowserApp,
  toggleHardId,
} = require("../assets/app.js");

const ROOT = path.resolve(__dirname, "..");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function makeStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  const writes = [];
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    values,
    writes,
  };
}

function makeQuestions() {
  return [
    {
      id: 1,
      question: "问题 1",
      promptHtml: "",
      answerHtml: "<p>答案 1</p>",
      source: "zhihu-archive",
    },
    {
      id: 2,
      question: "问题 2",
      promptHtml: "",
      answerHtml: "<pre><code class=\"language-go\">func main() {}</code></pre>",
      source: "zhihu-archive",
    },
    {
      id: 3,
      question: "问题 3",
      promptHtml: "",
      answerHtml: "<p><strong>答案 3</strong></p>",
      source: "supplemented",
    },
  ];
}

class FakeElement {
  constructor(id, tagName = "") {
    this.id = id;
    this.attributes = new Map();
    this.children = [];
    this.clickCount = 0;
    this.disabled = false;
    this.files = [];
    this.focusCount = 0;
    this.hidden = false;
    this.href = "";
    this.innerHTML = "";
    this.isContentEditable = false;
    this.listeners = new Map();
    this.open = false;
    this.parentElement = null;
    this.style = {};
    this.tagName = tagName || (
      id.endsWith("button") || id.startsWith("rate-")
        ? "BUTTON"
        : id === "import-input"
          ? "INPUT"
          : id.endsWith("dialog")
            ? "DIALOG"
            : "DIV"
    );
    this.tabIndex = 0;
    this.textContent = "";
    this.value = "";
    this._className = "";
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value);
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
    this.textContent = children.map((child) => child.textContent || "").join("");
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  close() {
    this.open = false;
    this.hidden = true;
  }

  click() {
    if (this.disabled) {
      return;
    }
    this.clickCount += 1;
    for (const listener of this.listeners.get("click") || []) {
      listener({
        currentTarget: this,
        preventDefault() {},
        target: this,
      });
    }
  }

  focus() {
    this.focusCount += 1;
  }

  async dispatch(type, overrides = {}) {
    const event = {
      currentTarget: this,
      preventDefault() {},
      target: this,
      ...overrides,
    };
    await Promise.all(
      (this.listeners.get(type) || []).map((listener) => listener(event)),
    );
    return event;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  remove() {
    if (this.parentElement === null) {
      return;
    }
    this.parentElement.children = this.parentElement.children.filter(
      (child) => child !== this,
    );
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  showModal() {
    this.open = true;
    this.hidden = false;
  }
}

function makeFakeDocument() {
  const ids = [
    "app",
    "app-error",
    "storage-warning",
    "update-notice",
    "update-action",
    "update-message",
    "round-summary",
    "install-button",
    "install-help",
    "progress-button",
    "mode-all",
    "mode-hard",
    "hard-count",
    "achievements-button",
    "achievements-dialog",
    "achievements-list",
    "level-text",
    "xp-text",
    "xp-fill",
    "mascot",
    "mascot-status",
    "study-streak",
    "daily-count",
    "daily-goal",
    "daily-checkin-caption",
    "daily-progress",
    "daily-progress-fill",
    "mastery-combo",
    "study-records-button",
    "study-records-dialog",
    "study-records-title",
    "study-records-close",
    "tab-calendar",
    "tab-notebook",
    "panel-calendar",
    "panel-notebook",
    "calendar-prev",
    "calendar-next",
    "calendar-month-label",
    "calendar-grid",
    "notebook-list",
    "notebook-empty",
    "checkin-dialog",
    "checkin-dialog-title",
    "checkin-dialog-message",
    "checkin-dialog-stats",
    "checkin-dialog-close",
    "level-up-effect",
    "level-up-badge",
    "rating-feedback-primary",
    "rating-feedback-secondary",
    "progress-text",
    "progress-bar",
    "progress-fill",
    "question-card",
    "question-number",
    "source-badge",
    "question-text",
    "prompt-content",
    "answer-panel",
    "answer-content",
    "rating-panel",
    "rate-hard",
    "rate-fuzzy",
    "rate-mastered",
    "rating-feedback",
    "empty-state",
    "previous-button",
    "answer-button",
    "next-button",
    "hard-button",
    "reshuffle-button",
    "review-actions",
    "progress-dialog",
    "progress-dialog-close",
    "export-button",
    "import-input",
    "reset-button",
    "live-region",
  ];
  const elements = new Map(
    ids.map((id) => [id, new FakeElement(id)]),
  );
  const listeners = new Map();
  const body = new FakeElement("body", "BODY");
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    body,
    createElement(tagName) {
      return new FakeElement(tagName, tagName.toUpperCase());
    },
    async dispatch(type, overrides = {}) {
      const event = {
        altKey: false,
        ctrlKey: false,
        defaultPrevented: false,
        key: "",
        metaKey: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        shiftKey: false,
        target: body,
        ...overrides,
      };
      await Promise.all(
        (listeners.get(type) || []).map((listener) => listener(event)),
      );
      return event;
    },
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
    querySelector(selector) {
      if (selector === "[data-update-action]") {
        return elements.get("update-action");
      }
      return null;
    },
  };
}

function makeBrowserGlobal({
  questions = makeQuestions(),
  reducedMotion = false,
  standalone = false,
  storage = makeStorage(),
  protocol = "file:",
  hostname = "",
  userAgent = "Desktop Browser",
} = {}) {
  const listeners = new Map();
  const timers = [];
  const navigator = {
    standalone,
    userAgent,
  };
  return {
    GO_INTERVIEW_QUESTIONS: questions,
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options.type;
      }
    },
    File: class FakeFile {
      constructor(parts, name, options) {
        this.name = name;
        this.parts = parts;
        this.type = options.type;
      }
    },
    URL: {
      createObjectURL() {
        return "blob:progress";
      },
      revokeObjectURL() {},
    },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    async dispatch(type, overrides = {}) {
      const event = {
        preventDefault() {},
        ...overrides,
      };
      await Promise.all(
        (listeners.get(type) || []).map((listener) => listener(event)),
      );
      return event;
    },
    localStorage: storage,
    location: { hostname, protocol },
    matchMedia(query) {
      return {
        matches: query.includes("reduced-motion")
          ? reducedMotion
          : standalone,
      };
    },
    navigator,
    runTimers() {
      const pending = timers.splice(0, timers.length);
      for (const timer of pending) {
        timer.callback();
      }
    },
    clearTimeout(timerId) {
      const index = timers.findIndex((timer) => timer.id === timerId);
      if (index >= 0) {
        timers.splice(index, 1);
      }
    },
    setTimeout(callback, delay = 0) {
      const id = timers.length + 1;
      timers.push({ callback, delay, id });
      return id;
    },
    storage,
    timers,
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

test("v2 initial state starts an infinite all-question round", () => {
  const state = createInitialState([1, 2, 3], () => 0);

  assert.equal(STATE_VERSION, 3);
  assert.equal(STORAGE_KEY, "go-interview-progress-v3");
  assert.equal(PREVIOUS_STORAGE_KEY, "go-interview-progress-v2");
  assert.equal(LEGACY_STORAGE_KEY, "go-interview-progress-v1");
  assert.equal(DAILY_CHECKIN_UNIQUE_QUESTIONS, 20);
  assert.equal(MAX_HISTORY_LENGTH, 200);
  assert.equal(MAX_ACTIVITY_DAYS, 400);
  assert.equal(Object.isFrozen(RATING_CONFIG), true);
  assert.equal(Object.isFrozen(RATING_CONFIG.hard), true);
  assert.deepEqual(RATING_CONFIG, {
    hard: { xp: 2 },
    fuzzy: { xp: 8 },
    mastered: { xp: 20 },
  });
  assert.deepEqual(state.deck, [2, 3, 1]);
  assert.equal(state.deckIndex, 1);
  assert.deepEqual(state.views, {
    all: {
      currentQuestionId: 2,
      history: [2],
      historyIndex: 0,
    },
    hard: {
      deck: [],
      index: 0,
    },
  });
  assert.deepEqual(state.hardIds, []);
  assert.deepEqual(state.reviewQueue, []);
  assert.equal(state.ratingCount, 0);
  assert.deepEqual(state.round, {
    number: 1,
    seenIds: [2],
    xpEarned: 0,
    ratings: {
      hard: 0,
      fuzzy: 0,
      mastered: 0,
    },
  });
  assert.deepEqual(state.profile, {
    totalXp: 0,
    masteryCombo: 0,
    studyStreakDays: 0,
    longestStudyStreakDays: 0,
    lastPracticeAt: null,
  });
  assert.deepEqual(state.activityDays, []);
  assert.deepEqual(state.questionStats, {});
  assert.equal(getCurrentQuestionId(state), 2);
});

test("ratings award repeat XP without scheduling a random-stream comeback", () => {
  const initial = createInitialState([1], () => 0);
  const questionId = getCurrentQuestionId(initial);
  const hard = applyRating(
    initial,
    "hard",
    [1],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  );

  assert.deepEqual(hard.outcome, {
    xpEarned: 2,
    leveledUp: false,
    roundCompleted: true,
    checkInCompleted: false,
  });
  assert.equal(hard.state.profile.totalXp, 2);
  assert.deepEqual(hard.state.hardIds, [questionId]);
  assert.deepEqual(hard.state.reviewQueue, []);

  const fuzzy = applyRating(
    hard.state,
    "fuzzy",
    [1],
    "2026-08-09T09:01:00.000Z",
    () => 0,
  );

  assert.equal(fuzzy.outcome.xpEarned, 8);
  assert.equal(fuzzy.state.profile.totalXp, 10);
  assert.deepEqual(fuzzy.state.reviewQueue, []);
  assert.deepEqual(fuzzy.state.questionStats[String(questionId)], {
    attempts: 2,
    hardCount: 1,
    fuzzyCount: 1,
    masteredCount: 0,
    lastRating: "fuzzy",
    lastReviewedAt: "2026-08-09T09:01:00.000Z",
  });
});

test("mastered rating removes hard state and increments mastery combo", () => {
  const initial = createInitialState([1], () => 0);
  const hard = applyRating(
    initial,
    "hard",
    [1],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  const mastered = applyRating(
    hard,
    "mastered",
    [1],
    "2026-08-09T09:01:00.000Z",
    () => 0,
  );

  assert.equal(mastered.state.profile.totalXp, 22);
  assert.equal(mastered.state.profile.masteryCombo, 1);
  assert.deepEqual(mastered.state.hardIds, []);
  assert.deepEqual(mastered.state.reviewQueue, []);
  assert.deepEqual(mastered.state.views.hard, { deck: [], index: 0 });
});

test("a first fuzzy rating joins review mode without a reappearance schedule", () => {
  const initial = createInitialState([1, 2, 3], () => 0);
  const questionId = getCurrentQuestionId(initial);

  const fuzzy = applyRating(
    initial,
    "fuzzy",
    [1, 2, 3],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;

  assert.deepEqual(fuzzy.hardIds, [questionId]);
  assert.deepEqual(fuzzy.views.hard.deck, [questionId]);
  assert.deepEqual(fuzzy.reviewQueue, []);
});

test("a hard rating never cuts back into the random stream", () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let state = createInitialState(ids, () => 0);
  const served = [];

  for (let index = 0; index < ids.length; index += 1) {
    served.push(getCurrentQuestionId(state));
    state = applyRating(
      state,
      "hard",
      ids,
      "2026-08-10T01:00:00.000Z",
      () => 0,
    ).state;
  }

  assert.deepEqual(served.slice().sort((left, right) => left - right), ids);
  assert.deepEqual(state.reviewQueue, []);
  assert.deepEqual(
    state.hardIds.slice().sort((left, right) => left - right),
    ids,
  );
});

test("loading a stored state drops legacy reappearance schedules", () => {
  const ids = [1, 2, 3];
  const initial = createInitialState(ids, () => 0);
  const stored = {
    ...initial,
    hardIds: [2],
    views: {
      ...initial.views,
      hard: { deck: [2], index: 0 },
    },
    reviewQueue: [{ questionId: 2, dueAfterRatingCount: 8 }],
  };
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(stored),
  });

  const loaded = loadStoredState(storage, ids, () => 0);

  assert.deepEqual(loaded.state.reviewQueue, []);
  assert.deepEqual(loaded.state.hardIds, [2]);
  assert.equal(loaded.migrated, false);
});

test("every repeated rating earns XP", () => {
  let state = createInitialState([1], () => 0);
  state = applyRating(
    state,
    "mastered",
    [1],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  state = applyRating(
    state,
    "mastered",
    [1],
    "2026-08-09T09:01:00.000Z",
    () => 0,
  ).state;

  assert.equal(state.profile.totalXp, 40);
  assert.equal(state.ratingCount, 2);
  assert.equal(state.questionStats["1"].attempts, 2);
  assert.equal(state.questionStats["1"].masteredCount, 2);
});

test("round stats accumulate while non-mastered ratings reset the combo", () => {
  const ids = [1, 2, 3];
  let state = createInitialState(ids, () => 0);
  state = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  assert.equal(state.profile.masteryCombo, 1);
  assert.equal(state.round.xpEarned, 20);
  assert.equal(state.round.ratings.mastered, 1);

  state = applyRating(
    state,
    "fuzzy",
    ids,
    "2026-08-09T09:01:00.000Z",
    () => 0,
  ).state;
  assert.equal(state.profile.masteryCombo, 0);
  assert.equal(state.round.xpEarned, 28);
  assert.deepEqual(state.round.ratings, {
    hard: 0,
    fuzzy: 1,
    mastered: 1,
  });
});

test("a hard question stays out of the stream after later ratings", () => {
  const ids = Array.from({ length: 10 }, (_, index) => index + 1);
  let state = createInitialState(ids, () => 0);
  const hardQuestionId = getCurrentQuestionId(state);

  state = applyRating(
    state,
    "hard",
    ids,
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  for (let index = 0; index < 7; index += 1) {
    state = applyRating(
      state,
      "mastered",
      ids,
      `2026-08-09T09:0${index + 1}:00.000Z`,
      () => 0,
    ).state;
  }

  assert.equal(state.ratingCount, 8);
  assert.notEqual(getCurrentQuestionId(state), hardQuestionId);
  assert.equal(
    state.views.all.history.filter((id) => id === hardQuestionId).length,
    1,
  );
  assert.deepEqual(state.hardIds, [hardQuestionId]);
});

test("deriveLevel uses fixed 100 XP levels", () => {
  assert.equal(XP_PER_LEVEL, 100);
  assert.deepEqual(deriveLevel(0), {
    level: 1,
    currentXp: 0,
    requiredXp: 100,
  });
  assert.deepEqual(deriveLevel(250), {
    level: 3,
    currentXp: 50,
    requiredXp: 100,
  });
  assert.throws(() => deriveLevel(-1), TypeError);
});

test("twenty distinct local-day ratings qualify once and duplicates do not", () => {
  const ids = Array.from({ length: 25 }, (_, index) => index + 1);
  let state = createInitialState(ids, () => 0);
  for (let index = 0; index < 19; index += 1) {
    state = {
      ...state,
      views: {
        ...state.views,
        all: {
          ...state.views.all,
          currentQuestionId: ids[index],
          history: [ids[index]],
          historyIndex: 0,
        },
      },
    };
    state = applyRating(
      state,
      "mastered",
      ids,
      `2026-08-10T12:${String(index).padStart(2, "0")}:00.000Z`,
      () => 0,
    ).state;
  }
  assert.equal(state.profile.studyStreakDays, 0);
  assert.equal(deriveDailyCheckIn(state, new Date(2026, 7, 10, 12)).uniqueCount, 19);

  state = {
    ...state,
    views: {
      ...state.views,
      all: {
        ...state.views.all,
        currentQuestionId: ids[19],
        history: [ids[19]],
        historyIndex: 0,
      },
    },
  };
  const twentieth = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-10T12:19:00.000Z",
    () => 0,
  );
  state = twentieth.state;
  assert.equal(twentieth.outcome.checkInCompleted, true);
  assert.equal(state.profile.studyStreakDays, 1);
  assert.equal(state.profile.longestStudyStreakDays, 1);
  assert.equal(state.activityDays[0].ratedQuestionIds.length, 20);
  assert.equal(state.activityDays[0].localDay, "2026-08-10");

  state = {
    ...state,
    views: {
      ...state.views,
      all: {
        ...state.views.all,
        currentQuestionId: ids[0],
        history: [ids[0]],
        historyIndex: 0,
      },
    },
  };
  state = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-10T12:20:00.000Z",
    () => 0,
  ).state;
  assert.equal(state.profile.studyStreakDays, 1);
  assert.equal(state.activityDays[0].ratedQuestionIds.length, 20);
  assert.equal(state.activityDays[0].ratingCount, 21);

  const xpBeforeRollback = state.profile.totalXp;
  const lastPracticeAt = state.profile.lastPracticeAt;
  state = {
    ...state,
    views: {
      ...state.views,
      all: {
        ...state.views.all,
        currentQuestionId: ids[21],
        history: [ids[21]],
        historyIndex: 0,
      },
    },
  };
  state = applyRating(
    state,
    "hard",
    ids,
    "2026-08-09T12:00:00.000Z",
    () => 0,
  ).state;
  assert.equal(state.profile.totalXp, xpBeforeRollback + 2);
  assert.equal(state.profile.studyStreakDays, 1);
  assert.equal(state.profile.longestStudyStreakDays, 1);
  assert.equal(state.profile.lastPracticeAt, lastPracticeAt);
});

test("activity history caps at 400 UTC day buckets", () => {
  let state = createInitialState([1], () => 0);
  for (let day = 0; day < MAX_ACTIVITY_DAYS + 1; day += 1) {
    state = applyRating(
      state,
      "mastered",
      [1],
      new Date(Date.UTC(2025, 0, day + 1, 12)).toISOString(),
      () => 0,
    ).state;
  }

  assert.equal(state.activityDays.length, MAX_ACTIVITY_DAYS);
  assert.equal(
    state.activityDays.every(
      (entry) => (
        new Date(entry.dayStartedAt).toISOString() === entry.dayStartedAt
      ),
    ),
    true,
  );
  assert.equal(
    state.activityDays.at(-1).ratingCount,
    1,
  );
});

test("seven consecutive qualified local days update current and longest streaks", () => {
  const ids = Array.from({ length: 20 }, (_, index) => index + 1);
  let state = createInitialState(ids, () => 0);
  for (let day = 1; day <= 7; day += 1) {
    for (let rating = 0; rating < 20; rating += 1) {
      state = {
        ...state,
        views: {
          ...state.views,
          all: {
            ...state.views.all,
            currentQuestionId: ids[rating],
            history: [ids[rating]],
            historyIndex: 0,
          },
        },
      };
      state = applyRating(
        state,
        "mastered",
        ids,
        new Date(2026, 7, day, 12, rating).toISOString(),
        () => 0,
      ).state;
    }
  }

  assert.equal(state.profile.studyStreakDays, 7);
  assert.equal(state.profile.longestStudyStreakDays, 7);
  assert.equal(
    deriveAchievements(state).some(
      (achievement) => achievement.id === "seven_days",
    ),
    true,
  );
});

test("all and hard modes keep separate navigation views", () => {
  const ids = [1, 2, 3];
  let state = createInitialState(ids, () => 0);
  state = applyRating(
    state,
    "hard",
    ids,
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  state = applyRating(
    state,
    "hard",
    ids,
    "2026-08-09T09:01:00.000Z",
    () => 0,
  ).state;
  const allView = clone(state.views.all);
  state = { ...state, mode: "hard" };
  const firstHardId = getCurrentQuestionId(state);
  const rated = applyRating(
    state,
    "fuzzy",
    ids,
    "2026-08-09T09:02:00.000Z",
    () => 0,
  ).state;

  assert.deepEqual(rated.views.all, allView);
  assert.notEqual(getCurrentQuestionId(rated), firstHardId);
  assert.equal(rated.views.hard.index, 1);
});

test("all-view forward history is reused before consuming the base deck", () => {
  const ids = [1, 2, 3];
  let state = createInitialState(ids, () => 0);
  state = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  state = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-09T09:01:00.000Z",
    () => 0,
  ).state;
  const history = state.views.all.history.slice();
  const deckIndex = state.deckIndex;
  state = {
    ...state,
    views: {
      ...state.views,
      all: {
        ...state.views.all,
        currentQuestionId: history[0],
        historyIndex: 0,
      },
    },
  };

  const rated = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-09T09:02:00.000Z",
    () => 0,
  ).state;

  assert.deepEqual(rated.views.all.history, history);
  assert.equal(rated.views.all.historyIndex, 1);
  assert.equal(rated.deckIndex, deckIndex);
});

test("all-view history is capped at 200 actual visits", () => {
  let state = createInitialState([1], () => 0);
  for (let index = 0; index < MAX_HISTORY_LENGTH + 5; index += 1) {
    state = applyRating(
      state,
      "mastered",
      [1],
      new Date(Date.UTC(2026, 7, 9, 9, index)).toISOString(),
      () => 0,
    ).state;
  }

  assert.equal(state.views.all.history.length, MAX_HISTORY_LENGTH);
  assert.equal(state.views.all.historyIndex, MAX_HISTORY_LENGTH - 1);
  assert.equal(new Set(state.deck).size, 1);
});

test("rolling past a unique deck starts a new round and preserves reviews", () => {
  const ids = [1, 2, 3];
  let state = createInitialState(ids, () => 0);
  const hardId = getCurrentQuestionId(state);
  state = applyRating(
    state,
    "hard",
    ids,
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  state = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-09T09:01:00.000Z",
    () => 0,
  ).state;
  const completed = applyRating(
    state,
    "mastered",
    ids,
    "2026-08-09T09:02:00.000Z",
    () => 0,
  );

  assert.equal(completed.outcome.roundCompleted, true);
  assert.equal(completed.state.round.number, 2);
  assert.deepEqual(completed.state.round.ratings, {
    hard: 0,
    fuzzy: 0,
    mastered: 0,
  });
  assert.deepEqual(completed.state.reviewQueue, []);
  assert.deepEqual(completed.state.hardIds, [hardId]);
  assert.equal(completed.state.deck.length, ids.length);
  assert.equal(new Set(completed.state.deck).size, ids.length);
  assert.equal(completed.state.deckIndex, 1);
});

test("achievements are derived from source progress only in fixed order", () => {
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
    deriveAchievements(state).map(
      ({ id, title, unlocked }) => ({ id, title, unlocked }),
    ),
    [
      { id: "first_rating", title: "初次出发", unlocked: true },
      { id: "hundred_ratings", title: "百题热身", unlocked: true },
      { id: "full_round", title: "完整一轮", unlocked: true },
      { id: "seven_days", title: "坚持一周", unlocked: true },
      { id: "fifty_mastered", title: "渐入佳境", unlocked: true },
    ],
  );
  assert.equal(Object.hasOwn(state, "achievements"), false);
});

test("valid v1 state migrates without losing current question or hard IDs", () => {
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
  assert.deepEqual(migrated.deck, legacy.deck);
  assert.equal(migrated.deckIndex, 2);
  assert.deepEqual(migrated.views.all.history, [1]);
  assert.deepEqual(migrated.round.seenIds, [3, 1]);
  assert.deepEqual(migrated.hardIds, [2]);
  assert.deepEqual(migrated.views.hard.deck, [2]);
  assert.equal(migrated.profile.totalXp, 0);
});

test("normalizeState resets malformed stored state", async (context) => {
  const ids = [1, 2, 3];
  const valid = createInitialState(ids, () => 0);
  const rated = applyRating(
    valid,
    "hard",
    ids,
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  const malformedStates = {
    "wrong version": { ...clone(valid), version: STATE_VERSION + 1 },
    "invalid deck ID": { ...clone(valid), deck: [1, 2, 99] },
    "duplicate deck ID": { ...clone(valid), deck: [1, 1, 3] },
    "invalid mode": { ...clone(valid), mode: "unknown" },
    "out-of-range deck index": { ...clone(valid), deckIndex: ids.length + 1 },
    "duplicate hard ID": {
      ...clone(valid),
      hardIds: [2, 2],
      views: {
        ...clone(valid.views),
        hard: { deck: [2, 2], index: 0 },
      },
    },
    "invalid current history ID": {
      ...clone(valid),
      views: {
        ...clone(valid.views),
        all: {
          currentQuestionId: 99,
          history: [99],
          historyIndex: 0,
        },
      },
    },
    "duplicate review schedule": {
      ...clone(valid),
      reviewQueue: [
        { questionId: 2, dueAfterRatingCount: 8 },
        { questionId: 2, dueAfterRatingCount: 9 },
      ],
    },
    "review schedule without review-mode membership": {
      ...clone(valid),
      reviewQueue: [{
        questionId: valid.deck[0],
        dueAfterRatingCount: 7,
      }],
    },
    "invalid question timestamp": {
      ...clone(valid),
      questionStats: {
        2: {
          attempts: 1,
          hardCount: 1,
          fuzzyCount: 0,
          masteredCount: 0,
          lastRating: "hard",
          lastReviewedAt: "not-a-time",
        },
      },
    },
    "round ratings exceed global ratings": {
      ...clone(valid),
      round: {
        ...clone(valid.round),
        xpEarned: 2,
        ratings: {
          hard: 1,
          fuzzy: 0,
          mastered: 0,
        },
      },
    },
    "round seen IDs do not match consumed deck": {
      ...clone(valid),
      round: {
        ...clone(valid.round),
        seenIds: [valid.deck[1]],
      },
    },
    "last rating has no matching count": {
      ...clone(rated),
      questionStats: {
        ...clone(rated.questionStats),
        [String(valid.views.all.currentQuestionId)]: {
          ...clone(
            rated.questionStats[String(valid.views.all.currentQuestionId)],
          ),
          lastRating: "mastered",
        },
      },
    },
    "mastery combo exceeds total ratings": {
      ...clone(valid),
      profile: {
        ...clone(valid.profile),
        masteryCombo: 1,
      },
    },
    "invalid legacy state": {
      version: 1,
      mode: "all",
      deck: [1, 1, 3],
      index: 0,
      hardIds: [],
    },
  };

  for (const [label, candidate] of Object.entries(malformedStates)) {
    await context.test(label, () => {
      const normalized = normalizeState(candidate, ids, () => 0);

      assert.equal(normalized.recovered, true);
      assert.equal(normalized.state.version, STATE_VERSION);
      assert.equal(normalized.state.mode, "all");
      assert.equal(normalized.state.deckIndex, 1);
      assert.equal(normalized.state.views.all.historyIndex, 0);
      assert.deepEqual(normalized.state.hardIds, []);
      assert.deepEqual(
        normalized.state.deck.slice().sort((left, right) => left - right),
        ids,
      );
    });
  }
});

test("applyRating does not mutate its input state", () => {
  const initial = createInitialState([1, 2, 3], () => 0);
  const snapshot = clone(initial);
  deepFreeze(initial);

  const rated = applyRating(
    initial,
    "hard",
    [1, 2, 3],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  );

  assert.deepEqual(initial, snapshot);
  assert.notEqual(rated.state, initial);
  assert.notEqual(rated.state.views, initial.views);
  assert.notEqual(rated.state.profile, initial.profile);
  assert.notEqual(rated.state.questionStats, initial.questionStats);
});

test("hard mode filters the stable round deck in deck order", () => {
  const initial = createInitialState([1, 2, 3, 4], () => 0);
  const state = {
    ...initial,
    mode: "hard",
    deck: [4, 2, 1, 3],
    hardIds: [1, 4],
    views: {
      ...initial.views,
      hard: {
        deck: [4, 1],
        index: 0,
      },
    },
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
  const base = createInitialState([1, 2, 3], () => 0);
  const initial = {
    ...base,
    mode: "hard",
    hardIds: [1, 2],
    views: {
      ...base.views,
      hard: {
        deck: [1, 2],
        index: 1,
      },
    },
  };

  const removed = toggleHardId(initial, 2);
  assert.deepEqual(removed.hardIds, [1]);
  assert.equal(removed.views.hard.index, 0);
  assert.deepEqual(initial.hardIds, [1, 2]);

  const added = toggleHardId(removed, 3);
  assert.deepEqual(added.hardIds, [1, 3]);
  assert.deepEqual(added.views.hard.deck, [1, 3]);
  assert.deepEqual(added.reviewQueue, []);
  assert.equal(new Set(added.hardIds).size, added.hardIds.length);
});

test("removing another hard ID preserves the hard-view current question", () => {
  const base = createInitialState([1, 2, 3], () => 0);
  const state = {
    ...base,
    hardIds: [1, 2, 3],
    views: {
      ...base.views,
      hard: {
        deck: [1, 2, 3],
        index: 1,
      },
    },
  };

  const removed = toggleHardId(state, 1);

  assert.deepEqual(removed.views.hard.deck, [2, 3]);
  assert.equal(removed.views.hard.index, 0);
  assert.equal(removed.views.hard.deck[removed.views.hard.index], 2);
});

test("removing the last hard question resets and hides review controls", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1], () => 0);
  const marked = toggleHardId(initial, 1);
  const storedState = {
    ...marked,
    mode: "hard",
  };
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(storedState),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: [makeQuestions()[0]],
    reducedMotion: true,
    storage,
  });

  startBrowserApp(documentObject, browserGlobal);
  const hardButton = documentObject.elements.get("hard-button");
  assert.equal(hardButton.textContent, "移出待复习");
  assert.equal(hardButton.getAttribute("aria-pressed"), "true");

  hardButton.click();

  assert.equal(documentObject.elements.get("empty-state").hidden, false);
  assert.equal(documentObject.elements.get("question-card").hidden, true);
  assert.equal(documentObject.elements.get("review-actions").hidden, true);
  assert.equal(hardButton.disabled, true);
  assert.equal(hardButton.textContent, "加入待复习");
  assert.equal(hardButton.getAttribute("aria-pressed"), "false");
});

test("browser shows question code before the answer is revealed", () => {
  const documentObject = makeFakeDocument();
  const question = {
    ...makeQuestions()[0],
    promptHtml: (
      '<pre><code class="language-go">'
      + "var _ Codec = (*GobCodec)(nil)"
      + "</code></pre>"
    ),
  };
  const initial = createInitialState([question.id], () => 0);
  const browserGlobal = makeBrowserGlobal({
    questions: [question],
    reducedMotion: true,
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
  });

  startBrowserApp(documentObject, browserGlobal);

  assert.equal(
    documentObject.elements.get("prompt-content").innerHTML,
    question.promptHtml,
  );
  assert.equal(documentObject.elements.get("answer-panel").hidden, true);
  assert.equal(
    documentObject.elements.get("answer-content").innerHTML,
    question.answerHtml,
  );
});

test("browser reveal exposes ratings and a rating awards XP after 300 ms", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({ storage });

  startBrowserApp(documentObject, browserGlobal);

  const answerPanel = documentObject.elements.get("answer-panel");
  const ratingPanel = documentObject.elements.get("rating-panel");
  assert.equal(answerPanel.hidden, true);
  assert.equal(ratingPanel.hidden, true);

  documentObject.elements.get("answer-button").click();
  assert.equal(answerPanel.hidden, false);
  assert.equal(ratingPanel.hidden, false);
  browserGlobal.runTimers();

  documentObject.elements.get("rate-hard").click();
  assert.equal(
    browserGlobal.timers.some((timer) => timer.delay === 300),
    true,
  );
  assert.equal(storage.writes.length, 1);
  assert.equal(
    JSON.parse(storage.writes[0][1]).profile.totalXp,
    2,
  );
  assert.equal(documentObject.elements.get("answer-button").disabled, true);
  assert.equal(documentObject.elements.get("next-button").disabled, true);

  browserGlobal.runTimers();
  const persisted = JSON.parse(storage.writes.at(-1)[1]);
  assert.equal(storage.writes.length, 1);
  assert.equal(persisted.profile.totalXp, 2);
  assert.equal(persisted.ratingCount, 1);
  assert.equal(answerPanel.hidden, true);
  assert.equal(ratingPanel.hidden, true);
  assert.equal(documentObject.elements.get("question-text").focusCount, 1);
  assert.match(
    documentObject.elements.get("live-region").textContent,
    /没关系，继续努力/,
  );
  assert.match(
    documentObject.elements.get("live-region").textContent,
    /获得 2 XP/,
  );
});

test("rating feedback is visible and a completed round gets a summary", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: [makeQuestions()[0]],
    storage,
  });

  startBrowserApp(documentObject, browserGlobal);
  documentObject.elements.get("answer-button").click();
  browserGlobal.runTimers();
  documentObject.elements.get("rate-hard").click();

  const feedback = documentObject.elements.get("rating-feedback");
  assert.equal(feedback.hidden, false);
  assert.equal(
    documentObject.elements.get("rating-feedback-primary").textContent,
    RATING_PRIMARY_FEEDBACK.hard,
  );
  assert.match(
    documentObject.elements.get("rating-feedback-secondary").textContent,
    /\+2 XP/,
  );

  browserGlobal.runTimers();
  const summary = documentObject.elements.get("round-summary");
  assert.equal(summary.hidden, false);
  assert.match(summary.textContent, /本轮完成/);
  assert.match(summary.textContent, /不会 1/);
  assert.match(summary.textContent, /2 XP/);
});

test("reduced motion advances immediately and renders sprint profile", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({
    reducedMotion: true,
    storage,
  });

  startBrowserApp(documentObject, browserGlobal);
  documentObject.elements.get("progress-button").click();
  assert.equal(documentObject.elements.get("progress-dialog").open, true);
  documentObject.elements.get("progress-dialog").close();
  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-mastered").click();

  const persisted = JSON.parse(storage.writes.at(-1)[1]);
  assert.equal(persisted.profile.totalXp, 20);
  assert.match(
    documentObject.elements.get("level-text").textContent,
    /1/,
  );
  assert.match(
    documentObject.elements.get("xp-text").textContent,
    /20\s*\/\s*100/,
  );
  assert.equal(
    documentObject.elements.get("xp-fill").style.width,
    "20%",
  );
  assert.match(
    documentObject.elements.get("mastery-combo").textContent,
    /1/,
  );
  assert.match(
    documentObject.elements.get("achievements-list").textContent,
    /初次出发/,
  );
  assert.equal(documentObject.elements.get("study-streak").textContent, "0");
  assert.equal(documentObject.elements.get("daily-count").textContent, "1");
});

test("keyboard shortcuts rate only revealed answers and ignore controls", async () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({
    reducedMotion: true,
    storage,
  });
  startBrowserApp(documentObject, browserGlobal);

  const hiddenRating = await documentObject.dispatch("keydown", { key: "1" });
  assert.equal(hiddenRating.defaultPrevented, false);
  assert.equal(storage.writes.length, 0);

  const reveal = await documentObject.dispatch("keydown", { key: " " });
  assert.equal(reveal.defaultPrevented, true);
  assert.equal(documentObject.elements.get("answer-panel").hidden, false);

  const nestedControl = new FakeElement("nested");
  nestedControl.parentElement = documentObject.elements.get("answer-button");
  const ignored = await documentObject.dispatch("keydown", {
    key: "1",
    target: nestedControl,
  });
  assert.equal(ignored.defaultPrevented, false);
  assert.equal(storage.writes.length, 0);

  const marked = await documentObject.dispatch("keydown", { key: "j" });
  assert.equal(marked.defaultPrevented, true);
  assert.equal(JSON.parse(storage.writes.at(-1)[1]).hardIds.length, 1);
  assert.equal(documentObject.elements.get("hard-count").textContent, "1");

  const modified = await documentObject.dispatch("keydown", {
    ctrlKey: true,
    key: "j",
  });
  assert.equal(modified.defaultPrevented, false);
  assert.equal(storage.writes.length, 1);

  const rated = await documentObject.dispatch("keydown", { key: "2" });
  assert.equal(rated.defaultPrevented, true);
  assert.equal(JSON.parse(storage.writes.at(-1)[1]).profile.totalXp, 8);
});

test("supplemented source badge follows the current question", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({ storage });
  startBrowserApp(documentObject, browserGlobal);

  const badge = documentObject.elements.get("source-badge");
  assert.equal(badge.hidden, true);
  documentObject.elements.get("next-button").click();
  assert.equal(badge.hidden, false);
  assert.equal(
    documentObject.elements.get("question-number").textContent,
    "第 3 题",
  );
});

test("install prompt is deferred to a click and iOS help is contextual", async () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({
    hostname: "example.test",
    protocol: "https:",
    storage,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  });
  startBrowserApp(documentObject, browserGlobal);

  const installButton = documentObject.elements.get("install-button");
  const installHelp = documentObject.elements.get("install-help");
  assert.equal(installButton.hidden, false);
  assert.equal(installHelp.hidden, false);
  await installButton.dispatch("click");
  assert.equal(installHelp.open, true);
  installHelp.close();

  let prevented = false;
  let promptCalls = 0;
  await browserGlobal.dispatch("beforeinstallprompt", {
    preventDefault() {
      prevented = true;
    },
    prompt() {
      promptCalls += 1;
    },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });
  assert.equal(prevented, true);
  assert.equal(promptCalls, 0);
  assert.equal(installButton.hidden, false);

  await installButton.dispatch("click");
  assert.equal(promptCalls, 1);
  assert.equal(installButton.hidden, true);

  const fileDocument = makeFakeDocument();
  const fileBrowser = makeBrowserGlobal({
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  });
  startBrowserApp(fileDocument, fileBrowser);
  assert.equal(
    fileDocument.elements.get("install-button").hidden,
    true,
  );
});

test("service worker registers only in secure contexts and surfaces updates", async () => {
  const initial = createInitialState([1, 2, 3], () => 0);

  const fileDocument = makeFakeDocument();
  const fileBrowser = makeBrowserGlobal({
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
  });
  let fileRegistrations = 0;
  fileBrowser.navigator.serviceWorker = {
    register() {
      fileRegistrations += 1;
    },
  };
  startBrowserApp(fileDocument, fileBrowser);
  await Promise.resolve();
  assert.equal(fileRegistrations, 0);

  const secureDocument = makeFakeDocument();
  const secureBrowser = makeBrowserGlobal({
    hostname: "example.test",
    protocol: "https:",
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
  });
  let registeredPath = "";
  let controllerChange = null;
  let reloads = 0;
  let skipWaitingMessages = 0;
  const waitingWorker = {
    postMessage(message) {
      if (message.type === "SKIP_WAITING") {
        skipWaitingMessages += 1;
      }
    },
  };
  secureBrowser.location.reload = () => {
    reloads += 1;
  };
  secureBrowser.navigator.serviceWorker = {
    addEventListener(type, listener) {
      if (type === "controllerchange") {
        controllerChange = listener;
      }
    },
    controller: {},
    async register(pathname) {
      registeredPath = pathname;
      return {
        addEventListener() {},
        waiting: waitingWorker,
      };
    },
  };

  startBrowserApp(secureDocument, secureBrowser);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(registeredPath, "./service-worker.js?v=v11");
  assert.equal(
    secureDocument.elements.get("update-notice").hidden,
    false,
  );

  secureDocument.elements.get("answer-button").click();
  secureDocument.elements.get("update-action").click();
  assert.equal(skipWaitingMessages, 1);
  assert.equal(reloads, 0);
  controllerChange();
  assert.equal(reloads, 1);
});

test("the page shell shows which build is running", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const worker = fs.readFileSync(
    path.join(ROOT, "service-worker.js"),
    "utf8",
  );
  const cacheName = worker.match(/const CACHE_NAME = "go-interview-(v\d+)"/);
  const tag = html.match(/<span\b[^>]*id="build-tag"[^>]*>([^<]+)<\/span>/);

  assert.ok(cacheName);
  assert.ok(tag);
  assert.equal(tag[1].trim(), cacheName[1]);
});

test("startup asks the browser to look for a newer worker", async () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  let updateChecks = 0;
  const documentListeners = new Map();
  documentObject.addEventListener = (name, handler) => {
    documentListeners.set(name, handler);
  };
  const browserGlobal = makeBrowserGlobal({ reducedMotion: true, storage });
  browserGlobal.location = { hostname: "example.test", protocol: "https:" };
  browserGlobal.navigator.serviceWorker = {
    addEventListener() {},
    controller: {},
    register() {
      return {
        addEventListener() {},
        waiting: null,
        update() {
          updateChecks += 1;
        },
      };
    },
  };

  startBrowserApp(documentObject, browserGlobal);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(updateChecks, 1);

  documentObject.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(updateChecks, 2);
});

test("a refused update explains itself in the visible notice", async () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  let skipWaitingMessages = 0;
  const browserGlobal = makeBrowserGlobal({ reducedMotion: true, storage });
  browserGlobal.location = { hostname: "example.test", protocol: "https:" };
  browserGlobal.navigator.serviceWorker = {
    addEventListener() {},
    controller: {},
    register() {
      return {
        addEventListener() {},
        waiting: null,
      };
    },
  };

  startBrowserApp(documentObject, browserGlobal);
  await Promise.resolve();
  await Promise.resolve();

  const message = documentObject.elements.get("update-message");
  const defaultMessage = message.textContent;
  documentObject.elements.get("update-action").click();

  assert.equal(skipWaitingMessages, 0);
  assert.notEqual(message.textContent, defaultMessage);
  assert.match(message.textContent, /准备中/);
  assert.equal(documentObject.elements.get("update-notice").hidden, false);
});

test("service-worker eligibility is HTTPS or localhost HTTP only", () => {
  const supported = { serviceWorker: {} };

  assert.equal(
    canRegisterServiceWorker(
      { hostname: "example.test", protocol: "https:" },
      supported,
    ),
    true,
  );
  assert.equal(
    canRegisterServiceWorker(
      { hostname: "localhost", protocol: "http:" },
      supported,
    ),
    true,
  );
  assert.equal(
    canRegisterServiceWorker(
      { hostname: "example.test", protocol: "http:" },
      supported,
    ),
    false,
  );
  assert.equal(
    canRegisterServiceWorker(
      { hostname: "", protocol: "file:" },
      supported,
    ),
    false,
  );
  assert.equal(
    canRegisterServiceWorker(
      { hostname: "example.test", protocol: "https:" },
      {},
    ),
    false,
  );
});

test("a synchronous service-worker registration failure is nonblocking", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const browserGlobal = makeBrowserGlobal({
    hostname: "localhost",
    protocol: "http:",
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
  });
  browserGlobal.navigator.serviceWorker = {
    register() {
      throw new Error("registration blocked");
    },
  };

  assert.doesNotThrow(() => startBrowserApp(documentObject, browserGlobal));
  assert.equal(documentObject.elements.get("question-card").hidden, false);
  assert.match(
    documentObject.elements.get("question-text").textContent,
    /问题/,
  );
});

test("update activation stops when in-memory progress cannot be saved", async () => {
  const documentObject = makeFakeDocument();
  const browserGlobal = makeBrowserGlobal({
    hostname: "example.test",
    protocol: "https:",
    storage: {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("storage blocked");
      },
    },
  });
  let skipWaitingMessages = 0;
  browserGlobal.navigator.serviceWorker = {
    addEventListener() {},
    controller: {},
    async register() {
      return {
        addEventListener() {},
        waiting: {
          postMessage() {
            skipWaitingMessages += 1;
          },
        },
      };
    },
  };

  startBrowserApp(documentObject, browserGlobal);
  await Promise.resolve();
  await Promise.resolve();
  documentObject.elements.get("update-action").click();

  assert.equal(skipWaitingMessages, 0);
  assert.match(
    documentObject.elements.get("storage-warning").textContent,
    /无法保存/,
  );
});

test("browser export prefers file sharing and falls back to a download", async () => {
  const initial = createInitialState([1, 2, 3], () => 0);

  const shareDocument = makeFakeDocument();
  const shareBrowser = makeBrowserGlobal({
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
  });
  let shared = null;
  shareBrowser.navigator.canShare = ({ files }) => files.length === 1;
  shareBrowser.navigator.share = async (payload) => {
    shared = payload;
  };
  startBrowserApp(shareDocument, shareBrowser);

  await shareDocument.elements.get("export-button").dispatch("click");
  assert.equal(shared.files.length, 1);
  assert.match(shared.files[0].name, /^go-interview-progress-.*\.json$/);

  const downloadDocument = makeFakeDocument();
  let anchor = null;
  const originalCreateElement = downloadDocument.createElement;
  downloadDocument.createElement = (tagName) => {
    const element = originalCreateElement(tagName);
    if (tagName === "a") {
      anchor = element;
    }
    return element;
  };
  const downloadBrowser = makeBrowserGlobal({
    storage: makeStorage({
      [STORAGE_KEY]: JSON.stringify(initial),
    }),
  });
  startBrowserApp(downloadDocument, downloadBrowser);
  await downloadDocument.elements.get("export-button").dispatch("click");

  assert.equal(anchor.clickCount, 1);
  assert.match(anchor.download, /^go-interview-progress-.*\.json$/);
  assert.equal(anchor.href, "blob:progress");
});

test("browser import confirms valid replacement and rejects invalid input", async () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const imported = applyRating(
    initial,
    "mastered",
    [1, 2, 3],
    "2026-08-09T09:00:00.000Z",
    () => 0,
  ).state;
  const serialized = JSON.stringify(
    createExportPayload(imported, "2026-08-09T09:01:00.000Z"),
  );
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({ storage });
  let confirmations = 0;
  browserGlobal.confirm = () => {
    confirmations += 1;
    return true;
  };
  startBrowserApp(documentObject, browserGlobal);

  const importInput = documentObject.elements.get("import-input");
  importInput.files = [{
    size: Buffer.byteLength(serialized),
    async text() {
      return serialized;
    },
  }];
  await importInput.dispatch("change");

  assert.equal(confirmations, 1);
  assert.equal(JSON.parse(storage.writes.at(-1)[1]).profile.totalXp, 20);
  assert.match(
    documentObject.elements.get("xp-text").textContent,
    /20\s*\/\s*100/,
  );

  const writesBeforeInvalid = storage.writes.length;
  importInput.files = [{
    size: 7,
    async text() {
      return "{broken";
    },
  }];
  await importInput.dispatch("change");
  assert.equal(confirmations, 1);
  assert.equal(storage.writes.length, writesBeforeInvalid);
  assert.equal(
    documentObject.elements.get("storage-warning").hidden,
    false,
  );
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

test("v3 storage wins and older keys migrate only when v3 is absent", () => {
  const ids = [1, 2, 3];
  const v3 = createInitialState(ids, () => 0);
  const legacy = {
    version: 1,
    mode: "all",
    deck: [1, 3, 2],
    index: 1,
    hardIds: [2],
  };
  const both = makeStorage({
    [STORAGE_KEY]: JSON.stringify(v3),
    [PREVIOUS_STORAGE_KEY]: JSON.stringify({ ...v3, version: 2 }),
    [LEGACY_STORAGE_KEY]: JSON.stringify(legacy),
  });

  const preferred = loadStoredState(both, ids, () => 0);
  assert.equal(preferred.migrated, false);
  assert.equal(getCurrentQuestionId(preferred.state), 2);

  const legacyOnly = makeStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify(legacy),
  });
  const migrated = loadStoredState(legacyOnly, ids, () => 0);
  assert.equal(migrated.migrated, true);
  assert.equal(getCurrentQuestionId(migrated.state), 3);
  assert.deepEqual(migrated.state.hardIds, [2]);
  assert.equal(legacyOnly.writes.length, 1);
  assert.equal(legacyOnly.writes[0][0], STORAGE_KEY);
  assert.deepEqual(
    JSON.parse(legacyOnly.writes[0][1]),
    migrated.state,
  );

  const invalidV3 = makeStorage({
    [STORAGE_KEY]: "{broken",
    [PREVIOUS_STORAGE_KEY]: JSON.stringify({ ...v3, version: 2 }),
    [LEGACY_STORAGE_KEY]: JSON.stringify(legacy),
  });
  const recovered = loadStoredState(invalidV3, ids, () => 0);
  assert.equal(recovered.migrated, false);
  assert.equal(getCurrentQuestionId(recovered.state), 2);
  assert.deepEqual(recovered.state.hardIds, []);
});

test("saving uses the v3 key and never persists derived achievements", () => {
  const storage = makeStorage();
  const state = {
    ...createInitialState([1], () => 0),
    achievements: [{ id: "should-not-persist" }],
  };

  const saved = saveStoredState(storage, state);

  assert.equal(saved.ok, true);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], STORAGE_KEY);
  const persisted = JSON.parse(storage.writes[0][1]);
  assert.equal(persisted.version, STATE_VERSION);
  assert.equal(Object.hasOwn(persisted, "achievements"), false);
});

test("export payloads are timestamped v3 snapshots without derived fields", () => {
  const state = {
    ...createInitialState([1, 2, 3], () => 0),
    achievements: [{ id: "derived" }],
  };

  const payload = createProgressExport(
    state,
    "2026-08-09T09:00:00.000Z",
  );

  assert.deepEqual(Object.keys(payload), [
    "schemaVersion",
    "exportedAt",
    "data",
  ]);
  assert.equal(payload.schemaVersion, 3);
  assert.equal(payload.exportedAt, "2026-08-09T09:00:00.000Z");
  assert.notEqual(payload.data, state);
  assert.equal(Object.hasOwn(payload.data, "achievements"), false);
});

test("strict import accepts valid v3 exports at or below 1 MB", () => {
  const ids = [1, 2, 3];
  const state = createInitialState(ids, () => 0);
  const serialized = JSON.stringify(
    createProgressExport(state, "2026-08-09T09:00:00.000Z"),
  );

  const imported = parseProgressImport(serialized, ids, () => 0);

  assert.deepEqual(imported.state, state);
  assert.equal(imported.migratedFromV2, false);
  assert.notEqual(imported.state, state);
  assert.equal(MAX_IMPORT_BYTES, 1_000_000);
});

test("invalid import is rejected without mutating current progress", async (context) => {
  const ids = [1, 2, 3];
  const current = createInitialState(ids, () => 0);
  const snapshot = clone(current);
  deepFreeze(current);
  const invalidPayloads = {
    "oversized input": "x".repeat(MAX_IMPORT_BYTES + 1),
    "malformed JSON": "{broken",
    "wrong envelope version": JSON.stringify({
      schemaVersion: 1,
      exportedAt: "2026-08-09T09:00:00.000Z",
      data: current,
    }),
    "invalid export timestamp": JSON.stringify({
      schemaVersion: 3,
      exportedAt: "yesterday",
      data: current,
    }),
    "invalid state": JSON.stringify({
      schemaVersion: 3,
      exportedAt: "2026-08-09T09:00:00.000Z",
      data: { ...current, deck: [1, 1, 3] },
    }),
  };

  for (const [label, serialized] of Object.entries(invalidPayloads)) {
    await context.test(label, () => {
      assert.throws(
        () => parseProgressImport(serialized, ids, () => 0),
        TypeError,
      );
      assert.deepEqual(current, snapshot);
    });
  }
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
    "empty prompt markup": [
      { ...valid[0], promptHtml: "<p><br></p>" },
    ],
    "unsafe prompt tag": [
      { ...valid[0], promptHtml: "<script>alert(1)</script>" },
    ],
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

test("document includes an actionable service-worker update control", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const updateNotice = html.match(
    /<div\b[^>]*id="update-notice"[\s\S]*?<\/div>/,
  );

  assert.notEqual(updateNotice, null);
  assert.match(updateNotice[0], /data-update-action/);
  assert.match(updateNotice[0], /更新/);
});

test("profile markup keeps units and exposes level progress semantics", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  assert.match(
    html,
    /<strong>\s*<span id="study-streak">0<\/span>\s*天\s*<\/strong>/,
  );
  assert.match(
    html,
    /id="daily-progress"[^>]*role="progressbar"[^>]*aria-valuemax="20"/,
  );
  assert.match(html, /id="study-records-button"/);
  assert.doesNotMatch(html, /分类即将上线/);
  assert.match(
    html,
    /class="xp-track"[^>]*role="progressbar"[^>]*aria-label="等级经验"/,
  );
  assert.doesNotMatch(
    html,
    /class="xp-track"[^>]*aria-hidden="true"/,
  );
});

test("achievement items render into a semantic list", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  assert.match(html, /<ul\b[^>]*id="achievements-list"/);
  assert.doesNotMatch(html, /<div\b[^>]*id="achievements-list"/);
});

test("mascot mood follows local time until check-in completes", () => {
  const unfinished = { completed: false };
  assert.equal(
    deriveMascotMood(unfinished, new Date(2026, 7, 10, 14, 59, 59)),
    "normal",
  );
  assert.equal(
    deriveMascotMood(unfinished, new Date(2026, 7, 10, 15, 0, 0)),
    "anxious",
  );
  assert.equal(
    deriveMascotMood(unfinished, new Date(2026, 7, 10, 20, 59, 59)),
    "anxious",
  );
  assert.equal(
    deriveMascotMood(unfinished, new Date(2026, 7, 10, 21, 0, 0)),
    "frantic",
  );
  assert.equal(
    deriveMascotMood({ completed: true }, new Date(2026, 7, 10, 22, 0, 0)),
    "normal",
  );
  assert.equal(MASCOT_MOOD_LABELS.frantic, "抓狂");
  assert.equal(CHECKIN_SUCCESS_LABEL, "今日打卡成功");
});

test("rating announcement keeps encouragement primary", () => {
  assert.equal(
    buildRatingAnnouncement(
      "mastered",
      { xpEarned: 20, leveledUp: false },
      { completed: true, displayCount: 20, goal: 20 },
    ),
    "已掌握，干得漂亮。获得 20 XP。今日打卡成功，20 / 20。",
  );
  assert.equal(RATING_PRIMARY_FEEDBACK.fuzzy, "加油，已经很棒了");
  assert.equal(RATING_SECONDARY_FEEDBACK.hard, "+2 XP · 已加入待复习");
  assert.equal(RATING_SECONDARY_FEEDBACK.fuzzy, "+8 XP · 已加入待复习");
});

test("rating buttons never promise a reappearance schedule", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const controls = html.match(
    /<div class="rating-controls">[\s\S]*?<\/div>/,
  );

  assert.ok(controls);
  assert.doesNotMatch(controls[0], /题后再练/);
  assert.match(controls[0], /\+2 XP · 加入待复习/);
  assert.match(controls[0], /\+8 XP · 加入待复习/);
  assert.match(controls[0], /\+20 XP · 移出待复习/);
});

test("notebook derives hard and fuzzy items and drops mastered", () => {
  const state = createInitialState([1, 2, 3], () => 0);
  state.questionStats = {
    1: {
      attempts: 1,
      hardCount: 1,
      fuzzyCount: 0,
      masteredCount: 0,
      lastRating: "hard",
      lastReviewedAt: "2026-08-10T12:00:00.000Z",
    },
    2: {
      attempts: 1,
      hardCount: 0,
      fuzzyCount: 1,
      masteredCount: 0,
      lastRating: "fuzzy",
      lastReviewedAt: "2026-08-10T13:00:00.000Z",
    },
    3: {
      attempts: 1,
      hardCount: 0,
      fuzzyCount: 0,
      masteredCount: 1,
      lastRating: "mastered",
      lastReviewedAt: "2026-08-10T14:00:00.000Z",
    },
  };
  const questionsById = new Map(makeQuestions().map((item) => [item.id, item]));
  const items = deriveNotebookItems(state, questionsById);
  assert.deepEqual(
    items.map((item) => item.questionId),
    [2, 1],
  );
});

test("calendar marks checked partial missed future and today", () => {
  const state = createInitialState([1], () => 0);
  state.activityDays = [
    {
      localDay: "2026-08-01",
      dayStartedAt: new Date(2026, 7, 1).toISOString(),
      ratingCount: 20,
      ratedQuestionIds: Array.from({ length: 20 }, (_, index) => index + 1),
    },
    {
      localDay: "2026-08-09",
      dayStartedAt: new Date(2026, 7, 9).toISOString(),
      ratingCount: 3,
      ratedQuestionIds: [1, 2, 3],
    },
  ];
  const month = deriveCalendarMonth(
    state,
    { year: 2026, monthIndex: 7 },
    new Date(2026, 7, 10, 12),
  );
  const byDay = new Map(
    month.cells.filter((cell) => cell.kind === "day").map((cell) => [cell.day, cell]),
  );
  assert.equal(byDay.get(1).status, "checked");
  assert.equal(byDay.get(9).status, "partial");
  assert.equal(byDay.get(10).status, "today");
  assert.equal(byDay.get(11).status, "future");
  assert.equal(byDay.get(2).status, "missed");
});

test("v2 progress migrates with empty rated IDs and reset streaks", () => {
  const ids = [1, 2, 3];
  const base = createInitialState(ids, () => 0);
  const v2 = {
    ...base,
    version: 2,
    ratingCount: 12,
    profile: {
      ...base.profile,
      totalXp: 240,
      studyStreakDays: 4,
      longestStudyStreakDays: 4,
      lastPracticeAt: "2026-08-10T12:00:00.000Z",
    },
    activityDays: [
      {
        dayStartedAt: new Date(2026, 7, 10).toISOString(),
        ratingCount: 12,
      },
    ],
    questionStats: {
      1: {
        attempts: 12,
        hardCount: 0,
        fuzzyCount: 0,
        masteredCount: 12,
        lastRating: "mastered",
        lastReviewedAt: "2026-08-10T12:00:00.000Z",
      },
    },
  };
  const migrated = migrateV2State(v2, ids);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.profile.studyStreakDays, 0);
  assert.equal(migrated.profile.longestStudyStreakDays, 0);
  assert.equal(migrated.profile.totalXp, 240);
  assert.deepEqual(migrated.activityDays[0].ratedQuestionIds, []);
  assert.equal(migrated.activityDays[0].localDay, "2026-08-10");

  const storage = makeStorage({
    [PREVIOUS_STORAGE_KEY]: JSON.stringify(v2),
  });
  const loaded = loadStoredState(storage, ids, () => 0);
  assert.equal(loaded.migrated, true);
  assert.match(loaded.warning, /20 道不同题/);
  assert.equal(storage.values.has(PREVIOUS_STORAGE_KEY), true);
  assert.equal(V2_MIGRATION_NOTICE.includes("20"), true);
});

test("study records dialog opens calendar and notebook practice reuses hard mode", () => {
  const documentObject = makeFakeDocument();
  let initial = createInitialState([1, 2, 3], () => 0);
  initial = {
    ...initial,
    views: {
      ...initial.views,
      all: {
        ...initial.views.all,
        currentQuestionId: 2,
        history: [2],
        historyIndex: 0,
      },
    },
  };
  initial = applyRating(
    initial,
    "hard",
    [1, 2, 3],
    "2026-08-10T12:00:00.000Z",
    () => 0,
  ).state;
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({
    reducedMotion: true,
    storage,
  });
  const app = startBrowserApp(documentObject, browserGlobal);
  documentObject.elements.get("study-records-button").click();
  assert.equal(documentObject.elements.get("study-records-dialog").open, true);
  assert.equal(
    documentObject.elements.get("tab-calendar").getAttribute("aria-selected"),
    "true",
  );
  documentObject.elements.get("tab-notebook").click();
  assert.equal(
    documentObject.elements.get("panel-notebook").hidden,
    false,
  );
  const row = documentObject.elements.get("notebook-list").children[0];
  assert.equal(Boolean(row), true);
  const button = row.children.find((child) => child.tagName === "BUTTON");
  button.click();
  assert.equal(app.getState().mode, "hard");
  assert.equal(getCurrentQuestionId(app.getState()), 2);
  assert.equal(
    documentObject.elements.get("mascot-status").textContent,
    MASCOT_MOOD_LABELS[deriveMascotMood({ completed: false }, new Date())],
  );
});

function makeManyQuestions(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    question: `问题 ${index + 1}`,
    promptHtml: "",
    answerHtml: `<p>答案 ${index + 1}</p>`,
    source: "zhihu-archive",
  }));
}

function makeCheckInState(ratedTodayCount, currentQuestionId, ids) {
  const initial = createInitialState(ids, () => 0);
  const ratedQuestionIds = ids
    .filter((id) => id !== currentQuestionId)
    .slice(0, ratedTodayCount);
  const reviewedAt = "2026-08-10T01:00:00.000Z";
  const questionStats = Object.fromEntries(
    ratedQuestionIds.map((id) => [
      String(id),
      {
        attempts: 1,
        hardCount: 0,
        fuzzyCount: 0,
        masteredCount: 1,
        lastRating: "mastered",
        lastReviewedAt: reviewedAt,
      },
    ]),
  );
  const today = new Date();
  return {
    ...initial,
    ratingCount: ratedTodayCount,
    questionStats,
    profile: {
      ...initial.profile,
      totalXp: ratedTodayCount * RATING_CONFIG.mastered.xp,
      lastPracticeAt: reviewedAt,
    },
    activityDays: [
      {
        localDay: localDayKey(today),
        dayStartedAt: new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        ).toISOString(),
        ratingCount: ratedTodayCount,
        ratedQuestionIds,
      },
    ],
    views: {
      ...initial.views,
      all: {
        currentQuestionId,
        history: [currentQuestionId],
        historyIndex: 0,
      },
    },
  };
}

test("reaching the daily goal celebrates once and stays out of the way", () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1);
  const documentObject = makeFakeDocument();
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(
      makeCheckInState(DAILY_CHECKIN_UNIQUE_QUESTIONS - 1, 30, ids),
    ),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: makeManyQuestions(30),
    reducedMotion: true,
    storage,
  });
  const app = startBrowserApp(documentObject, browserGlobal);
  const dialog = documentObject.elements.get("checkin-dialog");

  assert.equal(dialog.open, false);
  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-mastered").click();

  assert.equal(dialog.open, true);
  assert.equal(
    documentObject.elements.get("checkin-dialog-title").textContent,
    CHECKIN_CELEBRATION_TITLE,
  );
  assert.equal(
    documentObject.elements.get("checkin-dialog-message").textContent,
    CHECKIN_CELEBRATION_MESSAGE,
  );
  assert.match(
    documentObject.elements.get("checkin-dialog-message").textContent,
    /找到工作/,
  );
  assert.match(
    documentObject.elements.get("checkin-dialog-stats").textContent,
    /20 \/ 20/,
  );

  documentObject.elements.get("checkin-dialog-close").click();
  assert.equal(dialog.open, false);

  const ratedBefore = app.getState().ratingCount;
  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-mastered").click();
  assert.equal(app.getState().ratingCount, ratedBefore + 1);
  assert.equal(dialog.open, false);
});

test("celebration dialog swallows practice shortcuts while open", async () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1);
  const documentObject = makeFakeDocument();
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(
      makeCheckInState(DAILY_CHECKIN_UNIQUE_QUESTIONS - 1, 30, ids),
    ),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: makeManyQuestions(30),
    reducedMotion: true,
    storage,
  });
  const app = startBrowserApp(documentObject, browserGlobal);
  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-mastered").click();
  assert.equal(documentObject.elements.get("checkin-dialog").open, true);

  const ratedBefore = app.getState().ratingCount;
  const blocked = await documentObject.dispatch("keydown", { key: "3" });

  assert.equal(blocked.defaultPrevented, false);
  assert.equal(app.getState().ratingCount, ratedBefore);
});

test("restarting after the daily goal does not celebrate again", () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1);
  const documentObject = makeFakeDocument();
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(
      makeCheckInState(DAILY_CHECKIN_UNIQUE_QUESTIONS, 30, ids),
    ),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: makeManyQuestions(30),
    reducedMotion: true,
    storage,
  });
  startBrowserApp(documentObject, browserGlobal);

  assert.equal(documentObject.elements.get("checkin-dialog").open, false);
  assert.equal(
    documentObject.elements.get("daily-checkin-caption").textContent,
    CHECKIN_SUCCESS_LABEL,
  );
});

test("celebration dialog is declared in the page shell", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  assert.match(html, /<dialog\b[^>]*id="checkin-dialog"/);
  assert.match(html, /id="checkin-dialog-close"/);
  assert.match(html, /aria-labelledby="checkin-dialog-title"/);
});

test("leveling up plays a self-dismissing effect", () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1);
  const documentObject = makeFakeDocument();
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(makeCheckInState(4, 30, ids)),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: makeManyQuestions(30),
    reducedMotion: true,
    storage,
  });
  startBrowserApp(documentObject, browserGlobal);
  const effect = documentObject.elements.get("level-up-effect");

  assert.equal(effect.hidden, true);
  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-mastered").click();

  assert.equal(JSON.parse(storage.writes.at(-1)[1]).profile.totalXp, 100);
  assert.equal(effect.hidden, false);
  assert.match(
    documentObject.elements.get("level-up-badge").textContent,
    /Lv\. 2/,
  );

  browserGlobal.runTimers();
  assert.equal(effect.hidden, true);
});

test("a rating below the level threshold keeps the effect hidden", () => {
  const documentObject = makeFakeDocument();
  const initial = createInitialState([1, 2, 3], () => 0);
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(initial),
  });
  const browserGlobal = makeBrowserGlobal({ reducedMotion: true, storage });
  startBrowserApp(documentObject, browserGlobal);

  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-hard").click();

  assert.equal(documentObject.elements.get("level-up-effect").hidden, true);
});

test("the daily celebration dialog suppresses the level-up effect", () => {
  const ids = Array.from({ length: 30 }, (_, index) => index + 1);
  const documentObject = makeFakeDocument();
  const storage = makeStorage({
    [STORAGE_KEY]: JSON.stringify(
      makeCheckInState(DAILY_CHECKIN_UNIQUE_QUESTIONS - 1, 30, ids),
    ),
  });
  const browserGlobal = makeBrowserGlobal({
    questions: makeManyQuestions(30),
    reducedMotion: true,
    storage,
  });
  startBrowserApp(documentObject, browserGlobal);

  documentObject.elements.get("answer-button").click();
  documentObject.elements.get("rate-mastered").click();

  assert.equal(documentObject.elements.get("checkin-dialog").open, true);
  assert.equal(documentObject.elements.get("level-up-effect").hidden, true);
  assert.match(
    documentObject.elements.get("checkin-dialog-stats").textContent,
    /Lv\. 5/,
  );
});

test("level-up effect is declared in the page shell", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  assert.match(html, /id="level-up-effect"[^>]*aria-hidden="true"[^>]*hidden/);
  assert.match(html, /id="level-up-badge"/);
  assert.match(html, /0 \/ 100 XP/);
  assert.match(html, /aria-valuemax="100"/);
});
