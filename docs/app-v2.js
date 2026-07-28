const STORAGE_KEY = "word-fast-pass-pages-v2";
const LEGACY_STORAGE_KEY = "gre-fast-pass-pages-v1";
const validStatuses = new Set(["unknown", "known", "mastered"]);

const elements = Object.fromEntries(
  [
    "loadingView",
    "appView",
    "brandButton",
    "brandSubtitle",
    "vocabularyButton",
    "currentLibraryName",
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
    "speakButton",
    "wordText",
    "revealButton",
    "revealLabel",
    "answerArea",
    "answerLabel",
    "equivalentsText",
    "meaningText",
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
    "libraryTabs",
    "libraryKnownCount",
    "libraryUnknownCount",
    "libraryMasteredCount",
    "searchInput",
    "libraryList",
    "scopeList",
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

function loadAppState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      saved?.version === 2 &&
      saved.libraries &&
      typeof saved.libraries === "object"
    ) {
      return {
        version: 2,
        activeLibraryId: libraryById.has(saved.activeLibraryId)
          ? saved.activeLibraryId
          : libraries[0].id,
        libraries: saved.libraries,
      };
    }
  } catch {
    // A damaged record is ignored. Other browser data is not touched.
  }

  return {
    version: 2,
    activeLibraryId: legacyState ? "gre-equivalents" : libraries[0].id,
    libraries: {},
  };
}

let appState = loadAppState();
let activeLibrary = null;
let words = [];
let wordById = new Map();
let state = null;
let revealed = false;
let lastAction = null;
let libraryStatus = "known";
let historyOffset = 0;
let loadingLibraryId = null;

