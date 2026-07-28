const STORAGE_KEY = "word-fast-pass-pages-v2";
const LEGACY_STORAGE_KEY = "gre-fast-pass-pages-v1";
const APP_STATE_VERSION = 3;
const CUSTOM_SCOPE = "my-added-words";
const MAX_CUSTOM_WORDS = 500;
const validStatuses = new Set(["unknown", "known", "mastered"]);
const validStudyModes = new Set(["all", "unknown", "known", "unseen"]);
const studyModeLabels = {
  all: "全部未掌握",
  unknown: "只刷不认识",
  known: "只刷认识",
  unseen: "只刷未看过",
};

const elements = Object.fromEntries(
  [
    "loadingView",
    "appView",
    "brandButton",
    "brandSubtitle",
    "vocabularyButton",
    "currentLibraryName",
    "customWordsButton",
    "customWordCount",
    "libraryButton",
    "settingsButton",
    "scopeButton",
    "scopeLabel",
    "roundLabel",
    "positionLabel",
    "progressSlider",
    "studyView",
    "wordCard",
    "dayLabel",
    "cardTags",
    "speakButton",
    "wordText",
    "revealButton",
    "revealLabel",
    "answerArea",
    "answerLabel",
    "equivalentsText",
    "meaningText",
    "usageArea",
    "usageText",
    "answerPrimaryBlock",
    "exampleBlock",
    "exampleText",
    "notesBlock",
    "notesText",
    "previousButton",
    "forwardButton",
    "undoButton",
    "summaryView",
    "summaryKicker",
    "summaryTitle",
    "summaryText",
    "summaryUnknown",
    "summaryKnown",
    "summaryMastered",
    "nextRoundButton",
    "nextRoundLabel",
    "summaryPreviousButton",
    "summaryUndoButton",
    "remainingCount",
    "masteredCount",
    "totalWordCount",
    "knownCount",
    "saveStatus",
    "panelBackdrop",
    "sidePanel",
    "panelKicker",
    "panelTitle",
    "closePanelButton",
    "catalogPanel",
    "catalogList",
    "libraryPanel",
    "settingsPanel",
    "statusLibraryName",
    "statusStudyButton",
    "libraryTabs",
    "libraryKnownCount",
    "libraryUnknownCount",
    "libraryMasteredCount",
    "searchInput",
    "libraryList",
    "customWordsPanel",
    "customLibraryName",
    "customWordForm",
    "customWordId",
    "customWordInput",
    "customMeaningInput",
    "customExtraInput",
    "customSaveButton",
    "customCancelButton",
    "customFormMessage",
    "customListCount",
    "customSearchInput",
    "customWordList",
    "modeList",
    "scopeList",
    "subgroupSection",
    "subgroupList",
    "typeSection",
    "typeList",
    "rangeStartInput",
    "rangeEndInput",
    "applyRangeButton",
    "shuffleToggle",
    "installButton",
    "exportButton",
    "importButton",
    "importInput",
    "sourceNote",
    "resetButton",
  ].map((id) => [id, document.getElementById(id)]),
);

const libraryResponse = await fetch("./libraries.json");
if (!libraryResponse.ok) throw new Error("词库目录加载失败");
const libraries = await libraryResponse.json();
const libraryById = new Map(libraries.map((library) => [library.id, library]));
const wordCache = new Map();

let legacyState = null;
try {
  legacyState = JSON.parse(
    localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null",
  );
} catch {
  legacyState = null;
}

function normalizeAppStateContainer(saved) {
  if (
    (saved?.version !== 2 && saved?.version !== APP_STATE_VERSION) ||
    !saved.libraries ||
    typeof saved.libraries !== "object" ||
    Array.isArray(saved.libraries)
  ) {
    return null;
  }
  return {
    version: APP_STATE_VERSION,
    revision:
      Number.isInteger(saved.revision) && saved.revision >= 0
        ? saved.revision
        : 0,
    activeLibraryId: libraryById.has(saved.activeLibraryId)
      ? saved.activeLibraryId
      : libraries[0].id,
    libraries: saved.libraries,
  };
}

function loadAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const normalized = normalizeAppStateContainer(saved);
    if (normalized) return normalized;
  } catch {
    // A damaged record is ignored. Other browser data is not touched.
  }
  return {
    version: APP_STATE_VERSION,
    revision: 0,
    activeLibraryId: legacyState ? "gre-equivalents" : libraries[0].id,
    libraries: {},
  };
}

let appState = loadAppState();
let activeLibrary = null;
let baseWords = [];
let words = [];
let wordById = new Map();
let state = null;
let revealed = false;
let lastAction = null;
let libraryStatus = "known";
let historyOffset = 0;
let loadingLibraryId = null;
let summaryNextMode = null;
let cloudAvailable = false;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSavePending = false;

function cleanCustomText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizeCustomWords(value, libraryId, baseIds) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  const idPrefix = `custom-${libraryId}-`;
  for (const item of value.slice(0, MAX_CUSTOM_WORDS)) {
    if (!item || typeof item !== "object") continue;
    const id = cleanCustomText(item.id, 180);
    const word = cleanCustomText(item.word, 120);
    const meaning = cleanCustomText(item.meaning, 500);
    if (
      !id.startsWith(idPrefix) ||
      !/^[a-z0-9-]+$/i.test(id) ||
      !word ||
      !meaning ||
      seen.has(id) ||
      baseIds.has(id)
    ) {
      continue;
    }
    seen.add(id);
    const createdAt =
      Number.isInteger(item.createdAt) && item.createdAt > 0
        ? item.createdAt
        : Date.now();
    result.push({
      id,
      day: 9999,
      word,
      equivalents: cleanCustomText(item.equivalents, 500),
      meaning,
      scope: CUSTOM_SCOPE,
      scopeLabel: "我的添加",
      scopeOrder: 9999,
      isCustom: true,
      createdAt,
      updatedAt:
        Number.isInteger(item.updatedAt) && item.updatedAt >= createdAt
          ? item.updatedAt
          : createdAt,
    });
  }
  return result;
}

