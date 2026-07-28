import { normalizeProgress, type SavedProgress } from "./progress";

export type CloudWordStatus = "unknown" | "known" | "mastered";

export type CloudCustomWord = {
  id: string;
  day: 9999;
  word: string;
  equivalents: string;
  meaning: string;
  scope: "my-added-words";
  scopeLabel: "我的添加";
  scopeOrder: 9999;
  isCustom: true;
  createdAt: number;
  updatedAt: number;
};

export type CloudLibraryState = {
  version: 2;
  round: number;
  statuses: Record<string, CloudWordStatus>;
  scope: string;
  subgroupFilter: string;
  typeFilter: string;
  studyMode: "all" | "unknown" | "known" | "unseen";
  rangeStart: number;
  rangeEnd: number;
  queue: string[];
  cursor: number;
  shuffle: boolean;
  dataVersion: number;
  customWords: CloudCustomWord[];
};

export type CloudProgress = {
  version: 3;
  revision: number;
  activeLibraryId: string;
  libraries: Record<string, CloudLibraryState>;
};

const libraryIds = new Set([
  "gre-equivalents",
  "ielts-synonyms",
  "ielts-vocabulary-bible",
  "ielts-writing",
  "gre-emergency-1400",
  "gre-3000",
]);
const validStatuses = new Set<CloudWordStatus>([
  "unknown",
  "known",
  "mastered",
]);
const validStudyModes = new Set(["all", "unknown", "known", "unseen"]);
const safeIdPattern = /^[a-z0-9-]{1,180}$/i;
const maxWordIds = 6_000;
const maxCustomWords = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function normalizeCustomWords(
  value: unknown,
  libraryId: string,
): CloudCustomWord[] {
  if (!Array.isArray(value)) return [];
  const result: CloudCustomWord[] = [];
  const seen = new Set<string>();
  const prefix = `custom-${libraryId}-`;
  for (const raw of value.slice(0, maxCustomWords)) {
    if (!isRecord(raw)) continue;
    const id = cleanString(raw.id, 180);
    const word = cleanString(raw.word, 120);
    const meaning = cleanString(raw.meaning, 500);
    if (
      !id.startsWith(prefix) ||
      !safeIdPattern.test(id) ||
      !word ||
      !meaning ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    const createdAt = positiveInteger(raw.createdAt, Date.now());
    const updatedAt = Math.max(
      positiveInteger(raw.updatedAt, createdAt),
      createdAt,
    );
    result.push({
      id,
      day: 9999,
      word,
      equivalents: cleanString(raw.equivalents, 500),
      meaning,
      scope: "my-added-words",
      scopeLabel: "我的添加",
      scopeOrder: 9999,
      isCustom: true,
      createdAt,
      updatedAt,
    });
  }
  return result;
}

function normalizeLibraryState(
  value: unknown,
  libraryId: string,
): CloudLibraryState | null {
  if (!isRecord(value)) return null;
  const customWords = normalizeCustomWords(value.customWords, libraryId);
  const allowedCustomIds = new Set(customWords.map((word) => word.id));
  const statuses: Record<string, CloudWordStatus> = {};
  if (isRecord(value.statuses)) {
    for (const [id, status] of Object.entries(value.statuses).slice(
      0,
      maxWordIds,
    )) {
      if (
        safeIdPattern.test(id) &&
        validStatuses.has(status as CloudWordStatus) &&
        (!id.startsWith("custom-") || allowedCustomIds.has(id))
      ) {
        statuses[id] = status as CloudWordStatus;
      }
    }
  }

  const queue: string[] = [];
  const queueIds = new Set<string>();
  if (Array.isArray(value.queue)) {
    for (const rawId of value.queue.slice(0, maxWordIds)) {
      if (
        typeof rawId === "string" &&
        safeIdPattern.test(rawId) &&
        (!rawId.startsWith("custom-") || allowedCustomIds.has(rawId)) &&
        !queueIds.has(rawId)
      ) {
        queueIds.add(rawId);
        queue.push(rawId);
      }
    }
  }

  const rawScope = cleanString(value.scope, 180);
  const rawSubgroup = cleanString(value.subgroupFilter, 180);
  const rawType = cleanString(value.typeFilter, 120);
  const studyMode = validStudyModes.has(String(value.studyMode))
    ? (value.studyMode as CloudLibraryState["studyMode"])
    : "all";
  const rangeStart = positiveInteger(value.rangeStart, 1);
  const rangeEnd = Math.max(positiveInteger(value.rangeEnd, 1), rangeStart);
  const cursor = Math.min(
    Math.max(
      Number.isInteger(value.cursor) ? Number(value.cursor) : 0,
      0,
    ),
    queue.length,
  );

  return {
    version: 2,
    round: positiveInteger(value.round, 1),
    statuses,
    scope: rawScope || "all",
    subgroupFilter: rawSubgroup || "all",
    typeFilter: rawType || "all",
    studyMode,
    rangeStart,
    rangeEnd,
    queue,
    cursor,
    shuffle: Boolean(value.shuffle),
    dataVersion: positiveInteger(value.dataVersion, 1),
    customWords,
  };
}

export function normalizeCloudProgress(value: unknown): CloudProgress | null {
  if (!isRecord(value)) return null;
  if (
    (value.version !== 2 && value.version !== 3) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !isRecord(value.libraries)
  ) {
    return null;
  }

  const libraries: Record<string, CloudLibraryState> = {};
  for (const [libraryId, rawState] of Object.entries(value.libraries)) {
    if (!libraryIds.has(libraryId)) continue;
    const normalized = normalizeLibraryState(rawState, libraryId);
    if (normalized) libraries[libraryId] = normalized;
  }
  const activeLibraryId = libraryIds.has(String(value.activeLibraryId))
    ? String(value.activeLibraryId)
    : "gre-equivalents";
  return {
    version: 3,
    revision: Number(value.revision),
    activeLibraryId,
    libraries,
  };
}

function migrateLegacyProgress(progress: SavedProgress): CloudProgress {
  return {
    version: 3,
    revision: progress.revision,
    activeLibraryId: "gre-equivalents",
    libraries: {
      "gre-equivalents": {
        version: 2,
        round: progress.round,
        statuses: progress.statuses,
        scope: progress.scope,
        subgroupFilter: "all",
        typeFilter: "all",
        studyMode: "all",
        rangeStart: 1,
        rangeEnd: 905,
        queue: progress.queue,
        cursor: progress.cursor,
        shuffle: progress.shuffle,
        dataVersion: 1,
        customWords: [],
      },
    },
  };
}

export function normalizeStoredProgress(value: unknown): CloudProgress | null {
  const current = normalizeCloudProgress(value);
  if (current) return current;
  const legacy = normalizeProgress(value);
  return legacy ? migrateLegacyProgress(legacy) : null;
}
