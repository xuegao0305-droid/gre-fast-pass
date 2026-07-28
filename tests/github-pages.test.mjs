import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import appWords from "../app/data/words.json" with { type: "json" };
import pageWords from "../docs/words.json" with { type: "json" };
import libraries from "../docs/libraries.json" with { type: "json" };

test("the GitHub Pages build contains the complete word list", () => {
  assert.equal(pageWords.length, 905);
  assert.deepEqual(pageWords, appWords);
});

test("the GitHub Pages files are complete and use browser persistence", () => {
  const libraryFiles = libraries.map((library) =>
    `docs/${library.file.replace("./", "")}`,
  );
  for (const file of [
    "docs/index.html",
    "docs/styles.css",
    "docs/app-v2.js",
    "docs/libraries.json",
    "docs/words.json",
    "docs/og.png",
    "docs/icon-180.png",
    "docs/icon-192.png",
    "docs/icon-512.png",
    "docs/manifest.webmanifest",
    "docs/service-worker.js",
    ...libraryFiles,
  ]) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }

  const html = readFileSync("docs/index.html", "utf8");
  const app = readFileSync("docs/app-v2.js", "utf8");
  assert.match(html, /词汇快刷/);
  assert.match(html, /xuegao0305-droid\.github\.io\/gre-fast-pass/);
  assert.match(html, /id="vocabularyButton"/);
  assert.match(html, /id="catalogList"/);
  assert.match(html, /id="previousButton"/);
  assert.match(html, /id="meaningText"/);
  assert.match(html, /id="progressSlider"/);
  assert.match(html, /id="rangeStartInput"/);
  assert.match(html, /id="rangeEndInput"/);
  assert.match(html, /rel="manifest"/);
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /buildQueue/);
  assert.match(app, /function goPrevious/);
  assert.match(app, /function goToQueueIndex/);
  assert.match(app, /function applyCustomRange/);
  assert.match(app, /historyOffset/);
  assert.match(app, /appState\.libraries/);
  assert.match(app, /activateLibrary/);
});

test("the static JavaScript files pass syntax checks", () => {
  for (const file of ["docs/app-v2.js", "docs/service-worker.js"]) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("all six learning libraries have complete and unique cards", () => {
  const expectedCounts = {
    "gre-equivalents": 905,
    "ielts-synonyms": 114,
    "ielts-vocabulary-bible": 3673,
    "ielts-writing": 143,
    "gre-emergency-1400": 1400,
    "gre-3000": 3072,
  };
  assert.equal(libraries.length, 6);

  for (const library of libraries) {
    const file = `docs/${library.file.replace("./", "")}`;
    const rows = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(rows.length, expectedCounts[library.id]);
    assert.equal(rows.length, library.count);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    for (const row of rows) {
      assert.ok(row.id);
      assert.ok(row.word);
      assert.ok(row.meaning);
      assert.equal(typeof row.equivalents, "string");
      assert.ok(Number.isInteger(row.day));
    }
  }
});