function createCustomWordId() {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replaceAll("-", "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `custom-${activeLibrary.id}-${suffix}`;
}

function wordScopeKey(word) {
  return word.scope || String(word.day);
}

function scopeOptions() {
  const options = new Map();
  for (const word of words) {
    const key = wordScopeKey(word);
    if (!options.has(key)) {
      options.set(key, {
        id: key,
        label:
          word.scopeLabel ||
          `第 ${word.day} ${activeLibrary.groupLabel}`,
        order: Number.isFinite(word.scopeOrder) ? word.scopeOrder : word.day,
        part: word.part || "",
        count: 0,
      });
    }
    options.get(key).count += 1;
  }
  return [...options.values()].sort(
    (left, right) => left.order - right.order,
  );
}

function validScopes() {
  return new Set(["all", "custom", ...scopeOptions().map((item) => item.id)]);
}

function validSubgroups(scope = state?.scope) {
  if (!scope || scope === "all" || scope === "custom") return new Set(["all"]);
  return new Set([
    "all",
    ...words
      .filter((word) => wordScopeKey(word) === scope && word.logicGroup)
      .map((word) => word.logicGroup),
  ]);
}

function validExpressionTypes() {
  return new Set([
    "all",
    ...words.map((word) => word.expressionType).filter(Boolean),
  ]);
}

function createDefaultState() {
  return {
    version: 2,
    round: 1,
    statuses: {},
    scope: "all",
    subgroupFilter: "all",
    typeFilter: "all",
    studyMode: "all",
    rangeStart: 1,
    rangeEnd: words.length,
    queue: words.map((word) => word.id),
    cursor: 0,
    shuffle: false,
    dataVersion: activeLibrary?.dataVersion || 1,
    customWords: words.filter((word) => word.isCustom),
  };
}

function normalizeState(value) {
  if (!value || typeof value !== "object") return null;
  const validIds = new Set(words.map((word) => word.id));
  const statuses = {};
  for (const [id, status] of Object.entries(value.statuses || {})) {
    if (validIds.has(id) && validStatuses.has(status)) statuses[id] = status;
  }

  const rawQueue = Array.isArray(value.queue) ? value.queue : [];
  const queue = [
    ...new Set(rawQueue.filter((id) => validIds.has(id))),
  ];
  const scope = validScopes().has(String(value.scope))
    ? String(value.scope)
    : "all";
  const subgroupFilter = validSubgroups(scope).has(value.subgroupFilter)
    ? value.subgroupFilter
    : "all";
  const typeFilter = validExpressionTypes().has(value.typeFilter)
    ? value.typeFilter
    : "all";
  const studyMode = validStudyModes.has(value.studyMode)
    ? value.studyMode
    : "all";
  const rawStart = Number.isInteger(value.rangeStart) ? value.rangeStart : 1;
  const rawEnd = Number.isInteger(value.rangeEnd)
    ? value.rangeEnd
    : words.length;
  const start = Math.min(Math.max(rawStart, 1), words.length);
  const end = Math.min(Math.max(rawEnd, 1), words.length);
  const customWords = words.filter((word) => word.isCustom);

  if (!queue.length && !Object.keys(statuses).length && !customWords.length) {
    return null;
  }

  return {
    version: 2,
    round:
      Number.isInteger(value.round) && value.round > 0 ? value.round : 1,
    statuses,
    scope,
    subgroupFilter,
    typeFilter,
    studyMode,
    rangeStart: Math.min(start, end),
    rangeEnd: Math.max(start, end),
    queue,
    cursor: Math.min(
      Math.max(Number.isInteger(value.cursor) ? value.cursor : 0, 0),
      queue.length,
    ),
    shuffle: Boolean(value.shuffle),
    dataVersion: Number.isInteger(value.dataVersion) ? value.dataVersion : 1,
    customWords,
  };
}

async function getWords(library) {
  if (wordCache.has(library.id)) return wordCache.get(library.id);
  const response = await fetch(library.file);
  if (!response.ok) throw new Error(`${library.name} 加载失败`);
  const result = await response.json();
  wordCache.set(library.id, result);
  return result;
}

function canUseCloud() {
  return (
    window.location.hostname.endsWith(".chatgpt.site") ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

function setSaveStatus(message, className) {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = `footer-save ${className}`;
}

async function loadCloudState() {
  if (!canUseCloud()) return;
  setSaveStatus("正在读取账号进度", "sync-loading");
  try {
    const response = await fetch("/api/progress", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("cloud unavailable");
    const result = await response.json();
    cloudAvailable = true;
    const cloudState = normalizeAppStateContainer(result.progress);
    if (cloudState && cloudState.revision >= appState.revision) {
      appState = cloudState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    }
    setSaveStatus("进度已同步到账号", "sync-saved");
  } catch {
    cloudAvailable = false;
    setSaveStatus("账号同步暂时不可用，已保存在此浏览器", "sync-offline");
  }
}

async function syncCloudNow(payload = appState) {
  if (!canUseCloud()) return false;
  if (cloudSaveInFlight) {
    cloudSavePending = true;
    return false;
  }
  cloudSaveInFlight = true;
  setSaveStatus("正在同步账号进度", "sync-saving");
  try {
    const response = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress: payload }),
    });
    if (!response.ok) throw new Error("cloud save failed");
    cloudAvailable = true;
    setSaveStatus("进度已同步到账号", "sync-saved");
    return true;
  } catch {
    cloudAvailable = false;
    setSaveStatus("账号同步暂时不可用，已保存在此浏览器", "sync-offline");
    return false;
  } finally {
    cloudSaveInFlight = false;
    if (cloudSavePending) {
      cloudSavePending = false;
      scheduleCloudSave();
    }
  }
}

function scheduleCloudSave() {
  if (!canUseCloud()) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    cloudSaveTimer = null;
    syncCloudNow();
  }, 450);
}

function persist({ bumpRevision = true, syncCloud = true } = {}) {
  if (activeLibrary && state) {
    state.customWords = words.filter((word) => word.isCustom);
    appState.activeLibraryId = activeLibrary.id;
    appState.libraries[activeLibrary.id] = state;
  }
  appState.version = APP_STATE_VERSION;
  if (bumpRevision) appState.revision += 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  if (cloudAvailable) {
    setSaveStatus("进度已保存在此设备，等待账号同步", "sync-saving");
  } else if (!canUseCloud()) {
    setSaveStatus("所有词库进度已保存在此浏览器", "sync-saved");
  }
  if (syncCloud) scheduleCloudSave();
}

