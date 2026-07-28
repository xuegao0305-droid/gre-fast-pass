const STORAGE_KEY = "gre-fast-pass-pages-v1";
const validStatuses = new Set(["unknown", "known", "mastered"]);
const validScopes = new Set(["all", "1", "2", "3", "4", "5"]);
const scopeLabels = {
  all: "全部 905 词",
  1: "第 1 天，180 词",
  2: "第 2 天，182 词",
  3: "第 3 天，181 词",
  4: "第 4 天，177 词",
  5: "第 5 天，185 词",
};

const elements = Object.fromEntries(
  [
    "loadingView",
    "appView",
    "libraryButton",
    "settingsButton",
    "scopeButton",
    "scopeLabel",
    "roundLabel",
    "positionLabel",
    "progressTrack",
    "progressBar",
    "studyView",
    "wordCard",
    "dayLabel",
    "speakButton",
    "wordText",
    "revealButton",
    "revealLabel",
    "answerArea",
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
    "knownCount",
    "saveStatus",
    "panelBackdrop",
    "sidePanel",
    "panelKicker",
    "panelTitle",
    "closePanelButton",
    "libraryPanel",
    "settingsPanel",
    "libraryTabs",
    "libraryKnownCount",
    "libraryUnknownCount",
    "libraryMasteredCount",
    "searchInput",
    "libraryList",
    "scopeList",
    "shuffleToggle",
    "exportButton",
    "importButton",
    "importInput",
    "resetButton",
  ].map((id) => [id, document.getElementById(id)]),
);

const response = await fetch("./words.json");
if (!response.ok) throw new Error("词表加载失败");
const words = await response.json();
const wordById = new Map(words.map((word) => [word.id, word]));

let state = loadState();
let revealed = false;
let lastAction = null;
let libraryStatus = "known";
let historyOffset = 0;

function normalizeState(value) {
  if (!value || typeof value !== "object") return null;
  if (
    !Number.isInteger(value.round) ||
    value.round < 1 ||
    !validScopes.has(value.scope) ||
    !Array.isArray(value.queue) ||
    !Number.isInteger(value.cursor) ||
    value.cursor < 0 ||
    value.cursor > value.queue.length ||
    typeof value.shuffle !== "boolean" ||
    !value.statuses ||
    typeof value.statuses !== "object"
  ) {
    return null;
  }

  const validIds = new Set(words.map((word) => word.id));
  const queue = value.queue.filter((id) => validIds.has(id));
  if (new Set(queue).size !== queue.length) return null;

  const statuses = {};
  for (const [id, status] of Object.entries(value.statuses)) {
    if (validIds.has(id) && validStatuses.has(status)) statuses[id] = status;
  }

  return {
    version: 1,
    round: value.round,
    statuses,
    scope: value.scope,
    queue,
    cursor: Math.min(value.cursor, queue.length),
    shuffle: value.shuffle,
  };
}

