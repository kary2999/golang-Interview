// [skill: go-team-standards · dev-dna] 实现离线刷题状态、持久化与无障碍交互
// [skill: code-review v2] 已自检 · P0 修 0 条 / P1 修 0 条 / 通过 14 项
(function initializeGoInterview(globalScope) {
  "use strict";

  const STATE_VERSION = 2;
  const STORAGE_KEY = "go-interview-progress-v2";
  const LEGACY_STORAGE_KEY = "go-interview-progress-v1";
  const MAX_HISTORY_LENGTH = 200;
  const MAX_ACTIVITY_DAYS = 400;
  const MAX_IMPORT_BYTES = 1_000_000;
  const DAILY_STREAK_RATINGS = 10;
  const RATING_CONFIG = Object.freeze({
    hard: Object.freeze({ xp: 2, reviewAfter: 7 }),
    fuzzy: Object.freeze({ xp: 8, reviewAfter: 20 }),
    mastered: Object.freeze({ xp: 20, reviewAfter: null }),
  });
  const VALID_MODES = new Set(["all", "hard"]);
  const VALID_RATINGS = new Set(Object.keys(RATING_CONFIG));
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

  function htmlHasVisibleText(contentHtml) {
    return contentHtml
      .replace(/<[^>]*>/g, "")
      .replace(/&(?:nbsp|#160|#x0*a0);/gi, "")
      .trim().length > 0;
  }

  function assertSafeContentHtml(contentHtml, fieldName) {
    const tagPattern = /<[^>]*>/g;
    const stack = [];
    let cursor = 0;
    let match = tagPattern.exec(contentHtml);

    while (match !== null) {
      const textBeforeTag = contentHtml.slice(cursor, match.index);
      if (textBeforeTag.includes("<") || textBeforeTag.includes(">")) {
        throw new TypeError(`${fieldName} contains malformed markup`);
      }

      const token = match[0];
      if (token === "<br>") {
        cursor = tagPattern.lastIndex;
        match = tagPattern.exec(contentHtml);
        continue;
      }

      const closing = token.match(/^<\/([a-z]+)>$/);
      if (closing !== null) {
        const tag = closing[1];
        if (stack.pop() !== tag) {
          throw new TypeError(`${fieldName} contains mismatched tags`);
        }
        cursor = tagPattern.lastIndex;
        match = tagPattern.exec(contentHtml);
        continue;
      }

      const opening = token.match(
        /^<([a-z]+)(?: class="(language-[a-z0-9_-]+)")?>$/,
      );
      if (opening === null || !ALLOWED_ANSWER_TAGS.has(opening[1])) {
        throw new TypeError(
          `${fieldName} contains a disallowed tag or attribute`,
        );
      }
      if (opening[2] !== undefined && opening[1] !== "code") {
        throw new TypeError(
          `${fieldName}: only code elements may have a language class`,
        );
      }
      stack.push(opening[1]);
      cursor = tagPattern.lastIndex;
      match = tagPattern.exec(contentHtml);
    }

    const trailingText = contentHtml.slice(cursor);
    if (
      trailingText.includes("<")
      || trailingText.includes(">")
      || stack.length !== 0
    ) {
      throw new TypeError(`${fieldName} contains malformed markup`);
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
      const promptHtml = item.promptHtml === undefined
        ? ""
        : item.promptHtml;
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
        typeof promptHtml !== "string"
        || (promptHtml.trim() !== "" && !htmlHasVisibleText(promptHtml))
      ) {
        throw new TypeError(`question ${id} has invalid prompt content`);
      }
      if (
        typeof answerHtml !== "string"
        || answerHtml.trim() === ""
        || !htmlHasVisibleText(answerHtml)
      ) {
        throw new TypeError(`question ${id} has no answer`);
      }
      if (!VALID_SOURCES.has(source)) {
        throw new TypeError(`question ${id} has an invalid source`);
      }

      assertSafeContentHtml(promptHtml, "promptHtml");
      assertSafeContentHtml(answerHtml, "answerHtml");
      seenIds.add(id);
      return {
        id,
        question: question.trim(),
        promptHtml,
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

  function isPlainObject(value) {
    return (
      value !== null
      && typeof value === "object"
      && !Array.isArray(value)
    );
  }

  function isNonnegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function normalizeTimestamp(value) {
    const date = value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new TypeError("timestamp must identify a valid instant");
    }
    return { date, iso: date.toISOString() };
  }

  function isCanonicalIsoTimestamp(value) {
    if (typeof value !== "string") {
      return false;
    }
    try {
      return new Date(value).toISOString() === value;
    } catch (error) {
      return false;
    }
  }

  function localDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function localDayStartedAt(date) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).toISOString();
  }

  function areConsecutiveDays(previousDay, nextDay) {
    const previous = Date.parse(`${previousDay}T00:00:00.000Z`);
    const next = Date.parse(`${nextDay}T00:00:00.000Z`);
    return next - previous === 24 * 60 * 60 * 1000;
  }

  function createEmptyRound(number, firstQuestionId = null) {
    return {
      number,
      seenIds: firstQuestionId === null ? [] : [firstQuestionId],
      xpEarned: 0,
      ratings: {
        hard: 0,
        fuzzy: 0,
        mastered: 0,
      },
    };
  }

  function createInitialState(questionIds, random = Math.random) {
    const ids = normalizeQuestionIds(questionIds);
    const deck = shuffle(ids, random);
    const firstQuestionId = deck[0];
    return {
      version: STATE_VERSION,
      mode: "all",
      deck,
      deckIndex: 1,
      views: {
        all: {
          currentQuestionId: firstQuestionId,
          history: [firstQuestionId],
          historyIndex: 0,
        },
        hard: {
          deck: [],
          index: 0,
        },
      },
      hardIds: [],
      reviewQueue: [],
      ratingCount: 0,
      round: createEmptyRound(1, firstQuestionId),
      profile: {
        totalXp: 0,
        masteryCombo: 0,
        studyStreakDays: 0,
        longestStudyStreakDays: 0,
        lastPracticeAt: null,
      },
      activityDays: [],
      questionStats: {},
    };
  }

  function getActiveDeck(state) {
    if (state.mode !== "hard") {
      return state.deck.slice();
    }
    return state.views.hard.deck.slice();
  }

  function getCurrentQuestionId(state) {
    if (state.mode === "hard") {
      const hardView = state.views.hard;
      return hardView.deck.length === 0
        ? null
        : hardView.deck[hardView.index];
    }
    return state.views.all.currentQuestionId;
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

    const wasHard = state.hardIds.includes(questionId);
    const hardIds = wasHard
      ? state.hardIds.filter((id) => id !== questionId)
      : [...state.hardIds, questionId];
    const hardDeck = wasHard
      ? state.views.hard.deck.filter((id) => id !== questionId)
      : [...state.views.hard.deck, questionId];
    const currentHardId = state.views.hard.deck.length === 0
      ? null
      : state.views.hard.deck[state.views.hard.index];
    let hardIndex = 0;
    if (hardDeck.length > 0) {
      hardIndex = (
        currentHardId !== null
        && currentHardId !== questionId
        && hardDeck.includes(currentHardId)
      )
        ? hardDeck.indexOf(currentHardId)
        : Math.min(state.views.hard.index, hardDeck.length - 1);
    }
    const reviewQueue = state.reviewQueue
      .filter((entry) => entry.questionId !== questionId);
    if (!wasHard) {
      reviewQueue.push({
        questionId,
        dueAfterRatingCount: (
          state.ratingCount + RATING_CONFIG.hard.reviewAfter
        ),
      });
      reviewQueue.sort(
        (left, right) => (
          left.dueAfterRatingCount - right.dueAfterRatingCount
        ),
      );
    }
    return {
      ...state,
      views: {
        ...state.views,
        hard: {
          deck: hardDeck,
          index: hardIndex,
        },
      },
      hardIds,
      reviewQueue,
    };
  }

  function deriveLevel(totalXp) {
    if (!isNonnegativeInteger(totalXp)) {
      throw new TypeError("total XP must be a nonnegative integer");
    }
    return {
      level: Math.floor(totalXp / 1000) + 1,
      currentXp: totalXp % 1000,
      requiredXp: 1000,
    };
  }

  function updateQuestionStats(questionStats, questionId, rating, isoTimestamp) {
    const key = String(questionId);
    const previous = questionStats[key] || {
      attempts: 0,
      hardCount: 0,
      fuzzyCount: 0,
      masteredCount: 0,
      lastRating: null,
      lastReviewedAt: null,
    };
    return {
      ...questionStats,
      [key]: {
        attempts: previous.attempts + 1,
        hardCount: previous.hardCount + (rating === "hard" ? 1 : 0),
        fuzzyCount: previous.fuzzyCount + (rating === "fuzzy" ? 1 : 0),
        masteredCount: (
          previous.masteredCount + (rating === "mastered" ? 1 : 0)
        ),
        lastRating: rating,
        lastReviewedAt: isoTimestamp,
      },
    };
  }

  function updateActivity(state, date) {
    const dayStartedAt = localDayStartedAt(date);
    const day = localDayKey(date);
    const existing = state.activityDays.find(
      (entry) => entry.dayStartedAt === dayStartedAt,
    );
    const previousCount = existing === undefined ? 0 : existing.ratingCount;
    const updatedEntry = {
      dayStartedAt,
      ratingCount: previousCount + 1,
    };
    let activityDays = state.activityDays
      .filter((entry) => entry.dayStartedAt !== dayStartedAt)
      .concat(updatedEntry)
      .sort(
        (left, right) => (
          left.dayStartedAt.localeCompare(right.dayStartedAt)
        ),
      );
    if (activityDays.length > MAX_ACTIVITY_DAYS) {
      activityDays = activityDays.slice(-MAX_ACTIVITY_DAYS);
    }

    let studyStreakDays = state.profile.studyStreakDays;
    let longestStudyStreakDays = state.profile.longestStudyStreakDays;
    if (
      previousCount < DAILY_STREAK_RATINGS
      && updatedEntry.ratingCount >= DAILY_STREAK_RATINGS
    ) {
      const previousQualifiedDays = state.activityDays
        .filter((entry) => entry.ratingCount >= DAILY_STREAK_RATINGS)
        .map((entry) => localDayKey(new Date(entry.dayStartedAt)))
        .sort();
      const latestQualifiedDay = previousQualifiedDays.at(-1);
      if (latestQualifiedDay === undefined || day > latestQualifiedDay) {
        studyStreakDays = (
          latestQualifiedDay !== undefined
          && areConsecutiveDays(latestQualifiedDay, day)
        )
          ? state.profile.studyStreakDays + 1
          : 1;
        longestStudyStreakDays = Math.max(
          longestStudyStreakDays,
          studyStreakDays,
        );
      }
    }

    return {
      activityDays,
      studyStreakDays,
      longestStudyStreakDays,
    };
  }

  function appendHistory(allView, questionId) {
    let history = allView.history.slice(0, allView.historyIndex + 1);
    history.push(questionId);
    if (history.length > MAX_HISTORY_LENGTH) {
      history = history.slice(-MAX_HISTORY_LENGTH);
    }
    return {
      currentQuestionId: questionId,
      history,
      historyIndex: history.length - 1,
    };
  }

  function takeDueReview(state) {
    const dueReviews = state.reviewQueue
      .filter((entry) => entry.dueAfterRatingCount <= state.ratingCount)
      .sort(
        (left, right) => (
          left.dueAfterRatingCount - right.dueAfterRatingCount
        ),
      );
    if (dueReviews.length === 0) {
      return null;
    }
    const selected = dueReviews[0];
    return {
      questionId: selected.questionId,
      reviewQueue: state.reviewQueue.filter(
        (entry) => entry.questionId !== selected.questionId,
      ),
    };
  }

  function selectNextAllQuestion(state, random, allowRoundRollover) {
    const allView = state.views.all;
    if (allView.historyIndex < allView.history.length - 1) {
      const historyIndex = allView.historyIndex + 1;
      return {
        ...state,
        views: {
          ...state.views,
          all: {
            ...allView,
            currentQuestionId: allView.history[historyIndex],
            historyIndex,
          },
        },
      };
    }

    const dueReview = takeDueReview(state);
    if (dueReview !== null) {
      return {
        ...state,
        reviewQueue: dueReview.reviewQueue,
        views: {
          ...state.views,
          all: appendHistory(allView, dueReview.questionId),
        },
      };
    }

    if (state.deckIndex < state.deck.length) {
      const questionId = state.deck[state.deckIndex];
      return {
        ...state,
        deckIndex: state.deckIndex + 1,
        round: {
          ...state.round,
          seenIds: state.round.seenIds.includes(questionId)
            ? state.round.seenIds.slice()
            : [...state.round.seenIds, questionId],
        },
        views: {
          ...state.views,
          all: appendHistory(allView, questionId),
        },
      };
    }

    if (!allowRoundRollover) {
      return state;
    }

    const deck = shuffle(state.deck, random);
    const nextRound = {
      ...state,
      deck,
      deckIndex: 0,
      round: createEmptyRound(state.round.number + 1),
    };
    return selectNextAllQuestion(nextRound, random, false);
  }

  function applyRating(
    state,
    rating,
    questionIds,
    now = new Date(),
    random = Math.random,
  ) {
    const ids = normalizeQuestionIds(questionIds);
    if (!VALID_RATINGS.has(rating)) {
      throw new TypeError("rating must be hard, fuzzy, or mastered");
    }
    if (typeof random !== "function") {
      throw new TypeError("random must be a function");
    }
    const questionId = getCurrentQuestionId(state);
    if (questionId === null || !ids.includes(questionId)) {
      throw new TypeError("current question must exist in the question deck");
    }

    const timestamp = normalizeTimestamp(now);
    const config = RATING_CONFIG[rating];
    const ratingCount = state.ratingCount + 1;
    const previousLevel = deriveLevel(state.profile.totalXp).level;
    const totalXp = state.profile.totalXp + config.xp;
    const activity = updateActivity(state, timestamp.date);
    const latestPracticeAt = (
      state.profile.lastPracticeAt === null
      || timestamp.iso > state.profile.lastPracticeAt
    )
      ? timestamp.iso
      : state.profile.lastPracticeAt;
    let nextState = {
      ...state,
      ratingCount,
      reviewQueue: state.reviewQueue.filter(
        (entry) => entry.questionId !== questionId,
      ),
      round: {
        ...state.round,
        seenIds: state.round.seenIds.slice(),
        xpEarned: state.round.xpEarned + config.xp,
        ratings: {
          ...state.round.ratings,
          [rating]: state.round.ratings[rating] + 1,
        },
      },
      profile: {
        ...state.profile,
        totalXp,
        masteryCombo: rating === "mastered"
          ? state.profile.masteryCombo + 1
          : 0,
        studyStreakDays: activity.studyStreakDays,
        longestStudyStreakDays: activity.longestStudyStreakDays,
        lastPracticeAt: latestPracticeAt,
      },
      activityDays: activity.activityDays,
      questionStats: updateQuestionStats(
        state.questionStats,
        questionId,
        rating,
        timestamp.iso,
      ),
    };

    if (config.reviewAfter !== null) {
      nextState = {
        ...nextState,
        reviewQueue: [
          ...nextState.reviewQueue,
          {
            questionId,
            dueAfterRatingCount: ratingCount + config.reviewAfter,
          },
        ].sort(
          (left, right) => (
            left.dueAfterRatingCount - right.dueAfterRatingCount
          ),
        ),
      };
    }

    const wasHard = state.hardIds.includes(questionId);
    if (
      (rating === "hard" || rating === "fuzzy")
      && !wasHard
    ) {
      const ratingReviewQueue = nextState.reviewQueue;
      nextState = toggleHardId(nextState, questionId);
      nextState = {
        ...nextState,
        reviewQueue: ratingReviewQueue,
      };
    } else if (rating === "mastered" && wasHard) {
      nextState = toggleHardId(nextState, questionId);
    }

    let roundCompleted = false;
    if (state.mode === "hard") {
      const hardDeckLength = nextState.views.hard.deck.length;
      let hardIndex = 0;
      if (hardDeckLength > 0) {
        hardIndex = rating === "mastered" && wasHard
          ? Math.min(state.views.hard.index, hardDeckLength - 1)
          : navigateIndex(state.views.hard.index, hardDeckLength, 1);
      }
      nextState = {
        ...nextState,
        views: {
          ...nextState.views,
          hard: {
            ...nextState.views.hard,
            index: hardIndex,
          },
        },
      };
    } else {
      roundCompleted = (
        nextState.round.seenIds.length === nextState.deck.length
        && state.views.all.historyIndex
          === state.views.all.history.length - 1
      );
      if (roundCompleted) {
        nextState = {
          ...nextState,
          deck: shuffle(nextState.deck, random),
          deckIndex: 0,
          round: createEmptyRound(nextState.round.number + 1),
        };
      }
      nextState = selectNextAllQuestion(nextState, random, false);
    }

    return {
      state: nextState,
      outcome: {
        xpEarned: config.xp,
        leveledUp: deriveLevel(totalXp).level > previousLevel,
        roundCompleted,
      },
    };
  }

  function navigateState(
    state,
    direction,
    questionIds,
    random = Math.random,
  ) {
    normalizeQuestionIds(questionIds);
    if (!Number.isInteger(direction) || direction === 0) {
      throw new TypeError("navigation direction must be a nonzero integer");
    }
    if (state.mode === "hard") {
      const length = state.views.hard.deck.length;
      if (length === 0) {
        return state;
      }
      return {
        ...state,
        views: {
          ...state.views,
          hard: {
            ...state.views.hard,
            index: navigateIndex(
              state.views.hard.index,
              length,
              Math.sign(direction),
            ),
          },
        },
      };
    }

    const allView = state.views.all;
    if (direction < 0) {
      const historyIndex = allView.history.length === 1
        ? 0
        : navigateIndex(
          allView.historyIndex,
          allView.history.length,
          -1,
        );
      return {
        ...state,
        views: {
          ...state.views,
          all: {
            ...allView,
            currentQuestionId: allView.history[historyIndex],
            historyIndex,
          },
        },
      };
    }
    return selectNextAllQuestion(state, random, true);
  }

  function deriveAchievements(state) {
    const masteredCount = Object.values(state.questionStats).filter(
      (stats) => stats.lastRating === "mastered",
    ).length;
    const definitions = [
      {
        id: "first_rating",
        title: "初次出发",
        unlocked: state.ratingCount >= 1,
      },
      {
        id: "hundred_ratings",
        title: "百题热身",
        unlocked: state.ratingCount >= 100,
      },
      {
        id: "full_round",
        title: "完整一轮",
        unlocked: state.round.number >= 2,
      },
      {
        id: "seven_days",
        title: "坚持一周",
        unlocked: state.profile.longestStudyStreakDays >= 7,
      },
      {
        id: "fifty_mastered",
        title: "渐入佳境",
        unlocked: masteredCount >= 50,
      },
    ];
    return definitions.filter((achievement) => achievement.unlocked);
  }

  function migrateLegacyState(candidate, questionIds) {
    const ids = normalizeQuestionIds(questionIds);
    if (
      !isPlainObject(candidate)
      || candidate.version !== 1
      || !VALID_MODES.has(candidate.mode)
      || !isCompletePermutation(candidate.deck, ids)
      || !Array.isArray(candidate.hardIds)
    ) {
      throw new TypeError("legacy progress is invalid");
    }
    const validIdSet = new Set(ids);
    const hardIdSet = new Set(candidate.hardIds);
    if (
      hardIdSet.size !== candidate.hardIds.length
      || candidate.hardIds.some(
        (id) => !Number.isInteger(id) || !validIdSet.has(id),
      )
    ) {
      throw new TypeError("legacy hard question IDs are invalid");
    }
    const hardDeck = candidate.deck.filter((id) => hardIdSet.has(id));
    const activeDeck = candidate.mode === "hard" ? hardDeck : candidate.deck;
    const validIndex = Number.isInteger(candidate.index)
      && (
        (activeDeck.length === 0 && candidate.index === 0)
        || (
          candidate.index >= 0
          && candidate.index < activeDeck.length
        )
      );
    if (!validIndex) {
      throw new TypeError("legacy progress index is invalid");
    }

    const currentAllQuestionId = activeDeck.length === 0
      ? candidate.deck[0]
      : activeDeck[candidate.index];
    const allIndex = candidate.deck.indexOf(currentAllQuestionId);
    return {
      version: STATE_VERSION,
      mode: candidate.mode,
      deck: candidate.deck.slice(),
      deckIndex: allIndex + 1,
      views: {
        all: {
          currentQuestionId: currentAllQuestionId,
          history: [currentAllQuestionId],
          historyIndex: 0,
        },
        hard: {
          deck: hardDeck,
          index: candidate.mode === "hard" ? candidate.index : 0,
        },
      },
      hardIds: candidate.hardIds.slice(),
      reviewQueue: [],
      ratingCount: 0,
      round: {
        ...createEmptyRound(1),
        seenIds: candidate.deck.slice(0, allIndex + 1),
      },
      profile: {
        totalXp: 0,
        masteryCombo: 0,
        studyStreakDays: 0,
        longestStudyStreakDays: 0,
        lastPracticeAt: null,
      },
      activityDays: [],
      questionStats: {},
    };
  }

  function hasValidHardState(candidate, validIdSet) {
    if (!Array.isArray(candidate.hardIds)) {
      return false;
    }
    const hardIdSet = new Set(candidate.hardIds);
    if (
      hardIdSet.size !== candidate.hardIds.length
      || candidate.hardIds.some(
        (id) => !Number.isInteger(id) || !validIdSet.has(id),
      )
      || !isPlainObject(candidate.views)
      || !isPlainObject(candidate.views.hard)
      || !Array.isArray(candidate.views.hard.deck)
    ) {
      return false;
    }
    const hardDeck = candidate.views.hard.deck;
    const hardDeckSet = new Set(hardDeck);
    return (
      hardDeckSet.size === hardDeck.length
      && hardDeck.every(
        (id) => Number.isInteger(id) && hardIdSet.has(id),
      )
      && hardDeck.length === hardIdSet.size
      && Number.isInteger(candidate.views.hard.index)
      && (
        (hardDeck.length === 0 && candidate.views.hard.index === 0)
        || (
          hardDeck.length > 0
          && candidate.views.hard.index >= 0
          && candidate.views.hard.index < hardDeck.length
        )
      )
    );
  }

  function hasValidAllView(candidate, validIdSet) {
    if (
      !isPlainObject(candidate.views)
      || !isPlainObject(candidate.views.all)
    ) {
      return false;
    }
    const allView = candidate.views.all;
    return (
      validIdSet.has(allView.currentQuestionId)
      && Array.isArray(allView.history)
      && allView.history.length > 0
      && allView.history.length <= MAX_HISTORY_LENGTH
      && allView.history.every(
        (id) => Number.isInteger(id) && validIdSet.has(id),
      )
      && Number.isInteger(allView.historyIndex)
      && allView.historyIndex >= 0
      && allView.historyIndex < allView.history.length
      && allView.history[allView.historyIndex] === allView.currentQuestionId
    );
  }

  function hasValidReviewQueue(candidate, validIdSet) {
    if (
      !Array.isArray(candidate.reviewQueue)
      || !Array.isArray(candidate.hardIds)
    ) {
      return false;
    }
    const hardIds = new Set(candidate.hardIds);
    const reviewIds = new Set();
    for (const entry of candidate.reviewQueue) {
      if (
        !isPlainObject(entry)
        || !validIdSet.has(entry.questionId)
        || !hardIds.has(entry.questionId)
        || reviewIds.has(entry.questionId)
        || !Number.isInteger(entry.dueAfterRatingCount)
        || entry.dueAfterRatingCount <= 0
      ) {
        return false;
      }
      reviewIds.add(entry.questionId);
    }
    return true;
  }

  function hasValidRound(candidate, validIdSet) {
    if (
      !isPlainObject(candidate.round)
      || !Number.isInteger(candidate.round.number)
      || candidate.round.number < 1
      || !Array.isArray(candidate.round.seenIds)
      || new Set(candidate.round.seenIds).size
        !== candidate.round.seenIds.length
      || candidate.round.seenIds.some((id) => !validIdSet.has(id))
      || !isNonnegativeInteger(candidate.round.xpEarned)
      || !isPlainObject(candidate.round.ratings)
    ) {
      return false;
    }
    const ratings = candidate.round.ratings;
    if (
      !isNonnegativeInteger(ratings.hard)
      || !isNonnegativeInteger(ratings.fuzzy)
      || !isNonnegativeInteger(ratings.mastered)
    ) {
      return false;
    }
    return candidate.round.xpEarned === (
      ratings.hard * RATING_CONFIG.hard.xp
      + ratings.fuzzy * RATING_CONFIG.fuzzy.xp
      + ratings.mastered * RATING_CONFIG.mastered.xp
    );
  }

  function hasValidProfile(candidate) {
    if (
      !isPlainObject(candidate.profile)
      || !isNonnegativeInteger(candidate.profile.totalXp)
      || !isNonnegativeInteger(candidate.profile.masteryCombo)
      || !isNonnegativeInteger(candidate.profile.studyStreakDays)
      || !isNonnegativeInteger(candidate.profile.longestStudyStreakDays)
      || candidate.profile.longestStudyStreakDays
        < candidate.profile.studyStreakDays
    ) {
      return false;
    }
    return (
      candidate.profile.lastPracticeAt === null
      || isCanonicalIsoTimestamp(candidate.profile.lastPracticeAt)
    );
  }

  function hasValidActivityDays(candidate) {
    if (
      !Array.isArray(candidate.activityDays)
      || candidate.activityDays.length > MAX_ACTIVITY_DAYS
    ) {
      return false;
    }
    const days = new Set();
    let previousDayStartedAt = "";
    for (const entry of candidate.activityDays) {
      if (
        !isPlainObject(entry)
        || !isCanonicalIsoTimestamp(entry.dayStartedAt)
        || days.has(entry.dayStartedAt)
        || entry.dayStartedAt <= previousDayStartedAt
        || !Number.isInteger(entry.ratingCount)
        || entry.ratingCount <= 0
      ) {
        return false;
      }
      days.add(entry.dayStartedAt);
      previousDayStartedAt = entry.dayStartedAt;
    }
    return true;
  }

  function hasValidQuestionStats(candidate, validIdSet) {
    if (!isPlainObject(candidate.questionStats)) {
      return false;
    }
    let attempts = 0;
    let calculatedXp = 0;
    for (const [key, stats] of Object.entries(candidate.questionStats)) {
      const questionId = Number(key);
      if (
        String(questionId) !== key
        || !validIdSet.has(questionId)
        || !isPlainObject(stats)
        || !Number.isInteger(stats.attempts)
        || stats.attempts <= 0
        || !isNonnegativeInteger(stats.hardCount)
        || !isNonnegativeInteger(stats.fuzzyCount)
        || !isNonnegativeInteger(stats.masteredCount)
        || stats.attempts !== (
          stats.hardCount + stats.fuzzyCount + stats.masteredCount
        )
        || !VALID_RATINGS.has(stats.lastRating)
        || stats[`${stats.lastRating}Count`] <= 0
        || !isCanonicalIsoTimestamp(stats.lastReviewedAt)
      ) {
        return false;
      }
      attempts += stats.attempts;
      calculatedXp += (
        stats.hardCount * RATING_CONFIG.hard.xp
        + stats.fuzzyCount * RATING_CONFIG.fuzzy.xp
        + stats.masteredCount * RATING_CONFIG.mastered.xp
      );
    }
    return (
      attempts === candidate.ratingCount
      && calculatedXp === candidate.profile.totalXp
    );
  }

  function normalizeState(candidate, questionIds, random = Math.random) {
    const ids = normalizeQuestionIds(questionIds);
    const fallback = () => ({
      state: createInitialState(ids, random),
      recovered: true,
    });
    const validIdSet = new Set(ids);
    if (
      !isPlainObject(candidate)
      || candidate.version !== STATE_VERSION
      || !VALID_MODES.has(candidate.mode)
      || !isCompletePermutation(candidate.deck, ids)
      || !Number.isInteger(candidate.deckIndex)
      || candidate.deckIndex < 0
      || candidate.deckIndex > candidate.deck.length
      || !hasValidAllView(candidate, validIdSet)
      || !hasValidHardState(candidate, validIdSet)
      || !hasValidReviewQueue(candidate, validIdSet)
      || !isNonnegativeInteger(candidate.ratingCount)
      || !hasValidRound(candidate, validIdSet)
      || !hasValidProfile(candidate)
      || !hasValidActivityDays(candidate)
      || !hasValidQuestionStats(candidate, validIdSet)
    ) {
      return fallback();
    }

    const activityRatings = candidate.activityDays.reduce(
      (total, entry) => total + entry.ratingCount,
      0,
    );
    const roundRatingCount = (
      candidate.round.ratings.hard
      + candidate.round.ratings.fuzzy
      + candidate.round.ratings.mastered
    );
    const consumedDeck = candidate.deck.slice(0, candidate.deckIndex);
    if (
      activityRatings > candidate.ratingCount
      || roundRatingCount > candidate.ratingCount
      || candidate.round.xpEarned > candidate.profile.totalXp
      || candidate.profile.masteryCombo > candidate.ratingCount
      || candidate.round.seenIds.length !== consumedDeck.length
      || candidate.round.seenIds.some(
        (id, index) => id !== consumedDeck[index],
      )
      || (
        candidate.ratingCount === 0
        && candidate.profile.lastPracticeAt !== null
      )
      || (
        candidate.ratingCount > 0
        && candidate.profile.lastPracticeAt === null
      )
    ) {
      return fallback();
    }

    return {
      state: {
        version: STATE_VERSION,
        mode: candidate.mode,
        deck: candidate.deck.slice(),
        deckIndex: candidate.deckIndex,
        views: {
          all: {
            currentQuestionId: candidate.views.all.currentQuestionId,
            history: candidate.views.all.history.slice(),
            historyIndex: candidate.views.all.historyIndex,
          },
          hard: {
            deck: candidate.views.hard.deck.slice(),
            index: candidate.views.hard.index,
          },
        },
        hardIds: candidate.hardIds.slice(),
        reviewQueue: candidate.reviewQueue.map((entry) => ({ ...entry })),
        ratingCount: candidate.ratingCount,
        round: {
          number: candidate.round.number,
          seenIds: candidate.round.seenIds.slice(),
          xpEarned: candidate.round.xpEarned,
          ratings: { ...candidate.round.ratings },
        },
        profile: { ...candidate.profile },
        activityDays: candidate.activityDays.map((entry) => ({ ...entry })),
        questionStats: Object.fromEntries(
          Object.entries(candidate.questionStats).map(
            ([key, stats]) => [key, { ...stats }],
          ),
        ),
      },
      recovered: false,
    };
  }

  function toPersistedState(state) {
    return {
      version: state.version,
      mode: state.mode,
      deck: state.deck.slice(),
      deckIndex: state.deckIndex,
      views: {
        all: {
          currentQuestionId: state.views.all.currentQuestionId,
          history: state.views.all.history.slice(),
          historyIndex: state.views.all.historyIndex,
        },
        hard: {
          deck: state.views.hard.deck.slice(),
          index: state.views.hard.index,
        },
      },
      hardIds: state.hardIds.slice(),
      reviewQueue: state.reviewQueue.map((entry) => ({ ...entry })),
      ratingCount: state.ratingCount,
      round: {
        number: state.round.number,
        seenIds: state.round.seenIds.slice(),
        xpEarned: state.round.xpEarned,
        ratings: { ...state.round.ratings },
      },
      profile: { ...state.profile },
      activityDays: state.activityDays.map((entry) => ({ ...entry })),
      questionStats: Object.fromEntries(
        Object.entries(state.questionStats).map(
          ([key, stats]) => [key, { ...stats }],
        ),
      ),
    };
  }

  function createProgressExport(state, exportedAt = new Date()) {
    const normalized = normalizeState(state, state.deck, () => 0);
    if (normalized.recovered) {
      throw new TypeError("无法导出无效的学习进度。");
    }
    const { iso } = normalizeTimestamp(exportedAt);
    return {
      schemaVersion: STATE_VERSION,
      exportedAt: iso,
      data: normalized.state,
    };
  }

  function createExportPayload(state, exportedAt = new Date()) {
    return createProgressExport(state, exportedAt);
  }

  function utf8ByteLength(value) {
    let length = 0;
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 0x7f) {
        length += 1;
      } else if (codePoint <= 0x7ff) {
        length += 2;
      } else if (codePoint <= 0xffff) {
        length += 3;
      } else {
        length += 4;
      }
    }
    return length;
  }

  function parseProgressImport(
    serialized,
    questionIds,
    random = Math.random,
  ) {
    if (typeof serialized !== "string") {
      throw new TypeError("导入内容必须是 JSON 文本。");
    }
    if (utf8ByteLength(serialized) > MAX_IMPORT_BYTES) {
      throw new TypeError("导入文件不能超过 1MB。");
    }

    let payload;
    try {
      payload = JSON.parse(serialized);
    } catch (error) {
      throw new TypeError("导入文件无法解析。");
    }
    if (
      !isPlainObject(payload)
      || payload.schemaVersion !== STATE_VERSION
      || !isCanonicalIsoTimestamp(payload.exportedAt)
      || !Object.hasOwn(payload, "data")
    ) {
      throw new TypeError("导入文件版本或导出时间无效。");
    }
    const normalized = normalizeState(payload.data, questionIds, random);
    if (normalized.recovered) {
      throw new TypeError("导入进度结构无效。");
    }
    return normalized.state;
  }

  function parseImportPayload(
    serialized,
    questionIds,
    random = Math.random,
  ) {
    return parseProgressImport(serialized, questionIds, random);
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
    if (serialized !== null) {
      let candidate;
      try {
        candidate = JSON.parse(serialized);
      } catch (error) {
        return {
          state: initialState(),
          warning: "本地学习进度已损坏，已重置。",
          migrated: false,
        };
      }

      const normalized = normalizeState(candidate, questionIds, random);
      return {
        state: normalized.state,
        warning: normalized.recovered
          ? "保存的学习进度无效，已重置。"
          : "",
        migrated: false,
      };
    }

    let legacySerialized;
    try {
      legacySerialized = storage.getItem(LEGACY_STORAGE_KEY);
    } catch (error) {
      return {
        state: initialState(),
        warning: "无法读取旧版学习进度，已使用临时进度。",
        migrated: false,
      };
    }
    if (legacySerialized === null) {
      return { state: initialState(), warning: "", migrated: false };
    }
    try {
      const migratedState = migrateLegacyState(
        JSON.parse(legacySerialized),
        questionIds,
      );
      const saved = saveStoredState(storage, migratedState);
      return {
        state: migratedState,
        warning: saved.ok
          ? "已升级旧版学习进度。"
          : saved.warning,
        migrated: true,
      };
    } catch (error) {
      return {
        state: initialState(),
        warning: "旧版学习进度无效，已重置。",
        migrated: false,
      };
    }
  }

  function saveStoredState(storage, state) {
    if (storage === null || typeof storage !== "object") {
      return {
        ok: false,
        warning: "本地存储不可用，本次进度无法保存。",
      };
    }
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify(toPersistedState(state)),
      );
      return { ok: true, warning: "" };
    } catch (error) {
      return {
        ok: false,
        warning: "无法保存本地学习进度，本次操作仅在当前页面有效。",
      };
    }
  }

  function isEligibleAppOrigin(locationObject) {
    if (
      locationObject === null
      || typeof locationObject !== "object"
    ) {
      return false;
    }
    if (locationObject.protocol === "https:") {
      return true;
    }
    if (locationObject.protocol !== "http:") {
      return false;
    }
    const hostname = locationObject.hostname;
    return (
      hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "[::1]"
      || (
        typeof hostname === "string"
        && hostname.endsWith(".localhost")
      )
    );
  }

  function canRegisterServiceWorker(locationObject, navigatorObject) {
    return (
      navigatorObject !== null
      && typeof navigatorObject === "object"
      && "serviceWorker" in navigatorObject
      && isEligibleAppOrigin(locationObject)
    );
  }

  function collectElements(documentObject) {
    const ids = [
      "app",
      "app-error",
      "storage-warning",
      "update-notice",
      "round-summary",
      "install-button",
      "install-help",
      "mode-all",
      "mode-hard",
      "hard-count",
      "achievements-button",
      "achievements-dialog",
      "achievements-list",
      "level-text",
      "xp-text",
      "xp-fill",
      "study-streak",
      "daily-count",
      "mastery-combo",
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
        [
          "a",
          "button",
          "input",
          "select",
          "summary",
          "textarea",
        ].includes(tagName)
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
    const progressButton = documentObject.getElementById("progress-button");
    const updateAction = typeof documentObject.querySelector === "function"
      ? documentObject.querySelector("[data-update-action]")
      : null;
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
    let isTransitioning = false;
    let deferredInstallPrompt = null;
    let waitingWorker = null;
    let reloadOnControllerChange = false;
    let reducedMotion = false;
    try {
      reducedMotion = (
        typeof browserGlobal.matchMedia === "function"
        && browserGlobal.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches
      );
    } catch (error) {
      reducedMotion = false;
    }

    function showWarning(message) {
      elements["storage-warning"].textContent = message;
      elements["storage-warning"].hidden = message === "";
    }

    function announce(message) {
      elements["live-region"].textContent = "";
      const update = () => {
        elements["live-region"].textContent = message;
      };
      if (typeof browserGlobal.setTimeout === "function") {
        browserGlobal.setTimeout(update, 0);
      } else {
        update();
      }
    }

    function persist() {
      const saved = saveStoredState(storage, state);
      if (!saved.ok) {
        showWarning(saved.warning);
      }
      return saved.ok;
    }

    function getDailyRatingCount(now = new Date()) {
      const today = localDayKey(now);
      const activity = state.activityDays.find(
        (entry) => (
          localDayKey(new Date(entry.dayStartedAt)) === today
        ),
      );
      return activity === undefined ? 0 : activity.ratingCount;
    }

    function setAnswerVisible(visible) {
      answerVisible = Boolean(visible) && getCurrentQuestionId(state) !== null;
      elements["answer-panel"].hidden = !answerVisible;
      elements["rating-panel"].hidden = !answerVisible;
      if (!answerVisible) {
        elements["rating-feedback"].hidden = true;
        elements["rating-feedback"].textContent = "";
      }
      elements["answer-button"].setAttribute(
        "aria-expanded",
        String(answerVisible),
      );
      elements["answer-button"].textContent = answerVisible
        ? "收起答案"
        : "揭晓参考答案";
    }

    function hideRoundSummary() {
      elements["round-summary"].hidden = true;
      elements["round-summary"].textContent = "";
    }

    function disableQuestionControls(disabled) {
      elements["previous-button"].disabled = disabled;
      elements["answer-button"].disabled = disabled;
      elements["next-button"].disabled = disabled;
      elements["hard-button"].disabled = disabled;
      elements["rate-hard"].disabled = disabled || isTransitioning;
      elements["rate-fuzzy"].disabled = disabled || isTransitioning;
      elements["rate-mastered"].disabled = disabled || isTransitioning;
    }

    function renderAchievements() {
      const achievements = deriveAchievements(state);
      elements["achievements-button"].textContent = (
        `成就 ${achievements.length} / 5`
      );
      const achievementItems = (
        achievements.length === 0
          ? [{ title: "完成第一次自评，点亮首枚成就。" }]
          : achievements
      ).map((achievement) => {
        const item = documentObject.createElement("li");
        item.textContent = achievement.title;
        return item;
      });
      if (
        typeof elements["achievements-list"].replaceChildren === "function"
      ) {
        elements["achievements-list"].replaceChildren(...achievementItems);
      } else {
        elements["achievements-list"].textContent = achievementItems
          .map((item) => item.textContent)
          .join(" · ");
      }
    }

    function renderProfile() {
      const level = deriveLevel(state.profile.totalXp);
      const xpPercent = (
        level.currentXp / level.requiredXp * 100
      );
      elements["level-text"].textContent = `Lv. ${level.level}`;
      elements["xp-text"].textContent = (
        `${level.currentXp} / ${level.requiredXp} XP`
      );
      elements["xp-fill"].style.width = `${xpPercent}%`;
      elements["study-streak"].textContent = String(
        state.profile.studyStreakDays,
      );
      elements["daily-count"].textContent = String(getDailyRatingCount());
      elements["mastery-combo"].textContent = (
        `${state.profile.masteryCombo}`
      );
      const xpTrack = elements["xp-fill"].parentElement;
      if (xpTrack !== null) {
        xpTrack.setAttribute("aria-valuenow", String(level.currentXp));
        xpTrack.setAttribute(
          "aria-valuetext",
          `${level.currentXp} / ${level.requiredXp} XP`,
        );
      }
      renderAchievements();
    }

    function render() {
      const activeDeck = getActiveDeck(state);
      const questionId = getCurrentQuestionId(state);
      const isEmpty = questionId === null;

      elements["mode-all"].setAttribute(
        "aria-pressed",
        String(state.mode === "all"),
      );
      elements["mode-hard"].setAttribute(
        "aria-pressed",
        String(state.mode === "hard"),
      );
      elements["hard-count"].textContent = String(state.hardIds.length);
      elements["question-card"].hidden = isEmpty;
      elements["empty-state"].hidden = !isEmpty;
      elements["review-actions"].hidden = isEmpty;
      disableQuestionControls(isEmpty || isTransitioning);
      elements["hard-button"].setAttribute("aria-pressed", "false");
      elements["hard-button"].textContent = "加入待复习";
      renderProfile();

      const progressMaximum = Math.max(activeDeck.length, 1);
      const progressValue = isEmpty
        ? 0
        : state.mode === "hard"
          ? state.views.hard.index + 1
          : Math.min(state.round.seenIds.length, state.deck.length);
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
      elements["prompt-content"].innerHTML = question.promptHtml;
      elements["prompt-content"].hidden = question.promptHtml === "";
      elements["answer-content"].innerHTML = question.answerHtml;
      elements["source-badge"].hidden = question.source !== "supplemented";

      const isHard = state.hardIds.includes(question.id);
      elements["hard-button"].setAttribute("aria-pressed", String(isHard));
      elements["hard-button"].textContent = isHard
        ? "移出待复习"
        : "加入待复习";
      setAnswerVisible(answerVisible);
    }

    function commit(nextState, announcement, hideAnswer = true) {
      hideRoundSummary();
      state = nextState;
      if (hideAnswer) {
        answerVisible = false;
      }
      render();
      persist();
      if (announcement !== "") {
        announce(announcement);
      }
    }

    function navigate(direction) {
      if (getCurrentQuestionId(state) === null || isTransitioning) {
        return;
      }
      const nextState = navigateState(state, direction, questionIds);
      commit(
        nextState,
        direction < 0 ? "已切换到上一题" : "已切换到下一题",
      );
    }

    function changeMode(mode) {
      if (
        !VALID_MODES.has(mode)
        || state.mode === mode
        || isTransitioning
      ) {
        return;
      }
      commit(
        { ...state, mode },
        mode === "hard" ? "已进入不会题模式" : "已进入全部题目模式",
      );
    }

    function toggleCurrentHard() {
      const questionId = getCurrentQuestionId(state);
      if (questionId === null || isTransitioning) {
        return;
      }
      const wasHard = state.hardIds.includes(questionId);
      const nextState = toggleHardId(state, questionId);
      const sameQuestion = getCurrentQuestionId(nextState) === questionId;
      commit(
        nextState,
        wasHard ? "已移出待复习" : "已加入待复习",
        !sameQuestion,
      );
    }

    function reshuffle() {
      if (isTransitioning) {
        return;
      }
      const deck = shuffle(state.deck);
      const firstQuestionId = deck[0];
      commit(
        {
          ...state,
          deck,
          deckIndex: 1,
          round: createEmptyRound(state.round.number, firstQuestionId),
          views: {
            ...state.views,
            all: appendHistory(state.views.all, firstQuestionId),
          },
        },
        "本轮题目已重新洗牌",
      );
    }

    function rateCurrent(rating) {
      if (
        !answerVisible
        || isTransitioning
        || getCurrentQuestionId(state) === null
      ) {
        return;
      }
      const dailyCountBefore = getDailyRatingCount();
      const completedRound = {
        xpEarned: state.round.xpEarned + RATING_CONFIG[rating].xp,
        ratings: {
          ...state.round.ratings,
          [rating]: state.round.ratings[rating] + 1,
        },
      };
      hideRoundSummary();
      let result;
      try {
        result = applyRating(
          state,
          rating,
          questionIds,
          new Date(),
        );
      } catch (error) {
        showWarning("无法记录本次自评，请刷新页面后重试。");
        return;
      }

      isTransitioning = true;
      disableQuestionControls(true);
      state = result.state;
      const suffix = result.outcome.leveledUp ? "，等级提升" : "";
      const ratingLabel = {
        hard: "不会",
        fuzzy: "模糊",
        mastered: "掌握",
      }[rating];
      const dailyCompleted = (
        dailyCountBefore < DAILY_STREAK_RATINGS
        && getDailyRatingCount() >= DAILY_STREAK_RATINGS
      );
      const dailySuffix = dailyCompleted ? "，今日训练已完成" : "";
      const feedback = (
        `${ratingLabel}：+${result.outcome.xpEarned} XP${suffix}${dailySuffix}`
      );
      elements["rating-feedback"].textContent = feedback;
      elements["rating-feedback"].hidden = false;
      announce(feedback);
      const saved = saveStoredState(storage, state);
      if (!saved.ok) {
        showWarning(saved.warning);
      }
      const advance = () => {
        isTransitioning = false;
        answerVisible = false;
        render();
        if (result.outcome.roundCompleted) {
          elements["round-summary"].textContent = (
            `本轮完成：掌握 ${completedRound.ratings.mastered} · `
            + `模糊 ${completedRound.ratings.fuzzy} · `
            + `不会 ${completedRound.ratings.hard} · `
            + `获得 ${completedRound.xpEarned} XP`
          );
          elements["round-summary"].hidden = false;
        }
        if (typeof elements["question-text"].focus === "function") {
          elements["question-text"].focus();
        }
      };
      if (reducedMotion || typeof browserGlobal.setTimeout !== "function") {
        advance();
      } else {
        browserGlobal.setTimeout(advance, 300);
      }
    }

    function openDialog(dialog, trigger = null) {
      dialog.hidden = false;
      if (typeof dialog.showModal === "function") {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else {
        dialog.hidden = false;
      }
      if (trigger !== null) {
        trigger.setAttribute("aria-expanded", "true");
      }
    }

    function closeDialog(dialog, trigger = null) {
      if (
        typeof dialog.close === "function"
        && (typeof dialog.open !== "boolean" || dialog.open)
      ) {
        dialog.close();
      } else {
        dialog.hidden = true;
      }
      if (trigger !== null) {
        trigger.setAttribute("aria-expanded", "false");
      }
    }

    function exportFilename(now) {
      return `go-interview-progress-${now.toISOString().slice(0, 10)}.json`;
    }

    async function exportProgress() {
      const now = new Date();
      const serialized = JSON.stringify(
        createProgressExport(state, now),
        null,
        2,
      );
      const filename = exportFilename(now);
      const FileConstructor = browserGlobal.File;
      const BlobConstructor = browserGlobal.Blob;
      const navigatorObject = browserGlobal.navigator || {};
      let file = null;
      if (typeof FileConstructor === "function") {
        file = new FileConstructor(
          [serialized],
          filename,
          { type: "application/json" },
        );
      }

      let canShareFile = false;
      if (
        file !== null
        && typeof navigatorObject.canShare === "function"
        && typeof navigatorObject.share === "function"
      ) {
        try {
          canShareFile = navigatorObject.canShare({ files: [file] });
        } catch (error) {
          canShareFile = false;
        }
      }
      if (canShareFile) {
        try {
          await navigatorObject.share({
            files: [file],
            title: "Go 面试学习进度",
          });
          return;
        } catch (error) {
          // A failed or cancelled share still falls back to a local download.
        }
      }

      if (
        typeof BlobConstructor !== "function"
        || browserGlobal.URL === undefined
        || typeof browserGlobal.URL.createObjectURL !== "function"
      ) {
        showWarning("当前浏览器无法导出进度文件。");
        return;
      }
      const blob = new BlobConstructor(
        [serialized],
        { type: "application/json" },
      );
      const objectUrl = browserGlobal.URL.createObjectURL(blob);
      const link = documentObject.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      documentObject.body.append(link);
      link.click();
      link.remove();
      if (typeof browserGlobal.URL.revokeObjectURL === "function") {
        browserGlobal.URL.revokeObjectURL(objectUrl);
      }
    }

    async function importProgress() {
      const input = elements["import-input"];
      const file = input.files === null || input.files.length === 0
        ? null
        : input.files[0];
      if (file === null) {
        return;
      }
      try {
        if (
          Number.isFinite(file.size)
          && file.size > MAX_IMPORT_BYTES
        ) {
          throw new TypeError("import is too large");
        }
        if (typeof file.text !== "function") {
          throw new TypeError("import cannot be read");
        }
        const imported = parseProgressImport(
          await file.text(),
          questionIds,
        );
        if (
          typeof browserGlobal.confirm !== "function"
          || !browserGlobal.confirm(
            "导入会替换当前学习进度，是否继续？",
          )
        ) {
          return;
        }
        state = imported;
        answerVisible = false;
        render();
        persist();
        closeDialog(elements["progress-dialog"], progressButton);
        announce("学习进度已导入");
      } catch (error) {
        showWarning("导入文件无效，当前学习进度未更改。");
      } finally {
        input.value = "";
      }
    }

    function resetProgress() {
      if (
        typeof browserGlobal.confirm !== "function"
        || !browserGlobal.confirm(
          "重置会清除 XP、等级进度、连续天数、题目统计和待复习记录，确定继续吗？",
        )
      ) {
        return;
      }
      commit(
        createInitialState(questionIds),
        "学习进度已重置",
      );
      closeDialog(elements["progress-dialog"], progressButton);
    }

    function isStandalone() {
      const navigatorObject = browserGlobal.navigator || {};
      if (navigatorObject.standalone === true) {
        return true;
      }
      try {
        return (
          typeof browserGlobal.matchMedia === "function"
          && browserGlobal.matchMedia("(display-mode: standalone)").matches
        );
      } catch (error) {
        return false;
      }
    }

    function isIosBrowser() {
      const navigatorObject = browserGlobal.navigator || {};
      const userAgent = navigatorObject.userAgent || "";
      return (
        /iphone|ipad|ipod/i.test(userAgent)
        || (
          navigatorObject.platform === "MacIntel"
          && navigatorObject.maxTouchPoints > 1
        )
      );
    }

    function setupInstallation() {
      const installButton = elements["install-button"];
      const installHelp = elements["install-help"];
      const standalone = isStandalone();
      installButton.hidden = true;
      installHelp.hidden = true;
      const locationObject = browserGlobal.location;
      if (!isEligibleAppOrigin(locationObject)) {
        return;
      }
      if (!standalone && isIosBrowser()) {
        installButton.textContent = "安装说明";
        installButton.hidden = false;
        installHelp.hidden = false;
      }
      if (standalone || typeof browserGlobal.addEventListener !== "function") {
        return;
      }

      browserGlobal.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        installButton.textContent = "安装应用";
        installButton.hidden = false;
        installHelp.hidden = true;
      });
      browserGlobal.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        installButton.hidden = true;
        installHelp.hidden = true;
        closeDialog(installHelp);
      });
      installButton.addEventListener("click", async () => {
        if (deferredInstallPrompt === null) {
          if (isIosBrowser()) {
            installHelp.hidden = false;
            openDialog(installHelp, installButton);
          }
          return;
        }
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installButton.hidden = true;
        try {
          await promptEvent.prompt();
          if (promptEvent.userChoice !== undefined) {
            await promptEvent.userChoice;
          }
        } catch (error) {
          showWarning("暂时无法显示安装提示，请稍后重试。");
        }
      });
    }

    function showUpdateNotice(worker = null) {
      if (
        worker !== null
        && typeof worker.postMessage === "function"
      ) {
        waitingWorker = worker;
      }
      elements["update-notice"].hidden = false;
    }

    function watchInstallingWorker(registration) {
      if (
        registration.installing === null
        || registration.installing === undefined
        || typeof registration.installing.addEventListener !== "function"
      ) {
        return;
      }
      const worker = registration.installing;
      worker.addEventListener("statechange", () => {
        if (
          worker.state === "installed"
          && browserGlobal.navigator.serviceWorker.controller
        ) {
          showUpdateNotice(worker);
        }
      });
    }

    function setupServiceWorker() {
      const navigatorObject = browserGlobal.navigator || {};
      const serviceWorker = navigatorObject.serviceWorker;
      if (
        serviceWorker === undefined
        || !canRegisterServiceWorker(
          browserGlobal.location,
          navigatorObject,
        )
        || typeof serviceWorker.register !== "function"
      ) {
        return;
      }
      if (typeof serviceWorker.addEventListener === "function") {
        serviceWorker.addEventListener("message", (event) => {
          const message = event.data;
          const type = typeof message === "string"
            ? message
            : isPlainObject(message)
              ? message.type
              : "";
          if (typeof type === "string" && /update|waiting/i.test(type)) {
            showUpdateNotice(event.source || null);
          }
        });
        serviceWorker.addEventListener("controllerchange", () => {
          if (
            reloadOnControllerChange
            && browserGlobal.location !== undefined
            && typeof browserGlobal.location.reload === "function"
          ) {
            reloadOnControllerChange = false;
            browserGlobal.location.reload();
          }
        });
      }
      let registrationResult;
      try {
        registrationResult = serviceWorker.register("./service-worker.js");
      } catch (error) {
        return;
      }
      Promise.resolve(registrationResult)
        .then((registration) => {
          if (registration.waiting) {
            showUpdateNotice(registration.waiting);
          }
          if (typeof registration.addEventListener === "function") {
            registration.addEventListener(
              "updatefound",
              () => watchInstallingWorker(registration),
            );
          }
        })
        .catch(() => {
          // The application remains fully usable without a service worker.
        });
    }

    function requestUpdate() {
      if (answerVisible || isTransitioning) {
        announce("请先完成当前题目，再更新应用。");
        return;
      }
      if (
        waitingWorker === null
        || typeof waitingWorker.postMessage !== "function"
      ) {
        announce("更新仍在准备中，请稍后再试。");
        return;
      }
      if (!persist()) {
        announce("当前进度尚未保存，请先导出备份再更新。");
        return;
      }
      reloadOnControllerChange = true;
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
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
    elements["rate-hard"].addEventListener(
      "click",
      () => rateCurrent("hard"),
    );
    elements["rate-fuzzy"].addEventListener(
      "click",
      () => rateCurrent("fuzzy"),
    );
    elements["rate-mastered"].addEventListener(
      "click",
      () => rateCurrent("mastered"),
    );
    elements["achievements-button"].addEventListener(
      "click",
      () => openDialog(
        elements["achievements-dialog"],
        elements["achievements-button"],
      ),
    );
    elements["achievements-dialog"].addEventListener("close", () => {
      elements["achievements-button"].setAttribute(
        "aria-expanded",
        "false",
      );
    });
    elements["progress-dialog"].addEventListener("close", () => {
      if (progressButton !== null) {
        progressButton.setAttribute("aria-expanded", "false");
      }
    });
    elements["install-help"].addEventListener("close", () => {
      elements["install-button"].setAttribute("aria-expanded", "false");
    });
    elements["progress-dialog-close"].addEventListener(
      "click",
      () => closeDialog(elements["progress-dialog"], progressButton),
    );
    if (progressButton !== null) {
      progressButton.addEventListener(
        "click",
        () => openDialog(elements["progress-dialog"], progressButton),
      );
    } else {
      elements["level-text"].addEventListener(
        "click",
        () => openDialog(elements["progress-dialog"]),
      );
    }
    elements["export-button"].addEventListener("click", exportProgress);
    elements["import-input"].addEventListener("change", importProgress);
    elements["reset-button"].addEventListener("click", resetProgress);
    if (updateAction !== null) {
      updateAction.addEventListener("click", requestUpdate);
    }

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

      const key = typeof event.key === "string" ? event.key : "";
      if (key === " " || key === "Spacebar") {
        if (!elements["answer-button"].disabled) {
          event.preventDefault();
          elements["answer-button"].click();
        }
      } else if (key === "ArrowLeft") {
        if (!elements["previous-button"].disabled) {
          event.preventDefault();
          navigate(-1);
        }
      } else if (key === "ArrowRight") {
        if (!elements["next-button"].disabled) {
          event.preventDefault();
          navigate(1);
        }
      } else if (key.toLowerCase() === "j") {
        if (!elements["hard-button"].disabled) {
          event.preventDefault();
          toggleCurrentHard();
        }
      } else if (
        answerVisible
        && !isTransitioning
        && Object.hasOwn({ 1: "hard", 2: "fuzzy", 3: "mastered" }, key)
      ) {
        event.preventDefault();
        rateCurrent({ 1: "hard", 2: "fuzzy", 3: "mastered" }[key]);
      }
    });

    showWarning(storageAccessWarning || loaded.warning);
    elements["update-notice"].hidden = true;
    setupInstallation();
    setupServiceWorker();
    render();
    return Object.freeze({
      getState() {
        return state;
      },
      render,
    });
  }

  const api = Object.freeze({
    LEGACY_STORAGE_KEY,
    MAX_ACTIVITY_DAYS,
    MAX_HISTORY_LENGTH,
    MAX_IMPORT_BYTES,
    RATING_CONFIG,
    STATE_VERSION,
    STORAGE_KEY,
    applyRating,
    canRegisterServiceWorker,
    createExportPayload,
    createInitialState,
    createProgressExport,
    deriveAchievements,
    deriveLevel,
    getActiveDeck,
    getCurrentQuestionId,
    loadStoredState,
    migrateLegacyState,
    navigateIndex,
    navigateState,
    normalizeQuestions,
    normalizeState,
    parseImportPayload,
    parseProgressImport,
    saveStoredState,
    shuffle,
    toggleHardId,
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Object.freeze({
      ...api,
      startBrowserApp,
    });
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