async function activateLibrary(id, { initial = false } = {}) {
  const library = libraryById.get(id);
  if (!library || loadingLibraryId) return;
  if (!initial && activeLibrary?.id === id) {
    closePanel();
    return;
  }

  if (activeLibrary && state) persist();
  loadingLibraryId = id;
  elements.currentLibraryName.textContent = "正在切换…";
  try {
    const nextWords = await getWords(library);
    activeLibrary = library;
    baseWords = [...nextWords];

    let saved = appState.libraries[library.id];
    if (
      !saved &&
      library.id === "gre-equivalents" &&
      legacyState
    ) {
      saved = legacyState;
    }
    const customWords = normalizeCustomWords(
      saved?.customWords,
      library.id,
      new Set(baseWords.map((word) => word.id)),
    );
    words = [...baseWords, ...customWords];
    wordById = new Map(words.map((word) => [word.id, word]));
    state = normalizeState(saved) || createDefaultState();
    state.customWords = customWords;
    if (
      activeLibrary.dataVersion &&
      (saved?.dataVersion || 1) < activeLibrary.dataVersion
    ) {
      state.dataVersion = activeLibrary.dataVersion;
      state.round = 1;
      state.cursor = 0;
      state.queue = buildQueue(activeWords());
    }
    appState.libraries[library.id] = state;

    revealed = false;
    lastAction = null;
    historyOffset = 0;
    libraryStatus = "known";
    elements.searchInput.value = "";
    elements.customSearchInput.value = "";
    resetCustomWordForm();
    setRevealed(false);
    persist({ bumpRevision: !initial });
    closePanel();
    render();
  } catch (error) {
    window.alert(error.message || "词库加载失败，请刷新后重试。");
  } finally {
    loadingLibraryId = null;
  }
}

function scopeWords() {
  if (state.scope === "all") return words;
  if (state.scope === "custom") {
    return words.slice(state.rangeStart - 1, state.rangeEnd);
  }
  return words.filter((word) => wordScopeKey(word) === state.scope);
}

function activeWords() {
  let result = scopeWords();
  if (state.subgroupFilter !== "all") {
    result = result.filter(
      (word) => word.logicGroup === state.subgroupFilter,
    );
  }
  if (state.typeFilter !== "all") {
    result = result.filter(
      (word) => word.expressionType === state.typeFilter,
    );
  }
  return result;
}

function summarize(list = words, targetState = state) {
  const result = { unknown: 0, known: 0, mastered: 0, unseen: 0 };
  for (const word of list) {
    const status = targetState.statuses[word.id];
    if (validStatuses.has(status)) result[status] += 1;
    else result.unseen += 1;
  }
  return result;
}

function summarizeSavedLibrary(library) {
  const saved = appState.libraries[library.id];
  const customCount = Array.isArray(saved?.customWords)
    ? saved.customWords.length
    : 0;
  const total = library.count + customCount;
  const counts = {
    unknown: 0,
    known: 0,
    mastered: 0,
    unseen: total,
    total,
    customCount,
  };
  if (!saved?.statuses || typeof saved.statuses !== "object") return counts;
  for (const status of Object.values(saved.statuses)) {
    if (validStatuses.has(status)) counts[status] += 1;
  }
  counts.unseen = Math.max(
    total - counts.unknown - counts.known - counts.mastered,
    0,
  );
  return counts;
}

function shuffleItems(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [
      result[swapIndex],
      result[index],
    ];
  }
  return result;
}

function buildQueue(list) {
  const groups = { unknown: [], known: [], unseen: [] };
  for (const word of list) {
    const status = state.statuses[word.id];
    if (status === "mastered") continue;
    if (state.studyMode === "unknown" && status !== "unknown") continue;
    if (state.studyMode === "known" && status !== "known") continue;
    if (state.studyMode === "unseen" && validStatuses.has(status)) continue;
    if (status === "unknown") groups.unknown.push(word.id);
    else if (status === "known") groups.known.push(word.id);
    else groups.unseen.push(word.id);
  }

  const order = (items) => (state.shuffle ? shuffleItems(items) : items);
  return [
    ...order(groups.unknown),
    ...order(groups.known),
    ...order(groups.unseen),
  ];
}

function currentWord() {
  return wordById.get(state.queue[state.cursor - historyOffset]);
}

function setRevealed(nextValue) {
  const word = currentWord();
  const hasAnswer = Boolean(
    word?.equivalents || word?.pos || word?.example || word?.notes,
  );
  revealed = Boolean(nextValue && hasAnswer);
  elements.wordCard.classList.toggle("is-revealed", revealed);
  elements.wordCard.classList.toggle("has-no-answer", !hasAnswer);
  elements.answerArea.setAttribute("aria-hidden", String(!revealed));
  elements.revealButton.setAttribute("aria-expanded", String(revealed));
  elements.revealButton.classList.toggle("hidden", !hasAnswer);
  elements.revealLabel.textContent = revealed
    ? "收起补充"
    : `查看${activeLibrary?.answerLabel || "补充"}`;
}

function scopeDescription() {
  if (state.scope === "all") return "全部词表";
  if (state.scope === "custom") {
    return `第 ${state.rangeStart} 到 ${state.rangeEnd} 词`;
  }
  const selected = scopeOptions().find((item) => item.id === state.scope);
  let label = selected?.label || "当前范围";
  if (state.subgroupFilter !== "all") {
    const word = words.find(
      (item) => item.logicGroup === state.subgroupFilter,
    );
    if (word) label += `，${word.logicGroupLabel}`;
  }
  if (state.typeFilter !== "all") label += `，${state.typeFilter}`;
  return label;
}

function renderCardTags(word) {
  elements.cardTags.replaceChildren();
  const labels = [];
  if (word.isCustom) {
    labels.push("我添加的词");
  } else if (word.chapterName) {
    labels.push(word.logicGroupLabel);
    labels.push(`本词群 ${word.positionInGroup} / ${word.groupSize}`);
  } else if (word.part) {
    labels.push(word.topic, word.expressionType);
  }
  for (const text of labels.filter(Boolean)) {
    const tag = document.createElement("span");
    tag.textContent = text;
    elements.cardTags.append(tag);
  }
}

