"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import words from "./data/words.json";
import { buildQueue, summarize } from "./lib/review-logic";

type WordStatus = "unknown" | "known" | "mastered";
type Scope = "all" | "1" | "2" | "3" | "4" | "5";
type Word = (typeof words)[number];

type SavedProgress = {
  version: 1;
  round: number;
  statuses: Record<string, WordStatus>;
  scope: Scope;
  queue: string[];
  cursor: number;
  shuffle: boolean;
};

type LastAction = {
  id: string;
  previousStatus?: WordStatus;
  cursor: number;
};

const STORAGE_KEY = "gre-fast-pass-progress-v1";
const scopeLabels: Record<Scope, string> = {
  all: "全部 905 词",
  "1": "第 1 天，180 词",
  "2": "第 2 天，182 词",
  "3": "第 3 天，181 词",
  "4": "第 4 天，177 词",
  "5": "第 5 天，185 词",
};

const statusMeta: Record<
  WordStatus,
  { label: string; short: string; key: string }
> = {
  unknown: { label: "不认识", short: "不认识", key: "1" },
  known: { label: "认识", short: "认识", key: "2" },
  mastered: { label: "完全熟悉", short: "熟悉", key: "3" },
};

function isSavedProgress(value: unknown): value is SavedProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedProgress>;
  return (
    candidate.version === 1 &&
    typeof candidate.round === "number" &&
    typeof candidate.statuses === "object" &&
    Array.isArray(candidate.queue) &&
    typeof candidate.cursor === "number" &&
    typeof candidate.shuffle === "boolean" &&
    ["all", "1", "2", "3", "4", "5"].includes(candidate.scope ?? "")
  );
}