function loadState() {
  try {
    const saved = normalizeState(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
    if (saved) return saved;
  } catch {
    // Start clean when a damaged browser record cannot be read.
  }

  return {
    version: 1,
    round: 1,
    statuses: {},
    scope: "all",
    queue: words.map((word) => word.id),
    cursor: 0,
    shuffle: false,
  };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  elements.saveStatus.textContent = "进度已保存在此浏览器";
  elements.saveStatus.className = "footer-save sync-saved";
}

function activeWords() {
  return state.scope === "all"
    ? words
    : words.filter((word) => word.day === Number(state.scope));
}

function summarize(list = words) {
  const result = { unknown: 0, known: 0, mastered: 0, unseen: 0 };
  for (const word of list) {
    const status = state.statuses[word.id];
    if (validStatuses.has(status)) result[status] += 1;
    else result.unseen += 1;
  }
  return result;
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
  revealed = nextValue;
  elements.wordCard.classList.toggle("is-revealed", revealed);
  elements.answerArea.setAttribute("aria-hidden", String(!revealed));
  elements.revealButton.setAttribute("aria-expanded", String(revealed));
  elements.revealLabel.textContent = revealed
    ? "收起答案"
    : "查看等价词和中文释义";
}

function render() {
  const active = activeWords();
  const activeSummary = summarize(active);
  const totalSummary = summarize();
  const displayIndex = state.cursor - historyOffset;
  const finished =
    state.cursor >= state.queue.length && historyOffset === 0;
  const remaining = Math.max(state.queue.length - state.cursor, 0);
  const progress =
    state.queue.length === 0
      ? 100
      : Math.round((state.cursor / state.queue.length) * 100);

  elements.roundLabel.textContent = `第 ${state.round} 轮`;
  elements.positionLabel.innerHTML = `${
    finished ? state.queue.length : Math.min(displayIndex + 1, state.queue.length)
  }<span> / ${state.queue.length}</span>`;
  elements.progressBar.style.width = `${progress}%`;
  elements.progressTrack.setAttribute("aria-label", `本轮完成 ${progress}%`);
  elements.scopeLabel.textContent =
    state.scope === "all" ? "全部词表" : `第 ${state.scope} 天`;
  elements.remainingCount.textContent = String(remaining);
  elements.masteredCount.textContent = String(totalSummary.mastered);
  elements.knownCount.textContent = String(totalSummary.known);
  elements.libraryKnownCount.textContent = String(totalSummary.known);
  elements.libraryUnknownCount.textContent = String(totalSummary.unknown);
  elements.libraryMasteredCount.textContent = String(totalSummary.mastered);
  elements.shuffleToggle.classList.toggle("on", state.shuffle);
  elements.shuffleToggle.setAttribute("aria-pressed", String(state.shuffle));
  elements.undoButton.disabled = !lastAction;
  elements.summaryUndoButton.disabled = !lastAction;
  elements.previousButton.disabled = displayIndex <= 0;
  elements.forwardButton.classList.toggle("hidden", historyOffset === 0);
  elements.summaryPreviousButton.disabled = state.cursor === 0;

  if (!finished && currentWord()) {
    const word = currentWord();
    elements.studyView.classList.remove("hidden");
    elements.summaryView.classList.add("hidden");
    elements.dayLabel.textContent = `Day ${word.day}`;
    elements.wordText.textContent = word.word;
    elements.equivalentsText.textContent = word.equivalents;
    elements.meaningText.textContent = word.meaning;
    elements.speakButton.setAttribute("aria-label", `朗读 ${word.word}`);
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
    const allMastered = activeSummary.mastered === active.length;
    elements.summaryKicker.textContent = allMastered
      ? "已经全部掌握"
      : `第 ${state.round} 轮完成`;
    elements.summaryTitle.textContent = allMastered
      ? "这组词已经清空"
      : "休息一下，再过一轮";
    elements.summaryText.textContent = allMastered
      ? "完全熟悉的词不会再次出现。你可以去词库查看，或切换学习范围。"
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
  setRevealed(historyOffset > 0);
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
  if (!validScopes.has(scope)) return;
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
  state.statuses[id] = status;
  if (status === "mastered") {
    const removedIndex = state.queue.indexOf(id);
    state.queue = state.queue.filter((queueId) => queueId !== id);
    if (removedIndex !== -1 && removedIndex < state.cursor) {
      state.cursor = Math.max(0, state.cursor - 1);
    }
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
  if (historyOffset <= 0) return;
  historyOffset -= 1;
  setRevealed(historyOffset > 0);
  render();
}

function openPanel(type) {
  elements.panelBackdrop.classList.remove("hidden");
  elements.libraryPanel.classList.toggle("hidden", type !== "library");
  elements.settingsPanel.classList.toggle("hidden", type !== "settings");
  elements.panelKicker.textContent =
    type === "library" ? "我的词库" : "学习设置";
  elements.panelTitle.textContent =
    type === "library" ? "查看学习状态" : "设置本轮范围";
  elements.sidePanel.setAttribute("aria-label", type === "library" ? "词库" : "设置");
  renderPanel();
}

function closePanel() {
  elements.panelBackdrop.classList.add("hidden");
}

function renderPanel() {
  if (!elements.libraryPanel.classList.contains("hidden")) renderLibrary();
  if (!elements.settingsPanel.classList.contains("hidden")) renderSettings();
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
      word.word.includes(query) ||
      word.equivalents.includes(query) ||
      word.meaning.includes(query)
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
  for (const scope of ["all", "1", "2", "3", "4", "5"]) {
    const button = document.createElement("button");
    button.classList.toggle("active", state.scope === scope);
    const label = document.createElement("span");
    label.textContent = scopeLabels[scope];
    const check = document.createElement("i");
    check.textContent = state.scope === scope ? "✓" : "";
    button.append(label, check);
    button.addEventListener("click", () => changeScope(scope));
    elements.scopeList.append(button);
  }
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gre-progress-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

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
elements.summaryPreviousButton.addEventListener("click", goPrevious);
elements.nextRoundButton.addEventListener("click", startNextRound);
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
    const imported = normalizeState(JSON.parse(await file.text()));
    if (!imported) throw new Error("invalid");
    state = imported;
    persist();
    window.location.reload();
  } catch {
    window.alert("这个文件不是有效的进度备份。");
  } finally {
    elements.importInput.value = "";
  }
});
elements.resetButton.addEventListener("click", () => {
  if (!window.confirm("确定清空全部学习进度吗？这一步不能撤销。")) return;
  localStorage.removeItem(STORAGE_KEY);
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
  else if (event.key.toLowerCase() === "z") undo();
});

persist();
render();
elements.loadingView.classList.add("hidden");
elements.appView.classList.remove("hidden");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}