function render() {
  const active = activeWords();
  const activeSummary = summarize(active);
  const totalSummary = summarize();
  const displayIndex = state.cursor - historyOffset;
  const finished = state.cursor >= state.queue.length && historyOffset === 0;
  const remaining = Math.max(state.queue.length - state.cursor, 0);
  const sliderIndex = Math.min(
    Math.max(displayIndex, 0),
    Math.max(state.queue.length - 1, 0),
  );

  elements.currentLibraryName.textContent = activeLibrary.shortName;
  elements.brandSubtitle.textContent = `${words.length.toLocaleString("zh-CN")} 张词卡`;
  elements.roundLabel.textContent = `第 ${state.round} 轮`;
  elements.positionLabel.innerHTML = `${
    finished ? state.queue.length : Math.min(displayIndex + 1, state.queue.length)
  }<span> / ${state.queue.length}</span>`;
  elements.progressSlider.max = String(Math.max(state.queue.length - 1, 0));
  elements.progressSlider.value = String(sliderIndex);
  elements.progressSlider.disabled = state.queue.length <= 1;
  elements.progressSlider.style.setProperty(
    "--slider-progress",
    state.queue.length <= 1
      ? "0%"
      : `${(sliderIndex / (state.queue.length - 1)) * 100}%`,
  );
  elements.progressSlider.setAttribute(
    "aria-label",
    state.queue.length
      ? `拖动定位单词，当前第 ${sliderIndex + 1} 个，共 ${state.queue.length} 个`
      : "本轮没有待学单词",
  );
  elements.scopeLabel.textContent =
    state.studyMode === "all"
      ? scopeDescription()
      : `${scopeDescription()}，${studyModeLabels[state.studyMode]}`;
  elements.remainingCount.textContent = String(remaining);
  elements.masteredCount.textContent = String(totalSummary.mastered);
  elements.totalWordCount.textContent = String(words.length);
  elements.knownCount.textContent = String(totalSummary.known);
  elements.customWordCount.textContent = String(state.customWords.length);
  elements.libraryKnownCount.textContent = String(totalSummary.known);
  elements.libraryUnknownCount.textContent = String(totalSummary.unknown);
  elements.libraryMasteredCount.textContent = String(totalSummary.mastered);
  elements.statusLibraryName.textContent = activeLibrary.name;
  elements.shuffleToggle.classList.toggle("on", state.shuffle);
  elements.shuffleToggle.setAttribute("aria-pressed", String(state.shuffle));
  elements.undoButton.disabled = !lastAction;
  elements.summaryUndoButton.disabled = !lastAction;
  elements.previousButton.disabled = displayIndex <= 0;
  elements.forwardButton.disabled =
    state.queue.length === 0 ||
    (historyOffset === 0 && displayIndex >= state.queue.length - 1);
  elements.summaryPreviousButton.disabled = state.cursor === 0;
  elements.sourceNote.textContent = `${activeLibrary.sourceLabel}。${activeLibrary.description}。每套词库的进度分开保存。`;

  if (!finished && currentWord()) {
    const word = currentWord();
    elements.answerLabel.textContent = word.isCustom
      ? "同义词或补充"
      : activeLibrary.answerLabel;
    elements.studyView.classList.remove("hidden");
    elements.summaryView.classList.add("hidden");
    elements.dayLabel.textContent =
      word.scopeLabel ||
      `第 ${word.day} ${activeLibrary.groupLabel}`;
    renderCardTags(word);
    elements.wordText.textContent = word.word;
    elements.wordText.classList.toggle(
      "is-phrase",
      word.word.length > 24 || word.word.includes(" "),
    );
    const primaryAnswer = [word.pos, word.equivalents]
      .filter(Boolean)
      .join(" ");
    elements.equivalentsText.textContent = primaryAnswer;
    elements.answerPrimaryBlock.classList.toggle("hidden", !primaryAnswer);
    elements.meaningText.textContent = word.meaning;
    elements.usageText.textContent = word.usage || "";
    elements.usageArea.classList.toggle("hidden", !word.usage);
    elements.exampleText.textContent = word.example || "";
    elements.exampleBlock.classList.toggle("hidden", !word.example);
    elements.notesText.textContent = word.notes || "";
    elements.notesBlock.classList.toggle("hidden", !word.notes);
    elements.speakButton.setAttribute("aria-label", `朗读 ${word.word}`);
    setRevealed(revealed);
    for (const button of document.querySelectorAll(".decision-button")) {
      button.classList.toggle(
        "selected",
        button.dataset.status === state.statuses[word.id],
      );
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.status === state.statuses[word.id]),
      );
    }
  } else {
    elements.studyView.classList.add("hidden");
    elements.summaryView.classList.remove("hidden");
    const allMastered = active.length > 0 &&
      activeSummary.mastered === active.length;
    const modeCleared =
      (state.studyMode === "unknown" && activeSummary.unknown === 0) ||
      (state.studyMode === "known" && activeSummary.known === 0) ||
      (state.studyMode === "unseen" && activeSummary.unseen === 0);
    summaryNextMode = null;
    if (state.studyMode === "unknown" && modeCleared) summaryNextMode = "known";
    if (state.studyMode === "known" && modeCleared) summaryNextMode = "all";
    if (state.studyMode === "unseen" && modeCleared) summaryNextMode = "unknown";

    elements.summaryKicker.textContent =
      allMastered || modeCleared
        ? "当前练习已经完成"
        : `第 ${state.round} 轮完成`;
    elements.summaryTitle.textContent = allMastered
      ? "这组词已经清空"
      : modeCleared
        ? `${studyModeLabels[state.studyMode]}已经清空`
        : "休息一下，再过一轮";
    elements.summaryText.textContent = allMastered
      ? "完全熟悉的词不会再次出现。你可以切换词库或学习范围，原来的进度不会丢失。"
      : modeCleared
        ? state.studyMode === "unknown"
          ? "你已经把这批不认识的词移到了认识或完全熟悉。现在可以接着刷认识的词。"
          : "当前模式中已经没有待刷词。你可以切换复习模式继续学习。"
        : state.studyMode === "all"
          ? `下一轮先看 ${activeSummary.unknown} 个不认识的词，再看 ${activeSummary.known} 个认识的词。`
          : `下一轮继续复习 ${studyModeLabels[state.studyMode]}的词。`;
    elements.summaryUnknown.textContent = String(activeSummary.unknown);
    elements.summaryKnown.textContent = String(activeSummary.known);
    elements.summaryMastered.textContent = String(activeSummary.mastered);
    elements.nextRoundButton.classList.toggle(
      "hidden",
      allMastered && !summaryNextMode,
    );
    elements.nextRoundLabel.textContent = summaryNextMode
      ? summaryNextMode === "known"
        ? "接着刷认识的词"
        : summaryNextMode === "unknown"
          ? "接着刷不认识的词"
          : "回到全部未掌握"
      : `开始第 ${state.round + 1} 轮`;
  }

  if (!elements.panelBackdrop.classList.contains("hidden")) renderPanel();
}