function groupNumbers() {
  return [...new Set(words.map((word) => word.day))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function validScopes() {
  return new Set([
    "all",
    "custom",
    ...groupNumbers().map((group) => String(group)),
  ]);
}

function createDefaultState() {
  return {
    version: 2,
    round: 1,
    statuses: {},
    scope: "all",
    rangeStart: 1,
    rangeEnd: words.length,
    queue: words.map((word) => word.id),
    cursor: 0,
    shuffle: false,
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
  const rawStart = Number.isInteger(value.rangeStart) ? value.rangeStart : 1;
  const rawEnd = Number.isInteger(value.rangeEnd)
    ? value.rangeEnd
    : words.length;
  const start = Math.min(Math.max(rawStart, 1), words.length);
  const end = Math.min(Math.max(rawEnd, 1), words.length);

  if (!queue.length && !Object.keys(statuses).length) return null;

  return {
    version: 2,
    round:
      Number.isInteger(value.round) && value.round > 0 ? value.round : 1,
    statuses,
    scope,
    rangeStart: Math.min(start, end),
    rangeEnd: Math.max(start, end),
    queue,
    cursor: Math.min(
      Math.max(Number.isInteger(value.cursor) ? value.cursor : 0, 0),
      queue.length,
    ),
    shuffle: Boolean(value.shuffle),
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

function persist() {
  if (activeLibrary && state) {
    appState.activeLibraryId = activeLibrary.id;
    appState.libraries[activeLibrary.id] = state;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  elements.saveStatus.textContent = "所有词库进度已保存在此浏览器";
  elements.saveStatus.className = "footer-save sync-saved";
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
    words = nextWords;
    wordById = new Map(words.map((word) => [word.id, word]));

    let saved = appState.libraries[library.id];
    if (
      !saved &&
      library.id === "gre-equivalents" &&
      legacyState
    ) {
      saved = legacyState;
    }
    state = normalizeState(saved) || createDefaultState();
    appState.libraries[library.id] = state;

    revealed = false;
    lastAction = null;
    historyOffset = 0;
    libraryStatus = "known";
    elements.searchInput.value = "";
    setRevealed(false);
    persist();
    closePanel();
    render();
  } catch (error) {
    window.alert(error.message || "词库加载失败，请刷新后重试。");
  } finally {
    loadingLibraryId = null;
  }
}

function activeWords() {
  if (state.scope === "all") return words;
  if (state.scope === "custom") {
    return words.slice(state.rangeStart - 1, state.rangeEnd);
  }
  return words.filter((word) => word.day === Number(state.scope));
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
  const counts = { unknown: 0, known: 0, mastered: 0, unseen: library.count };
  if (!saved?.statuses || typeof saved.statuses !== "object") return counts;
  for (const status of Object.values(saved.statuses)) {
    if (validStatuses.has(status)) counts[status] += 1;
  }
  counts.unseen = Math.max(
    library.count - counts.unknown - counts.known - counts.mastered,
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
  const hasAnswer = Boolean(currentWord()?.equivalents);
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
  return `第 ${state.scope} ${activeLibrary.groupLabel}`;
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
  elements.scopeLabel.textContent = scopeDescription();
  elements.remainingCount.textContent = String(remaining);
  elements.masteredCount.textContent = String(totalSummary.mastered);
  elements.totalWordCount.textContent = String(words.length);
  elements.knownCount.textContent = String(totalSummary.known);
  elements.libraryKnownCount.textContent = String(totalSummary.known);
  elements.libraryUnknownCount.textContent = String(totalSummary.unknown);
  elements.libraryMasteredCount.textContent = String(totalSummary.mastered);
  elements.shuffleToggle.classList.toggle("on", state.shuffle);
  elements.shuffleToggle.setAttribute("aria-pressed", String(state.shuffle));
  elements.undoButton.disabled = !lastAction;
  elements.summaryUndoButton.disabled = !lastAction;
  elements.previousButton.disabled = displayIndex <= 0;
  elements.forwardButton.disabled =
    state.queue.length === 0 ||
    (historyOffset === 0 && displayIndex >= state.queue.length - 1);
  elements.summaryPreviousButton.disabled = state.cursor === 0;
  elements.answerLabel.textContent = activeLibrary.answerLabel;
  elements.sourceNote.textContent = `${activeLibrary.sourceLabel}。${activeLibrary.description}。每套词库的进度分开保存。`;

  if (!finished && currentWord()) {
    const word = currentWord();
    elements.studyView.classList.remove("hidden");
    elements.summaryView.classList.add("hidden");
    elements.dayLabel.textContent = `第 ${word.day} ${activeLibrary.groupLabel}`;
    elements.wordText.textContent = word.word;
    elements.wordText.classList.toggle(
      "is-phrase",
      word.word.length > 24 || word.word.includes(" "),
    );
    elements.equivalentsText.textContent = word.equivalents;
    elements.meaningText.textContent = word.meaning;
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
    elements.summaryKicker.textContent = allMastered
      ? "已经全部掌握"
      : `第 ${state.round} 轮完成`;
    elements.summaryTitle.textContent = allMastered
      ? "这组词已经清空"
      : "休息一下，再过一轮";
    elements.summaryText.textContent = allMastered
      ? "完全熟悉的词不会再次出现。你可以切换词库或学习范围，原来的进度不会丢失。"
      : `下一轮先看 ${activeSummary.unknown} 个不认识的词，再看 ${activeSummary.known} 个认识的词。`;
    elements.summaryUnknown.textContent = String(activeSummary.unknown);
    elements.summaryKnown.textContent = String(activeSummary.known);
    elements.summaryMastered.textContent = String(activeSummary.mastered);
    elements.nextRoundButton.classList.toggle("hidden", allMastered);
    elements.nextRoundLabel.textContent = `开始第 ${state.round + 1} 轮`;
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
  state.round += 1;
  state.queue = buildQueue(activeWords());
  state.cursor = 0;
  historyOffset = 0;
  lastAction = null;
  setRevealed(false);
  persist();
  render();
}

function changeScope(scope) {
  if (!validScopes().has(scope)) return;
  state.scope = scope;
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

function changeLibraryStatus(id, status) {
  if (!wordById.has(id) || !validStatuses.has(status)) return;
  const previousStatus = state.statuses[id];
  state.statuses[id] = status;
  const removedIndex = state.queue.indexOf(id);
  if (status === "mastered") {
    state.queue = state.queue.filter((queueId) => queueId !== id);
    if (removedIndex !== -1 && removedIndex < state.cursor) {
      state.cursor = Math.max(0, state.cursor - 1);
    }
  } else if (
    previousStatus === "mastered" &&
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
  elements.settingsPanel.classList.toggle("hidden", type !== "settings");
  const labels = {
    catalog: ["学习词库", "选择一套词库"],
    library: ["学习状态", "查看本词库状态"],
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
  if (!elements.settingsPanel.classList.contains("hidden")) renderSettings();
}

function renderCatalog() {
  elements.catalogList.replaceChildren();
  for (const library of libraries) {
    const counts = summarizeSavedLibrary(library);
    const seen = library.count - counts.unseen;
    const percent = Math.round((counts.mastered / library.count) * 100);
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
    detail.textContent = `已看 ${seen}，完全熟悉 ${counts.mastered}，进度 ${percent}%`;

    button.append(top, track, detail);
    button.addEventListener("click", () => activateLibrary(library.id));
    elements.catalogList.append(button);
  }
}

function renderLibrary() {
  for (const button of elements.libraryTabs.querySelectorAll("button")) {
    button.classList.toggle(
      "active",
      button.dataset.libraryStatus === libraryStatus,
    );
  }

  const query = elements.searchInput.value.trim().toLowerCase();
  const matchingWords = words.filter((word) => {
    if (state.statuses[word.id] !== libraryStatus) return false;
    if (!query) return true;
    return (
      word.word.toLowerCase().includes(query) ||
      word.equivalents.toLowerCase().includes(query) ||
      word.meaning.toLowerCase().includes(query)
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

function renderSettings() {
  elements.scopeList.replaceChildren();
  const scopes = [
    {
      id: "all",
      label: `全部 ${words.length.toLocaleString("zh-CN")} 词`,
    },
    ...groupNumbers().map((group) => {
      const count = words.filter((word) => word.day === group).length;
      return {
        id: String(group),
        label: `第 ${group} ${activeLibrary.groupLabel}，${count} 词`,
      };
    }),
  ];
  for (const scope of scopes) {
    const button = document.createElement("button");
    button.classList.toggle("active", state.scope === scope.id);
    const label = document.createElement("span");
    label.textContent = scope.label;
    const check = document.createElement("i");
    check.textContent = state.scope === scope.id ? "✓" : "";
    button.append(label, check);
    button.addEventListener("click", () => changeScope(scope.id));
    elements.scopeList.append(button);
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
elements.searchInput.addEventListener("input", renderLibrary);
elements.exportButton.addEventListener("click", exportProgress);
elements.importButton.addEventListener("click", () => elements.importInput.click());
elements.importInput.addEventListener("change", async () => {
  const file = elements.importInput.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (
      imported?.version === 2 &&
      imported.libraries &&
      typeof imported.libraries === "object"
    ) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
    } else {
      const importedState = normalizeState(imported);
      if (!importedState) throw new Error("invalid");
      appState.libraries[activeLibrary.id] = importedState;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    }
    window.location.reload();
  } catch {
    window.alert("这个文件不是有效的进度备份。");
  } finally {
    elements.importInput.value = "";
  }
});
elements.resetButton.addEventListener("click", () => {
  if (!window.confirm("确定清空全部词库的学习进度吗？这一步不能撤销。")) return;
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

await activateLibrary(appState.activeLibraryId, { initial: true });
elements.loadingView.classList.add("hidden");
elements.appView.classList.remove("hidden");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
