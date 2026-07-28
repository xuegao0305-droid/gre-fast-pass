/**
 * @typedef {{ id: string, day: number, word: string, equivalents: string, meaning: string }} Word
 * @typedef {"unknown" | "known" | "mastered"} WordStatus
 */

/**
 * @param {string[]} items
 * @param {() => number} random
 */
function shuffleItems(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/**
 * Build a new round. Unknown words always come first, known words come next,
 * and words that have not been reviewed yet come last.
 *
 * @param {Word[]} words
 * @param {Record<string, WordStatus | undefined>} statuses
 * @param {boolean} shouldShuffle
 * @param {() => number} [random]
 */
export function buildQueue(
  words,
  statuses,
  shouldShuffle,
  random = Math.random,
) {
  const groups = {
    unknown: [],
    known: [],
    unseen: [],
  };

  for (const word of words) {
    const status = statuses[word.id];
    if (status === "mastered") continue;
    if (status === "unknown") groups.unknown.push(word.id);
    else if (status === "known") groups.known.push(word.id);
    else groups.unseen.push(word.id);
  }

  const maybeShuffle = (items) =>
    shouldShuffle ? shuffleItems(items, random) : items;

  return [
    ...maybeShuffle(groups.unknown),
    ...maybeShuffle(groups.known),
    ...maybeShuffle(groups.unseen),
  ];
}

/**
 * @param {Word[]} words
 * @param {Record<string, WordStatus | undefined>} statuses
 */
export function summarize(words, statuses) {
  const summary = { unknown: 0, known: 0, mastered: 0, unseen: 0 };
  for (const word of words) {
    const status = statuses[word.id];
    if (status) summary[status] += 1;
    else summary.unseen += 1;
  }
  return summary;
}