function classify(status) {
  const word = currentWord();
  if (!word || !validStatuses.has(status)) return;
  lastAction = {
    id: word.id,
    previousStatus: state.statuses[word.id],
    cursor: state.cursor,
    historyOffset,
  };
  state.statuses[word.id] = status;
  if (historyOffset > 0) historyOffset -= 1;
  else state.cursor += 1;
  setRevealed(false);
  persist();
  render();
}

function undo() {
  if (!lastAction) return;
  if (lastAction.previousStatus) {
    state.statuses[lastAction.id] = lastAction.previousStatus;
  } else {
    delete state.statuses[lastAction.id];
  }
  state.cursor = lastAction.cursor;
  historyOffset = lastAction.historyOffset;
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function startNextRound() {
  if (summaryNextMode) {
    changeStudyMode(summaryNextMode);
    return;
  }
  state.round += 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function changeScope(scope, keepPanelOpen = false) {
  if (!validScopes().has(scope)) return;
  state.scope = scope;
  state.subgroupFilter = "all";
  state.typeFilter = "all";
  state.round = 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  setRevealed(false);
  persist();
  if (!keepPanelOpen) closePanel();
  render();
}

function changeStudyMode(mode) {
  if (!validStudyModes.has(mode)) return;
  state.studyMode = mode;
  state.round = 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  summaryNextMode = null;
  setRevealed(false);
  persist();
  closePanel();
  render();
}

function changeSubgroup(subgroup) {
  if (!validSubgroups().has(subgroup)) return;
  state.subgroupFilter = subgroup;
  state.round = 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function changeTypeFilter(type) {
  if (!validExpressionTypes().has(type)) return;
  state.typeFilter = type;
  state.round = 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function statusMatchesMode(status) {
  if (state.studyMode === "all") return status !== "mastered";
  if (state.studyMode === "unseen") return !validStatuses.has(status);
  return status === state.studyMode;
}

function changeLibraryStatus(id, status) {
  if (
    !wordById.has(id) ||
    (status !== "unseen" && !validStatuses.has(status))
  ) {
    return;
  }
  const previousStatus = state.statuses[id];
  if (status === "unseen") delete state.statuses[id];
  else state.statuses[id] = status;
  const nextStatus = state.statuses[id];
  const removedIndex = state.queue.indexOf(id);
  if (!statusMatchesMode(nextStatus)) {
    state.queue = state.queue.filter((queueId) => queueId !== id);
    if (removedIndex !== -1 && removedIndex < state.cursor) {
      state.cursor = Math.max(0, state.cursor - 1);
    }
  } else if (
    !statusMatchesMode(previousStatus) &&
    !state.queue.includes(id) &&
    activeWords().some((word) => word.id === id)
  ) {
    state.queue.push(id);
  }
  persist();
  render();
}

function goPrevious() {
  const displayIndex = state.cursor - historyOffset;
  if (displayIndex <= 0) return;
  historyOffset += 1;
  setRevealed(true);
  render();
}

function goForward() {
  const displayIndex = state.cursor - historyOffset;
  if (historyOffset > 0) {
    historyOffset -= 1;
  } else if (displayIndex < state.queue.length - 1) {
    state.cursor += 1;
  } else {
    return;
  }
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function goToQueueIndex(index) {
  if (!state.queue.length) return;
  const target = Math.min(Math.max(index, 0), state.queue.length - 1);
  if (target <= state.cursor) {
    historyOffset = state.cursor - target;
  } else {
    state.cursor = target;
    historyOffset = 0;
  }
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function openPanel(type) {
  elements.panelBackdrop.classList.remove("hidden");
  elements.catalogPanel.classList.toggle("hidden", type !== "catalog");
  elements.libraryPanel.classList.toggle("hidden", type !== "library");
  elements.customWordsPanel.classList.toggle("hidden", type !== "custom");
  elements.settingsPanel.classList.toggle("hidden", type !== "settings");
  const labels = {
    catalog: ["学习词库", "选择一套词库"],
    library: ["学习状态", "查看本词库状态"],
    custom: ["我的词", "添加和管理自己的词"],
    settings: ["学习设置", "设置本轮范围"],
  };
  elements.panelKicker.textContent = labels[type][0];
  elements.panelTitle.textContent = labels[type][1];
  elements.sidePanel.setAttribute("aria-label", labels[type][1]);
  renderPanel();
}

function closePanel() {
  elements.panelBackdrop.classList.add("hidden");
}

function renderPanel() {
  if (!elements.catalogPanel.classList.contains("hidden")) renderCatalog();
  if (!elements.libraryPanel.classList.contains("hidden")) renderLibrary();
  if (!elements.customWordsPanel.classList.contains("hidden")) {
    renderCustomWords();
  }
  if (!elements.settingsPanel.classList.contains("hidden")) renderSettings();
}

function renderCatalog() {
  elements.catalogList.replaceChildren();
  for (const library of libraries) {
    const counts = summarizeSavedLibrary(library);
    const seen = counts.total - counts.unseen;
    const percent = counts.total
      ? Math.round((counts.mastered / counts.total) * 100)
      : 0;
    const button = document.createElement("button");
    button.className = "catalog-card";
    button.classList.toggle("active", library.id === activeLibrary.id);
    button.disabled = loadingLibraryId === library.id;

    const top = document.createElement("div");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = library.name;
    const description = document.createElement("small");
    description.textContent = library.description;
    copy.append(title, description);
    const action = document.createElement("i");
    action.textContent =
      library.id === activeLibrary.id ? "正在学习" : seen ? "继续" : "开始";
    top.append(copy, action);

    const track = document.createElement("span");
    track.className = "catalog-progress";
    const fill = document.createElement("span");
    fill.style.width = `${percent}%`;
    track.append(fill);

    const detail = document.createElement("span");
    detail.className = "catalog-detail";
    const customDetail = counts.customCount
      ? `，我的词 ${counts.customCount}`
      : "";
    detail.textContent = `共 ${counts.total}，已看 ${seen}，完全熟悉 ${counts.mastered}${customDetail}，进度 ${percent}%`;

    button.append(top, track, detail);
    button.addEventListener("click", () => activateLibrary(library.id));
    elements.catalogList.append(button);
  }
}

function renderLibrary() {
  elements.statusLibraryName.textContent = activeLibrary.name;
  for (const button of elements.libraryTabs.querySelectorAll("button")) {
    button.classList.toggle(
      "active",
      button.dataset.libraryStatus === libraryStatus,
    );
  }
  elements.statusStudyButton.classList.toggle(
    "hidden",
    libraryStatus === "mastered",
  );
  elements.statusStudyButton.textContent =
    libraryStatus === "unknown" ? "只刷不认识的词" : "只刷认识的词";

  const query = elements.searchInput.value.trim().toLowerCase();
  const matchingWords = words.filter((word) => {
    if (state.statuses[word.id] !== libraryStatus) return false;
    if (!query) return true;
    return (
      word.word.toLowerCase().includes(query) ||
      word.equivalents.toLowerCase().includes(query) ||
      word.meaning.toLowerCase().includes(query) ||
      (word.topic || "").toLowerCase().includes(query) ||
      (word.expressionType || "").toLowerCase().includes(query) ||
      (word.chapterName || "").toLowerCase().includes(query)
    );
  });

  elements.libraryList.replaceChildren();
  if (!matchingWords.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    const number = document.createElement("span");
    number.textContent = "0";
    const message = document.createElement("p");
    message.textContent = "这里还没有单词";
    empty.append(number, message);
    elements.libraryList.append(empty);
    return;
  }

  for (const word of matchingWords) {
    const row = document.createElement("article");
    row.className = "library-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = word.word;
    const equivalents = document.createElement("p");
    equivalents.textContent = word.equivalents;
    equivalents.classList.toggle("hidden", !word.equivalents);
    const meaning = document.createElement("small");
    meaning.textContent = word.meaning;
    copy.append(title, equivalents, meaning);

    const select = document.createElement("select");
    select.setAttribute("aria-label", `修改 ${word.word} 的状态`);
    for (const [value, label] of [
      ["unknown", "不认识"],
      ["known", "认识"],
      ["mastered", "完全熟悉"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    select.value = state.statuses[word.id];
    select.addEventListener("change", () =>
      changeLibraryStatus(word.id, select.value),
    );
    row.append(copy, select);
    elements.libraryList.append(row);
  }
}

function setCustomFormMessage(message = "", kind = "success") {
  elements.customFormMessage.textContent = message;
  elements.customFormMessage.classList.toggle("hidden", !message);
  elements.customFormMessage.classList.toggle("error", kind === "error");
}

function resetCustomWordForm(message = "") {
  elements.customWordForm.reset();
  elements.customWordId.value = "";
  elements.customSaveButton.textContent = "添加到当前词库";
  elements.customCancelButton.classList.add("hidden");
  setCustomFormMessage(message);
}

function editCustomWord(id) {
  const word = wordById.get(id);
  if (!word?.isCustom) return;
  elements.customWordId.value = word.id;
  elements.customWordInput.value = word.word;
  elements.customMeaningInput.value = word.meaning;
  elements.customExtraInput.value = word.equivalents;
  elements.customSaveButton.textContent = "保存修改";
  elements.customCancelButton.classList.remove("hidden");
  setCustomFormMessage();
  elements.customWordInput.focus();
  elements.customWordForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveCustomWord(event) {
  event.preventDefault();
  const editingId = elements.customWordId.value;
  const wordText = cleanCustomText(elements.customWordInput.value, 120);
  const meaning = cleanCustomText(elements.customMeaningInput.value, 500);
  const equivalents = cleanCustomText(elements.customExtraInput.value, 500);

  if (!wordText || !meaning) {
    setCustomFormMessage("请填写单词和中文意思。", "error");
    return;
  }
  const duplicate = words.find(
    (word) =>
      word.id !== editingId &&
      word.word.trim().toLocaleLowerCase() ===
        wordText.toLocaleLowerCase(),
  );
  if (duplicate) {
    setCustomFormMessage(
      `“${duplicate.word}”已经在当前词库里。`,
      "error",
    );
    return;
  }

  if (editingId) {
    const previous = wordById.get(editingId);
    if (!previous?.isCustom) return;
    const updated = {
      ...previous,
      word: wordText,
      meaning,
      equivalents,
      updatedAt: Date.now(),
    };
    words = words.map((word) => (word.id === editingId ? updated : word));
    state.customWords = state.customWords.map((word) =>
      word.id === editingId ? updated : word,
    );
    wordById.set(editingId, updated);
    resetCustomWordForm("修改已保存。");
  } else {
    if (state.customWords.length >= MAX_CUSTOM_WORDS) {
      setCustomFormMessage(
        `每套词库最多可以添加 ${MAX_CUSTOM_WORDS} 个词。`,
        "error",
      );
      return;
    }
    const now = Date.now();
    const customWord = {
      id: createCustomWordId(),
      day: 9999,
      word: wordText,
      equivalents,
      meaning,
      scope: CUSTOM_SCOPE,
      scopeLabel: "我的添加",
      scopeOrder: 9999,
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    };
    const previousLength = words.length;
    words = [...words, customWord];
    state.customWords = [...state.customWords, customWord];
    wordById.set(customWord.id, customWord);
    if (state.scope === "custom" && state.rangeEnd === previousLength) {
      state.rangeEnd = words.length;
    }
    if (
      statusMatchesMode(undefined) &&
      activeWords().some((word) => word.id === customWord.id) &&
      !state.queue.includes(customWord.id)
    ) {
      state.queue.push(customWord.id);
    }
    resetCustomWordForm("已添加，并进入当前词库的学习队列。");
  }
  persist();
  render();
}

function deleteCustomWord(id) {
  const word = wordById.get(id);
  if (
    !word?.isCustom ||
    !window.confirm(`确定删除“${word.word}”吗？它的学习状态也会一起删除。`)
  ) {
    return;
  }

  const queueIndex = state.queue.indexOf(id);
  words = words.filter((item) => item.id !== id);
  state.customWords = state.customWords.filter((item) => item.id !== id);
  state.queue = state.queue.filter((queueId) => queueId !== id);
  delete state.statuses[id];
  wordById.delete(id);
  if (queueIndex !== -1 && queueIndex < state.cursor) {
    state.cursor = Math.max(0, state.cursor - 1);
  }
  state.cursor = Math.min(state.cursor, state.queue.length);
  historyOffset = Math.min(historyOffset, state.cursor);
  if (state.scope === CUSTOM_SCOPE && !state.customWords.length) {
    state.scope = "all";
    state.queue = buildQueue(activeWords());
    state.cursor = 0;
    historyOffset = 0;
  }
  state.rangeEnd = Math.min(Math.max(state.rangeEnd, 1), words.length);
  state.rangeStart = Math.min(
    Math.max(state.rangeStart, 1),
    state.rangeEnd,
  );
  if (lastAction?.id === id) lastAction = null;
  if (elements.customWordId.value === id) {
    resetCustomWordForm(`已删除“${word.word}”。`);
  } else {
    setCustomFormMessage(`已删除“${word.word}”。`);
  }
  setRevealed(false);
  persist();
  render();
}

function renderCustomWords() {
  elements.customLibraryName.textContent = activeLibrary.name;
  elements.customWordCount.textContent = String(state.customWords.length);
  elements.customListCount.textContent =
    `${state.customWords.length.toLocaleString("zh-CN")} 个`;
  const query = elements.customSearchInput.value.trim().toLocaleLowerCase();
  const matchingWords = [...state.customWords]
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter(
      (word) =>
        !query ||
        word.word.toLocaleLowerCase().includes(query) ||
        word.meaning.toLocaleLowerCase().includes(query) ||
        word.equivalents.toLocaleLowerCase().includes(query),
    );

  elements.customWordList.replaceChildren();
  if (!matchingWords.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    const number = document.createElement("span");
    number.textContent = query ? "0" : "+";
    const message = document.createElement("p");
    message.textContent = query
      ? "没有找到匹配的词"
      : "还没有自己添加的词";
    empty.append(number, message);
    elements.customWordList.append(empty);
    return;
  }

  for (const word of matchingWords) {
    const row = document.createElement("article");
    row.className = "custom-word-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = word.word;
    const meaning = document.createElement("p");
    meaning.textContent = word.meaning;
    copy.append(title, meaning);
    if (word.equivalents) {
      const extra = document.createElement("small");
      extra.textContent = word.equivalents;
      copy.append(extra);
    }

    const controls = document.createElement("div");
    controls.className = "custom-word-controls";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `修改 ${word.word} 的状态`);
    for (const [value, label] of [
      ["unseen", "未看过"],
      ["unknown", "不认识"],
      ["known", "认识"],
      ["mastered", "完全熟悉"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.append(option);
    }
    select.value = state.statuses[word.id] || "unseen";
    select.addEventListener("change", () =>
      changeLibraryStatus(word.id, select.value),
    );

    const actions = document.createElement("div");
    actions.className = "custom-row-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "修改";
    editButton.addEventListener("click", () => editCustomWord(word.id));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteCustomWord(word.id));
    actions.append(editButton, deleteButton);
    controls.append(select, actions);
    row.append(copy, controls);
    elements.customWordList.append(row);
  }
}

function renderSettings() {
  const counts = summarize(activeWords());
  const modeCounts = {
    all: counts.unknown + counts.known + counts.unseen,
    unknown: counts.unknown,
    known: counts.known,
    unseen: counts.unseen,
  };

  elements.modeList.replaceChildren();
  for (const mode of ["all", "unknown", "known", "unseen"]) {
    const button = document.createElement("button");
    button.classList.toggle("active", state.studyMode === mode);
    const label = document.createElement("span");
    label.textContent = studyModeLabels[mode];
    const count = document.createElement("i");
    count.textContent = `${modeCounts[mode].toLocaleString("zh-CN")} 词`;
    button.append(label, count);
    button.addEventListener("click", () => changeStudyMode(mode));
    elements.modeList.append(button);
  }

  elements.scopeList.replaceChildren();
  const scopes = [
    {
      id: "all",
      label: `全部 ${words.length.toLocaleString("zh-CN")} 词`,
    },
    ...scopeOptions().map((scope) => ({
      ...scope,
      label: `${scope.label}，${scope.count.toLocaleString("zh-CN")} 词`,
    })),
  ];
  let lastPart = "";
  for (const scope of scopes) {
    if (
      activeLibrary.scopeStyle === "writing" &&
      scope.id === CUSTOM_SCOPE
    ) {
      const heading = document.createElement("div");
      heading.className = "scope-heading";
      heading.textContent = "我的词";
      elements.scopeList.append(heading);
      lastPart = "";
    }
    if (
      activeLibrary.scopeStyle === "writing" &&
      scope.part &&
      scope.part !== lastPart
    ) {
      const heading = document.createElement("div");
      heading.className = "scope-heading";
      heading.textContent = scope.part;
      elements.scopeList.append(heading);
      lastPart = scope.part;
    }
    const button = document.createElement("button");
    button.classList.toggle("active", state.scope === scope.id);
    const label = document.createElement("span");
    label.textContent = scope.label;
    const check = document.createElement("i");
    check.textContent = state.scope === scope.id ? "✓" : "";
    button.append(label, check);
    button.addEventListener("click", () =>
      changeScope(
        scope.id,
        activeLibrary.scopeStyle === "bible" ||
          activeLibrary.scopeStyle === "writing",
      ),
    );
    elements.scopeList.append(button);
  }

  const showSubgroups =
    activeLibrary.scopeStyle === "bible" &&
    state.scope !== "all" &&
    state.scope !== "custom" &&
    scopeWords().some((word) => word.logicGroup);
  elements.subgroupSection.classList.toggle("hidden", !showSubgroups);
  elements.subgroupList.replaceChildren();
  if (showSubgroups) {
    const groups = new Map();
    for (const word of scopeWords()) {
      if (!word.logicGroup) continue;
      const existing = groups.get(word.logicGroup);
      if (existing) existing.count += 1;
      else {
        groups.set(word.logicGroup, {
          id: word.logicGroup,
          label: word.logicGroupLabel,
          order: word.logicGroupNumber,
          count: 1,
        });
      }
    }
    const subgroupOptions = [
      {
        id: "all",
        label: `本章全部词群，${scopeWords().length.toLocaleString("zh-CN")} 词`,
      },
      ...[...groups.values()]
        .sort((left, right) => left.order - right.order)
        .map((group) => ({
          id: group.id,
          label: `${group.label}，${group.count} 词`,
        })),
    ];
    for (const subgroup of subgroupOptions) {
      const button = document.createElement("button");
      button.classList.toggle("active", state.subgroupFilter === subgroup.id);
      const label = document.createElement("span");
      label.textContent = subgroup.label;
      const check = document.createElement("i");
      check.textContent = state.subgroupFilter === subgroup.id ? "✓" : "";
      button.append(label, check);
      button.addEventListener("click", () => changeSubgroup(subgroup.id));
      elements.subgroupList.append(button);
    }
  }

  const showTypes =
    activeLibrary.scopeStyle === "writing" &&
    state.scope !== CUSTOM_SCOPE;
  elements.typeSection.classList.toggle("hidden", !showTypes);
  elements.typeList.replaceChildren();
  if (showTypes) {
    const typeCounts = new Map();
    for (const word of scopeWords()) {
      const type = word.expressionType || "其他";
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }
    const typeOptions = [
      {
        id: "all",
        label: `全部表达类型，${scopeWords().length.toLocaleString("zh-CN")} 词`,
      },
      ...[...typeCounts.entries()].map(([type, count]) => ({
        id: type,
        label: `${type}，${count} 词`,
      })),
    ];
    for (const type of typeOptions) {
      const button = document.createElement("button");
      button.classList.toggle("active", state.typeFilter === type.id);
      const label = document.createElement("span");
      label.textContent = type.label;
      const check = document.createElement("i");
      check.textContent = state.typeFilter === type.id ? "✓" : "";
      button.append(label, check);
      button.addEventListener("click", () => changeTypeFilter(type.id));
      elements.typeList.append(button);
    }
  }

  elements.rangeStartInput.value = String(state.rangeStart);
  elements.rangeEndInput.value = String(state.rangeEnd);
  elements.rangeStartInput.max = String(words.length);
  elements.rangeEndInput.max = String(words.length);
  elements.applyRangeButton.classList.toggle("active", state.scope === "custom");
  elements.applyRangeButton.textContent =
    state.scope === "custom" ? "正在使用这个范围" : "使用这个范围";
}

function applyCustomRange() {
  const rawStart = Number.parseInt(elements.rangeStartInput.value, 10);
  const rawEnd = Number.parseInt(elements.rangeEndInput.value, 10);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
    window.alert("请填写开始和结束位置。");
    return;
  }
  const start = Math.min(Math.max(rawStart, 1), words.length);
  const end = Math.min(Math.max(rawEnd, 1), words.length);
  state.rangeStart = Math.min(start, end);
  state.rangeEnd = Math.max(start, end);
  state.scope = "custom";
  state.subgroupFilter = "all";
  state.typeFilter = "all";
  state.round = 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  setRevealed(false);
  persist();
  closePanel();
  render();
}

function exportProgress() {
  persist();
  const blob = new Blob([JSON.stringify(appState, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `word-progress-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

elements.brandButton.addEventListener("click", () => openPanel("catalog"));
elements.vocabularyButton.addEventListener("click", () => openPanel("catalog"));
elements.customWordsButton.addEventListener("click", () => openPanel("custom"));
elements.libraryButton.addEventListener("click", () => openPanel("library"));
elements.settingsButton.addEventListener("click", () => openPanel("settings"));
elements.scopeButton.addEventListener("click", () => openPanel("settings"));
elements.closePanelButton.addEventListener("click", closePanel);
elements.panelBackdrop.addEventListener("mousedown", (event) => {
  if (event.target === elements.panelBackdrop) closePanel();
});
elements.revealButton.addEventListener("click", () => setRevealed(!revealed));
elements.speakButton.addEventListener("click", () => {
  const word = currentWord();
  if (!word || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word.word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
});
for (const button of document.querySelectorAll(".decision-button")) {
  button.addEventListener("click", () => classify(button.dataset.status));
}
elements.undoButton.addEventListener("click", undo);
elements.summaryUndoButton.addEventListener("click", undo);
elements.previousButton.addEventListener("click", goPrevious);
elements.forwardButton.addEventListener("click", goForward);
elements.progressSlider.addEventListener("input", () =>
  goToQueueIndex(Number(elements.progressSlider.value)),
);
elements.summaryPreviousButton.addEventListener("click", goPrevious);
elements.nextRoundButton.addEventListener("click", startNextRound);
elements.applyRangeButton.addEventListener("click", applyCustomRange);
elements.shuffleToggle.addEventListener("click", () => {
  state.shuffle = !state.shuffle;
  persist();
  render();
});
elements.libraryTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-library-status]");
  if (!button) return;
  libraryStatus = button.dataset.libraryStatus;
  renderLibrary();
});
elements.statusStudyButton.addEventListener("click", () => {
  if (libraryStatus === "unknown" || libraryStatus === "known") {
    changeStudyMode(libraryStatus);
  }
});
elements.searchInput.addEventListener("input", renderLibrary);
elements.customWordForm.addEventListener("submit", saveCustomWord);
elements.customCancelButton.addEventListener("click", () =>
  resetCustomWordForm(),
);
elements.customSearchInput.addEventListener("input", renderCustomWords);
elements.exportButton.addEventListener("click", exportProgress);
elements.importButton.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", async () => {
  const file = elements.importInput.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    const importedAppState = normalizeAppStateContainer(imported);
    if (importedAppState) {
      importedAppState.revision =
        Math.max(appState.revision, importedAppState.revision) + 1;
      appState = importedAppState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } else {
      const importedState = normalizeState(imported);
      if (!importedState) throw new Error("invalid");
      appState.libraries[activeLibrary.id] = importedState;
      appState.revision += 1;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    }
    await syncCloudNow(appState);
    window.location.reload();
  } catch {
    window.alert("这个文件不是有效的进度备份。");
  } finally {
    elements.importInput.value = "";
  }
});
elements.resetButton.addEventListener("click", async () => {
  if (
    !window.confirm(
      "确定清空全部词库的学习进度和你添加的词吗？这一步不能撤销。",
    )
  ) {
    return;
  }
  window.clearTimeout(cloudSaveTimer);
  if (canUseCloud()) {
    try {
      await fetch("/api/progress", { method: "DELETE" });
    } catch {
      // The local reset still goes ahead when account sync is unavailable.
    }
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  window.location.reload();
});
window.addEventListener("keydown", (event) => {
  const panelOpen = !elements.panelBackdrop.classList.contains("hidden");
  const target = event.target;
  if (
    panelOpen ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target?.tagName === "INPUT" ||
    target?.tagName === "SELECT"
  ) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    setRevealed(!revealed);
  } else if (event.key === "1") classify("unknown");
  else if (event.key === "2") classify("known");
  else if (event.key === "3") classify("mastered");
  else if (event.key === "ArrowLeft") goPrevious();
  else if (event.key === "ArrowRight") goForward();
  else if (event.key.toLowerCase() === "z") undo();
});

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  elements.installButton.classList.remove("hidden");
});
elements.installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  elements.installButton.classList.add("hidden");
});

await loadCloudState();
await activateLibrary(appState.activeLibraryId, { initial: true });
elements.loadingView.classList.add("hidden");
elements.appView.classList.remove("hidden");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
