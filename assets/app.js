// [skill: go-team-standards · dev-dna] 实现离线刷题状态、持久化与无障碍交互
(function initializeGoInterview(globalScope) {
  "use strict";

  const STATE_VERSION = 1;
  const STORAGE_KEY = "go-interview-progress-v1";
  const VALID_MODES = new Set(["all", "hard"]);
  const VALID_SOURCES = new Set(["zhihu-archive", "supplemented"]);
  const ALLOWED_ANSWER_TAGS = new Set([
    "p",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "strong",
    "b",
    "em",
    "i",
    "blockquote",
  ]);

  function shuffle(items, random = Math.random) {
    if (!Array.isArray(items) || typeof random !== "function") {
      throw new TypeError("shuffle requires an array and random function");
    }

    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomValue = random();
      if (
        typeof randomValue !== "number"
        || !Number.isFinite(randomValue)
        || randomValue < 0
        || randomValue >= 1
      ) {
        throw new TypeError("random must return a number in [0, 1)");
      }
      const swapIndex = Math.floor(randomValue * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }
    return shuffled;
  }

  function answerHasVisibleText(answerHtml) {
    return answerHtml
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:nbsp|#160|#x0*a0);/gi, "")
      .trim().length > 0;
  }

  function assertSafeAnswerHtml(answerHtml) {
    const tagPattern = /<[^>]*>/g;
    const stack = [];
    let cursor = 0;
    let match = tagPattern.exec(answerHtml);

    while (match !== null) {
      const textBeforeTag = answerHtml.slice(cursor, match.index);
      if (textBeforeTag.includes("<") || textBeforeTag.includes(">")) {
        throw new TypeError("answerHtml contains malformed markup");
      }

      const token = match[0];
      if (token === "<br>") {
        cursor = tagPattern.lastIndex;
        match = tagPattern.exec(answerHtml);
        continue;
      }

      const closing = token.match(/^<\/([a-z]+)>$/);
      if (closing !== null) {
        const tag = closing[1];
        if (stack.pop() !== tag) {
          throw new TypeError("answerHtml contains mismatched tags");
        }
        cursor = tagPattern.lastIndex;
        match = tagPattern.exec(answerHtml);
        continue;
      }

      const opening = token.match(
        /^<([a-z]+)(?: class="(language-[a-z0-9_-]+)")?>$/,
      );
      if (opening === null || !ALLOWED_ANSWER_TAGS.has(opening[1])) {
        throw new TypeError("answerHtml contains a disallowed tag or attribute");
      }
      if (opening[2] !== undefined && opening[1] !== "code") {
        throw new TypeError("only code elements may have a language class");
      }
      stack.push(opening[1]);
      cursor = tagPattern.lastIndex;
      match = tagPattern.exec(answerHtml);
    }

    const trailingText = answerHtml.slice(cursor);
    if (
      trailingText.includes("<")
      || trailingText.includes(">")
      || stack.length !== 0
    ) {
      throw new TypeError("answerHtml contains malformed markup");
    }
  }

  function normalizeQuestions(input) {
    if (!Array.isArray(input) || input.length === 0) {
      throw new TypeError("question data must be a nonempty array");
    }

    const seenIds = new Set();
    return input.map((item, index) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new TypeError(`question record ${index + 1} is invalid`);
      }

      const { id, question, answerHtml, source } = item;
      if (
        !Number.isInteger(id)
        || typeof id === "boolean"
        || id <= 0
        || seenIds.has(id)
      ) {
        throw new TypeError(`question record ${index + 1} has an invalid ID`);
      }
      if (typeof question !== "string" || question.trim() === "") {
        throw new TypeError(`question ${id} has no question text`);
      }
      if (
        typeof answerHtml !== "string"
        || answerHtml.trim() === ""
        || !answerHasVisibleText(answerHtml)
      ) {
        throw new TypeError(`question ${id} has no answer`);
      }
      if (!VALID_SOURCES.has(source)) {
        throw new TypeError(`question ${id} has an invalid source`);
      }

      assertSafeAnswerHtml(answerHtml);
      seenIds.add(id);
      return {
        id,
        question: question.trim(),
        answerHtml,
        source,
      };
    });
  }

  function normalizeQuestionIds(questionIds) {
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      throw new TypeError("question IDs must be a nonempty array");
    }
    const uniqueIds = new Set(questionIds);
    if (
      uniqueIds.size !== questionIds.length
      || questionIds.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new TypeError("question IDs must be unique positive integers");
    }
    return questionIds.slice();
  }

  function createInitialState(questionIds, random = Math.random) {
    const ids = normalizeQuestionIds(questionIds);
    return {
      version: STATE_VERSION,
      mode: "all",
      deck: shuffle(ids, random),
      index: 0,
      hardIds: [],
    };
  }

  function getActiveDeck(state) {
    if (state.mode !== "hard") {
      return state.deck.slice();
    }
    const hardIdSet = new Set(state.hardIds);
    return state.deck.filter((id) => hardIdSet.has(id));
  }

  function isCompletePermutation(deck, ids) {
    if (!Array.isArray(deck) || deck.length !== ids.length) {
      return false;
    }
    const idSet = new Set(ids);
    return (
      new Set(deck).size === deck.length
      && deck.every((id) => Number.isInteger(id) && idSet.has(id))
    );
  }

  function normalizeState(candidate, questionIds, random = Math.random) {
    const ids = normalizeQuestionIds(questionIds);
    const fallback = () => ({
      state: createInitialState(ids, random),
      recovered: true,
    });

    if (
      candidate === null
      || typeof candidate !== "object"
      || Array.isArray(candidate)
      || candidate.version !== STATE_VERSION
      || !VALID_MODES.has(candidate.mode)
      || !isCompletePermutation(candidate.deck, ids)
      || !Array.isArray(candidate.hardIds)
    ) {
      return fallback();
    }

    const validIdSet = new Set(ids);
    const hardIdSet = new Set(candidate.hardIds);
    if (
      hardIdSet.size !== candidate.hardIds.length
      || candidate.hardIds.some(
        (id) => !Number.isInteger(id) || !validIdSet.has(id),
      )
    ) {
      return fallback();
    }

    const state = {
      version: STATE_VERSION,
      mode: candidate.mode,
      deck: candidate.deck.slice(),
      index: candidate.index,
      hardIds: candidate.hardIds.slice(),
    };
    const activeDeckLength = getActiveDeck(state).length;
    const hasValidIndex = Number.isInteger(state.index)
      && (
        (activeDeckLength === 0 && state.index === 0)
        || (
          activeDeckLength > 0
          && state.index >= 0
          && state.index < activeDeckLength
        )
      );

    if (!hasValidIndex) {
      return fallback();
    }
    return { state, recovered: false };
  }

  function navigateIndex(currentIndex, deckLength, direction) {
    if (
      !Number.isInteger(currentIndex)
      || !Number.isInteger(deckLength)
      || deckLength < 0
      || !Number.isInteger(direction)
    ) {
      throw new TypeError("navigation arguments must be integers");
    }
    if (deckLength === 0) {
      return 0;
    }
    return (currentIndex + direction % deckLength + deckLength) % deckLength;
  }

  function toggleHardId(state, questionId) {
    if (!state.deck.includes(questionId)) {
      throw new TypeError("hard question ID must exist in the deck");
    }

    const hardIds = state.hardIds.includes(questionId)
      ? state.hardIds.filter((id) => id !== questionId)
      : [...state.hardIds, questionId];
    const nextState = {
      ...state,
      hardIds,
    };
    const activeDeckLength = getActiveDeck(nextState).length;
    nextState.index = activeDeckLength === 0
      ? 0
      : Math.min(state.index, activeDeckLength - 1);
    return nextState;
  }

  function loadStoredState(
    storage,
    questionIds,
    random = Math.random,
  ) {
    const initialState = () => createInitialState(questionIds, random);
    if (storage === null || typeof storage !== "object") {
      return {
        state: initialState(),
        warning: "本地存储不可用，学习进度仅在当前页面保留。",
      };
    }

    let serialized;
    try {
      serialized = storage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        state: initialState(),
        warning: "无法读取本地学习进度，已使用临时进度。",
      };
    }
    if (serialized === null) {
      return { state: initialState(), warning: "" };
    }

    let candidate;
    try {
      candidate = JSON.parse(serialized);
    } catch (error) {
      return {
        state: initialState(),
        warning: "本地学习进度已损坏，已重置。",
      };
    }

    const normalized = normalizeState(candidate, questionIds, random);
    return {
      state: normalized.state,
      warning: normalized.recovered
        ? "保存的学习进度无效，已重置。"
        : "",
    };
  }

  function saveStoredState(storage, state) {
    if (storage === null || typeof storage !== "object") {
      return {
        ok: false,
        warning: "本地存储不可用，本次进度无法保存。",
      };
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { ok: true, warning: "" };
    } catch (error) {
      return {
        ok: false,
        warning: "无法保存本地学习进度，本次操作仅在当前页面有效。",
      };
    }
  }

  function collectElements(documentObject) {
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
      "live-region",
    ];
    const elements = {};
    for (const id of ids) {
      const element = documentObject.getElementById(id);
      if (element === null) {
        return null;
      }
      elements[id] = element;
    }
    return elements;
  }

  function showEmergencyError(documentObject, message) {
    const existingError = documentObject.getElementById("app-error");
    if (existingError !== null) {
      existingError.textContent = message;
      existingError.hidden = false;
    } else if (documentObject.body !== null) {
      const error = documentObject.createElement("p");
      error.setAttribute("role", "alert");
      error.textContent = message;
      documentObject.body.append(error);
    }
    for (const control of documentObject.querySelectorAll("button")) {
      control.disabled = true;
    }
  }

  function isInteractiveTarget(target) {
    let node = target;
    while (node !== null && node !== undefined) {
      const tagName = typeof node.tagName === "string"
        ? node.tagName.toLowerCase()
        : "";
      if (
        ["a", "button", "input", "select", "textarea"].includes(tagName)
        || node.isContentEditable === true
      ) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function startBrowserApp(documentObject, browserGlobal) {
    const elements = collectElements(documentObject);
    if (elements === null) {
      showEmergencyError(
        documentObject,
        "页面结构不完整，无法启动刷题应用。",
      );
      return;
    }

    let questions;
    try {
      questions = normalizeQuestions(
        browserGlobal.GO_INTERVIEW_QUESTIONS,
      );
    } catch (error) {
      showEmergencyError(
        documentObject,
        "题库加载失败，请确认 data/questions.js 完整且格式正确。",
      );
      elements["question-card"].hidden = true;
      return;
    }

    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const questionIds = questions.map((question) => question.id);
    let storage = null;
    let storageAccessWarning = "";
    try {
      storage = browserGlobal.localStorage;
    } catch (error) {
      storageAccessWarning = "浏览器禁止本地存储，学习进度仅在当前页面保留。";
    }

    const loaded = loadStoredState(storage, questionIds);
    let state = loaded.state;
    let answerVisible = false;

    function showWarning(message) {
      elements["storage-warning"].textContent = message;
      elements["storage-warning"].hidden = message === "";
    }

    function setAnswerVisible(visible) {
      answerVisible = Boolean(visible);
      elements["answer-panel"].hidden = !answerVisible;
      elements["answer-button"].setAttribute(
        "aria-expanded",
        String(answerVisible),
      );
      elements["answer-button"].textContent = answerVisible
        ? "收起答案"
        : "显示答案";
    }

    function disableQuestionControls(disabled) {
      elements["previous-button"].disabled = disabled;
      elements["answer-button"].disabled = disabled;
      elements["next-button"].disabled = disabled;
      elements["hard-button"].disabled = disabled;
    }

    function render() {
      const activeDeck = getActiveDeck(state);
      const isEmpty = activeDeck.length === 0;

      elements["mode-all"].setAttribute(
        "aria-pressed",
        String(state.mode === "all"),
      );
      elements["mode-hard"].setAttribute(
        "aria-pressed",
        String(state.mode === "hard"),
      );
      elements["hard-count"].textContent = `不会题 ${state.hardIds.length}`;
      elements["question-card"].hidden = isEmpty;
      elements["empty-state"].hidden = !isEmpty;
      disableQuestionControls(isEmpty);

      const progressMaximum = Math.max(activeDeck.length, 1);
      const progressValue = isEmpty ? 0 : state.index + 1;
      elements["progress-text"].textContent = isEmpty
        ? "0 / 0"
        : `${progressValue} / ${activeDeck.length}`;
      elements["progress-bar"].setAttribute(
        "aria-valuemax",
        String(progressMaximum),
      );
      elements["progress-bar"].setAttribute(
        "aria-valuenow",
        String(progressValue),
      );
      elements["progress-bar"].setAttribute(
        "aria-valuetext",
        isEmpty
          ? "不会题列表为空"
          : `第 ${progressValue} 题，共 ${activeDeck.length} 题`,
      );
      elements["progress-fill"].style.width = isEmpty
        ? "0%"
        : `${(progressValue / activeDeck.length) * 100}%`;

      if (isEmpty) {
        setAnswerVisible(false);
        return;
      }

      const questionId = activeDeck[state.index];
      const question = questionsById.get(questionId);
      if (question === undefined) {
        showEmergencyError(
          documentObject,
          "当前题目不存在，学习进度已停止。",
        );
        disableQuestionControls(true);
        return;
      }

      elements["question-number"].textContent = `第 ${question.id} 题`;
      elements["question-text"].textContent = question.question;
      elements["answer-content"].innerHTML = question.answerHtml;
      elements["source-badge"].hidden = question.source !== "supplemented";

      const isHard = state.hardIds.includes(question.id);
      elements["hard-button"].setAttribute("aria-pressed", String(isHard));
      elements["hard-button"].textContent = isHard
        ? "取消不会"
        : "标记不会";
      setAnswerVisible(answerVisible);
    }

    function announce(message) {
      elements["live-region"].textContent = "";
      browserGlobal.setTimeout(() => {
        elements["live-region"].textContent = message;
      }, 0);
    }

    function commit(nextState, announcement) {
      state = nextState;
      setAnswerVisible(false);
      render();
      const saved = saveStoredState(storage, state);
      if (!saved.ok) {
        showWarning(saved.warning);
      }
      announce(announcement);
    }

    function navigate(direction) {
      const activeDeck = getActiveDeck(state);
      if (activeDeck.length === 0) {
        return;
      }
      const index = navigateIndex(state.index, activeDeck.length, direction);
      commit(
        { ...state, index },
        `已切换到第 ${index + 1} 题`,
      );
    }

    function changeMode(mode) {
      if (!VALID_MODES.has(mode) || state.mode === mode) {
        return;
      }
      commit(
        { ...state, mode, index: 0 },
        mode === "hard" ? "已进入不会题模式" : "已进入全部题目模式",
      );
    }

    function toggleCurrentHard() {
      const activeDeck = getActiveDeck(state);
      if (activeDeck.length === 0) {
        return;
      }
      const questionId = activeDeck[state.index];
      const wasHard = state.hardIds.includes(questionId);
      commit(
        toggleHardId(state, questionId),
        wasHard ? "已取消不会标记" : "已标记为不会",
      );
    }

    function reshuffle() {
      commit(
        {
          ...state,
          deck: shuffle(state.deck),
          index: 0,
        },
        "本轮题目已重新洗牌",
      );
    }

    elements["mode-all"].addEventListener("click", () => changeMode("all"));
    elements["mode-hard"].addEventListener("click", () => changeMode("hard"));
    elements["previous-button"].addEventListener(
      "click",
      () => navigate(-1),
    );
    elements["next-button"].addEventListener("click", () => navigate(1));
    elements["answer-button"].addEventListener("click", () => {
      setAnswerVisible(!answerVisible);
      announce(answerVisible ? "参考答案已显示" : "参考答案已隐藏");
    });
    elements["hard-button"].addEventListener("click", toggleCurrentHard);
    elements["reshuffle-button"].addEventListener("click", reshuffle);

    documentObject.addEventListener("keydown", (event) => {
      if (
        event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || isInteractiveTarget(event.target)
      ) {
        return;
      }

      if (event.key === " " || event.key === "Spacebar") {
        if (!elements["answer-button"].disabled) {
          event.preventDefault();
          elements["answer-button"].click();
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigate(1);
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleCurrentHard();
      }
    });

    showWarning(storageAccessWarning || loaded.warning);
    render();
  }

  const api = Object.freeze({
    STATE_VERSION,
    STORAGE_KEY,
    createInitialState,
    getActiveDeck,
    loadStoredState,
    navigateIndex,
    normalizeQuestions,
    normalizeState,
    saveStoredState,
    shuffle,
    toggleHardId,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.GoInterviewCore = api;
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => startBrowserApp(document, globalScope),
        { once: true },
      );
    } else {
      startBrowserApp(document, globalScope);
    }
  }
}(typeof globalThis === "undefined" ? this : globalThis));