export default function Home() {
  const [loaded, setLoaded] = useState(false);
  const [round, setRound] = useState(1);
  const [statuses, setStatuses] = useState<Record<string, WordStatus>>({});
  const [scope, setScope] = useState<Scope>("all");
  const [queue, setQueue] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [panel, setPanel] = useState<"library" | "settings" | null>(null);
  const [libraryStatus, setLibraryStatus] =
    useState<WordStatus>("known");
  const [search, setSearch] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const wordById = useMemo(
    () => new Map<string, Word>(words.map((word) => [word.id, word])),
    [],
  );

  const activeWords = useMemo(
    () =>
      scope === "all"
        ? words
        : words.filter((word) => word.day === Number(scope)),
    [scope],
  );

  const activeSummary = useMemo(
    () => summarize(activeWords, statuses),
    [activeWords, statuses],
  );
  const totalSummary = useMemo(
    () => summarize(words, statuses),
    [statuses],
  );

  const currentId = queue[cursor];
  const currentWord = currentId ? wordById.get(currentId) : undefined;
  const roundFinished = loaded && cursor >= queue.length;
  const roundRemaining = Math.max(queue.length - cursor, 0);
  const roundProgress =
    queue.length === 0 ? 100 : Math.round((cursor / queue.length) * 100);

  const persist = useCallback(
    (
      nextStatuses = statuses,
      nextQueue = queue,
      nextCursor = cursor,
      nextRound = round,
      nextScope = scope,
      nextShuffle = shuffle,
    ) => {
      const payload: SavedProgress = {
        version: 1,
        round: nextRound,
        statuses: nextStatuses,
        scope: nextScope,
        queue: nextQueue,
        cursor: nextCursor,
        shuffle: nextShuffle,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    [cursor, queue, round, scope, shuffle, statuses],
  );

  /* Loading browser-only saved progress after hydration is intentional. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let saved: SavedProgress | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isSavedProgress(parsed)) saved = parsed;
      }
    } catch {
      saved = null;
    }

    if (saved) {
      const validIds = new Set(words.map((word) => word.id));
      const restoredQueue = saved.queue.filter((id) => validIds.has(id));
      setRound(Math.max(1, saved.round));
      setStatuses(saved.statuses);
      setScope(saved.scope);
      setShuffle(saved.shuffle);
      setQueue(restoredQueue);
      setCursor(Math.min(saved.cursor, restoredQueue.length));
    } else {
      setQueue(buildQueue(words, {}, false));
    }
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded) return;
    persist();
  }, [loaded, persist]);

  const classify = useCallback(
    (status: WordStatus) => {
      if (!currentId || roundFinished || panel) return;
      const previousStatus = statuses[currentId];
      const nextStatuses = { ...statuses, [currentId]: status };
      const nextCursor = cursor + 1;
      setLastAction({ id: currentId, previousStatus, cursor });
      setStatuses(nextStatuses);
      setCursor(nextCursor);
      setRevealed(false);
      persist(nextStatuses, queue, nextCursor);
    },
    [
      currentId,
      cursor,
      panel,
      persist,
      queue,
      roundFinished,
      statuses,
    ],
  );

  const undo = useCallback(() => {
    if (!lastAction) return;
    const nextStatuses = { ...statuses };
    if (lastAction.previousStatus) {
      nextStatuses[lastAction.id] = lastAction.previousStatus;
    } else {
      delete nextStatuses[lastAction.id];
    }
    setStatuses(nextStatuses);
    setCursor(lastAction.cursor);
    setLastAction(null);
    setRevealed(false);
    persist(nextStatuses, queue, lastAction.cursor);
  }, [lastAction, persist, queue, statuses]);

  const startNextRound = useCallback(() => {
    const nextRound = round + 1;
    const nextQueue = buildQueue(activeWords, statuses, shuffle);
    setRound(nextRound);
    setQueue(nextQueue);
    setCursor(0);
    setLastAction(null);
    setRevealed(false);
    persist(statuses, nextQueue, 0, nextRound);
  }, [activeWords, persist, round, shuffle, statuses]);

  const changeScope = (nextScope: Scope) => {
    const nextWords =
      nextScope === "all"
        ? words
        : words.filter((word) => word.day === Number(nextScope));
    const nextQueue = buildQueue(nextWords, statuses, shuffle);
    setScope(nextScope);
    setRound(1);
    setQueue(nextQueue);
    setCursor(0);
    setLastAction(null);
    setPanel(null);
    persist(statuses, nextQueue, 0, 1, nextScope);
  };

  const toggleShuffle = () => {
    const nextShuffle = !shuffle;
    setShuffle(nextShuffle);
    persist(statuses, queue, cursor, round, scope, nextShuffle);
  };

  const speak = () => {
    if (!currentWord || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentWord.word);
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
  };

  const changeLibraryStatus = (id: string, status: WordStatus) => {
    const nextStatuses = { ...statuses, [id]: status };
    let nextQueue = queue;
    let nextCursor = cursor;

    if (status === "mastered") {
      const removedIndex = queue.indexOf(id);
      nextQueue = queue.filter((queueId) => queueId !== id);
      if (removedIndex !== -1 && removedIndex < cursor) {
        nextCursor = Math.max(0, cursor - 1);
      }
    }

    setStatuses(nextStatuses);
    setQueue(nextQueue);
    setCursor(nextCursor);
    persist(nextStatuses, nextQueue, nextCursor);
  };

  const exportProgress = () => {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return;
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gre-progress-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProgress = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isSavedProgress(parsed)) throw new Error("invalid");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      window.location.reload();
    } catch {
      window.alert("这个文件不是有效的进度备份。");
    } finally {
      event.target.value = "";
    }
  };

  const resetProgress = () => {
    if (!window.confirm("确定清空全部学习进度吗？这一步不能撤销。")) return;
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (panel || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT") return;
      if (event.code === "Space") {
        event.preventDefault();
        setRevealed((value) => !value);
      } else if (event.key === "1") {
        classify("unknown");
      } else if (event.key === "2") {
        classify("known");
      } else if (event.key === "3") {
        classify("mastered");
      } else if (event.key.toLowerCase() === "z") {
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [classify, panel, undo]);

  const libraryWords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return words.filter((word) => {
      if (statuses[word.id] !== libraryStatus) return false;
      if (!query) return true;
      return (
        word.word.includes(query) ||
        word.equivalents.includes(query) ||
        word.meaning.includes(query)
      );
    });
  }, [libraryStatus, search, statuses]);

  if (!loaded) {
    return (
      <main className="loading-shell" aria-live="polite">
        <div className="loading-mark">GRE</div>
        <p>正在读取你的进度</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPanel(null)}>
          <span className="brand-mark">G</span>
          <span>
            <strong>等价词快刷</strong>
            <small>905 张词卡</small>
          </span>
        </button>

        <div className="top-actions">
          <button className="quiet-button" onClick={() => setPanel("library")}>
            词库
            <span className="button-count">{totalSummary.known}</span>
          </button>
          <button className="quiet-button" onClick={() => setPanel("settings")}>
            设置
          </button>
        </div>
      </header>

      <section className="study-stage" aria-label="单词学习区">
        <div className="progress-row">
          <div>
            <span className="eyebrow">第 {round} 轮</span>
            <strong>
              {roundFinished ? queue.length : Math.min(cursor + 1, queue.length)}
              <span> / {queue.length}</span>
            </strong>
          </div>
          <div className="progress-track" aria-label={`本轮完成 ${roundProgress}%`}>
            <span style={{ width: `${roundProgress}%` }} />
          </div>
          <button className="scope-button" onClick={() => setPanel("settings")}>
            {scope === "all" ? "全部词表" : `第 ${scope} 天`}
            <span aria-hidden="true">⌄</span>
          </button>
        </div>

        {!roundFinished && currentWord ? (
          <>
            <article className={`word-card ${revealed ? "is-revealed" : ""}`}>
              <div className="card-topline">
                <span>Day {currentWord.day}</span>
                <button
                  className="speak-button"
                  onClick={speak}
                  aria-label={`朗读 ${currentWord.word}`}
                >
                  <span aria-hidden="true">▶</span>
                  朗读
                </button>
              </div>

              <div className="word-center">
                <h1>{currentWord.word}</h1>
                <button
                  className="reveal-button"
                  onClick={() => setRevealed((value) => !value)}
                  aria-expanded={revealed}
                >
                  {revealed ? "收起答案" : "显示等价词"}
                  <kbd>空格</kbd>
                </button>
              </div>

              <div className="answer-area" aria-hidden={!revealed}>
                <div className="answer-rule" />
                <div className="answer-grid">
                  <div>
                    <span>等价词</span>
                    <p>{currentWord.equivalents}</p>
                  </div>
                  <div>
                    <span>汉语解释</span>
                    <p>{currentWord.meaning}</p>
                  </div>
                </div>
              </div>
            </article>

            <div className="decision-area">
              <p>你对这个词的熟悉程度</p>
              <div className="decision-buttons">
                {(Object.keys(statusMeta) as WordStatus[]).map((status) => (
                  <button
                    key={status}
                    className={`decision-button ${status}`}
                    onClick={() => classify(status)}
                  >
                    <span>{statusMeta[status].label}</span>
                    <kbd>{statusMeta[status].key}</kbd>
                  </button>
                ))}
              </div>
              <div className="decision-note">
                <span>不认识的词下轮先出现，认识的词随后出现。</span>
                <button onClick={undo} disabled={!lastAction}>
                  撤销 <kbd>Z</kbd>
                </button>
              </div>
            </div>
          </>
        ) : (
          <section className="round-summary">
            <span className="summary-kicker">
              {activeSummary.mastered === activeWords.length
                ? "已经全部掌握"
                : `第 ${round} 轮完成`}
            </span>
            <h1>
              {activeSummary.mastered === activeWords.length
                ? "这组词已经清空"
                : "休息一下，再过一轮"}
            </h1>
            <p>
              {activeSummary.mastered === activeWords.length
                ? "完全熟悉的词不会再次出现。你可以去词库查看，或切换学习范围。"
                : `下一轮先看 ${activeSummary.unknown} 个不认识的词，再看 ${activeSummary.known} 个认识的词。`}
            </p>
            <div className="summary-counts">
              <div className="unknown">
                <strong>{activeSummary.unknown}</strong>
                <span>不认识</span>
              </div>
              <div className="known">
                <strong>{activeSummary.known}</strong>
                <span>认识</span>
              </div>
              <div className="mastered">
                <strong>{activeSummary.mastered}</strong>
                <span>完全熟悉</span>
              </div>
            </div>
            {activeSummary.mastered !== activeWords.length && (
              <button className="next-round-button" onClick={startNextRound}>
                开始第 {round + 1} 轮
                <span aria-hidden="true">→</span>
              </button>
            )}
            <button className="summary-undo" onClick={undo} disabled={!lastAction}>
              撤销最后一次选择
            </button>
          </section>
        )}
      </section>

      <footer className="status-footer">
        <span>
          本轮还剩 <strong>{roundRemaining}</strong> 个
        </span>
        <span className="footer-separator" />
        <span>
          已完全熟悉 <strong>{totalSummary.mastered}</strong> / 905
        </span>
        <span className="footer-save">进度已自动保存在这台设备</span>
      </footer>

      {panel && (
        <div className="panel-backdrop" onMouseDown={() => setPanel(null)}>
          <aside
            className="side-panel"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={panel === "library" ? "词库" : "设置"}
          >
            <div className="panel-header">
              <div>
                <span>{panel === "library" ? "我的词库" : "学习设置"}</span>
                <h2>{panel === "library" ? "查看学习状态" : "设置本轮范围"}</h2>
              </div>
              <button onClick={() => setPanel(null)} aria-label="关闭">
                ×
              </button>
            </div>

            {panel === "library" ? (
              <>
                <div className="library-tabs">
                  {(Object.keys(statusMeta) as WordStatus[]).map((status) => (
                    <button
                      key={status}
                      className={libraryStatus === status ? "active" : ""}
                      onClick={() => setLibraryStatus(status)}
                    >
                      {statusMeta[status].short}
                      <span>{totalSummary[status]}</span>
                    </button>
                  ))}
                </div>
                <label className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="搜索单词、等价词或中文"
                  />
                </label>
                <div className="library-list">
                  {libraryWords.length ? (
                    libraryWords.map((word) => (
                      <article key={word.id} className="library-row">
                        <div>
                          <strong>{word.word}</strong>
                          <p>{word.equivalents}</p>
                          <small>{word.meaning}</small>
                        </div>
                        <select
                          value={statuses[word.id]}
                          onChange={(event) =>
                            changeLibraryStatus(
                              word.id,
                              event.target.value as WordStatus,
                            )
                          }
                          aria-label={`修改 ${word.word} 的状态`}
                        >
                          <option value="unknown">不认识</option>
                          <option value="known">认识</option>
                          <option value="mastered">完全熟悉</option>
                        </select>
                      </article>
                    ))
                  ) : (
                    <div className="empty-library">
                      <span>0</span>
                      <p>这里还没有单词</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="settings-content">
                <section>
                  <span className="settings-label">学习范围</span>
                  <div className="scope-list">
                    {(Object.keys(scopeLabels) as Scope[]).map((item) => (
                      <button
                        key={item}
                        className={scope === item ? "active" : ""}
                        onClick={() => changeScope(item)}
                      >
                        <span>{scopeLabels[item]}</span>
                        <i>{scope === item ? "✓" : ""}</i>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="toggle-section">
                  <div>
                    <span className="settings-label">每组内打乱顺序</span>
                    <p>不认识、认识和未看过的词仍按这个顺序出现。</p>
                  </div>
                  <button
                    className={`toggle ${shuffle ? "on" : ""}`}
                    onClick={toggleShuffle}
                    aria-pressed={shuffle}
                  >
                    <span />
                  </button>
                </section>

                <section className="backup-section">
                  <span className="settings-label">进度备份</span>
                  <p>进度保存在当前浏览器。换设备前请先下载备份。</p>
                  <div>
                    <button onClick={exportProgress}>下载备份</button>
                    <button onClick={() => importInputRef.current?.click()}>
                      导入备份
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept="application/json"
                      onChange={importProgress}
                      hidden
                    />
                  </div>
                </section>

                <section className="source-note">
                  <span className="settings-label">词表说明</span>
                  <p>
                    本站整理自公开分享的《真经 GRE 等价词汇总》和《等价词
                    900 组》。PDF 中共有 905 个主词条。本工具用于个人学习，不是官方产品。
                  </p>
                </section>

                <button className="reset-button" onClick={resetProgress}>
                  清空全部进度
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
