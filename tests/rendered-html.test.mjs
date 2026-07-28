import assert from "node:assert/strict";
import test from "node:test";
import words from "../app/data/words.json" with { type: "json" };
import { buildQueue, summarize } from "../app/lib/review-logic.js";

test("the public list contains 905 complete and unique cards", () => {
  assert.equal(words.length, 905);
  assert.equal(new Set(words.map((word) => word.id)).size, 905);
  const dayCounts = Object.fromEntries(
    Object.entries(Object.groupBy(words, (word) => word.day)).map(
      ([day, rows]) => [day, rows.length],
    ),
  );
  assert.deepEqual(dayCounts, {
    1: 180,
    2: 182,
    3: 181,
    4: 177,
    5: 185,
  });
  for (const word of words) {
    assert.ok(word.word);
    assert.ok(word.equivalents);
    assert.ok(word.meaning);
  }
});

test("a new round puts unknown words before known and unseen words", () => {
  const sample = words.slice(0, 5);
  const statuses = {
    [sample[0].id]: "known",
    [sample[1].id]: "unknown",
    [sample[2].id]: "mastered",
  };
  assert.deepEqual(buildQueue(sample, statuses, false), [
    sample[1].id,
    sample[0].id,
    sample[3].id,
    sample[4].id,
  ]);
});

test("mastered words stay out of later rounds", () => {
  const sample = words.slice(0, 3);
  const statuses = Object.fromEntries(
    sample.map((word) => [word.id, "mastered"]),
  );
  assert.deepEqual(buildQueue(sample, statuses, false), []);
  assert.deepEqual(summarize(sample, statuses), {
    unknown: 0,
    known: 0,
    mastered: 3,
    unseen: 0,
  });
});
