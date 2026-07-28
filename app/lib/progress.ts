export type WordStatus = "unknown" | "known" | "mastered";
export type Scope = "all" | "1" | "2" | "3" | "4" | "5";

export type SavedProgress = {
  version: 2;
  revision: number;
  round: number;
  statuses: Record<string, WordStatus>;
  scope: Scope;
  queue: string[];
  cursor: number;
  shuffle: boolean;
};

type LegacyProgress = Omit<SavedProgress, "version" | "revision"> & {
  version: 1;
};

const validScopes = new Set<Scope>(["all", "1", "2", "3", "4", "5"]);
const validStatuses = new Set<WordStatus>([
  "unknown",
  "known",
  "mastered",
]);
const wordIdPattern = /^zw-\d{4}$/;

function isProgressBody(value: unknown): value is LegacyProgress | SavedProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacyProgress & SavedProgress>;

  if (
    (candidate.version !== 1 && candidate.version !== 2) ||
    typeof candidate.round !== "number" ||
    !Number.isInteger(candidate.round) ||
    candidate.round < 1 ||
    typeof candidate.statuses !== "object" ||
    !candidate.statuses ||
    !Array.isArray(candidate.queue) ||
    typeof candidate.cursor !== "number" ||
    !Number.isInteger(candidate.cursor) ||
    typeof candidate.shuffle !== "boolean" ||
    !validScopes.has(candidate.scope as Scope)
  ) {
    return false;
  }

  if (
    candidate.queue.length > 905 ||
    candidate.cursor < 0 ||
    candidate.cursor > candidate.queue.length ||
    new Set(candidate.queue).size !== candidate.queue.length ||
    candidate.queue.some(
      (id) => typeof id !== "string" || !wordIdPattern.test(id),
    )
  ) {
    return false;
  }

  const statusEntries = Object.entries(candidate.statuses);
  if (statusEntries.length > 905) return false;
  if (
    statusEntries.some(
      ([id, status]) =>
        !wordIdPattern.test(id) || !validStatuses.has(status as WordStatus),
    )
  ) {
    return false;
  }

  if (
    candidate.version === 2 &&
    (typeof candidate.revision !== "number" ||
      !Number.isInteger(candidate.revision) ||
      candidate.revision < 0)
  ) {
    return false;
  }

  return true;
}

export function normalizeProgress(value: unknown): SavedProgress | null {
  if (!isProgressBody(value)) return null;
  return {
    version: 2,
    revision: value.version === 2 ? value.revision : 0,
    round: value.round,
    statuses: value.statuses,
    scope: value.scope,
    queue: value.queue,
    cursor: value.cursor,
    shuffle: value.shuffle,
  };
}

