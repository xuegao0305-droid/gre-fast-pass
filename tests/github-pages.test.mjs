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
  assert.match(html, /id="modeList"/);
  assert.match(html, /id="subgroupList"/);
  assert.match(html, /id="typeList"/);
  assert.match(html, /id="statusStudyButton"/);
  assert.match(html, /rel="manifest"/);
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /buildQueue/);
  assert.match(app, /function goPrevious/);
  assert.match(app, /function goToQueueIndex/);
  assert.match(app, /function applyCustomRange/);
  assert.match(app, /historyOffset/);
  assert.match(app, /appState\.libraries/);
  assert.match(app, /activateLibrary/);
  assert.match(app, /studyMode/);
  assert.match(app, /function changeStudyMode/);
  assert.match(app, /logicGroup/);
  assert.match(app, /expressionType/);
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
    "ielts-writing": 234,
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

test("雅思词汇真经保留 22 章和原有逻辑词群", () => {
  const rows = JSON.parse(
    readFileSync("docs/data/ielts-vocabulary-bible.json", "utf8"),
  );
  const chapterCounts = [
    241, 130, 168, 75, 401, 122, 79, 68, 176, 152, 113,
    173, 134, 134, 149, 171, 117, 213, 121, 268, 416, 52,
  ];

  assert.deepEqual(
    Array.from({ length: 22 }, (_, index) =>
      rows.filter((row) => row.chapter === index + 1).length,
    ),
    chapterCounts,
  );
  assert.equal(new Set(rows.map((row) => row.scope)).size, 22);
  assert.equal(new Set(rows.map((row) => row.logicGroup)).size, 980);
  assert.equal(rows[0].scopeLabel, "第 1 章 自然地理");
  assert.equal(rows.at(-1).scopeLabel, "第 22 章 时间日期");
  for (const row of rows) {
    assert.ok(row.logicGroup);
    assert.ok(row.logicGroupLabel);
    assert.ok(Number.isInteger(row.logicGroupNumber));
    assert.ok(Number.isInteger(row.positionInGroup));
    assert.ok(Number.isInteger(row.groupSize));
  }
});

test("雅思写作库按任务、题材和表达类型整理", () => {
  const rows = JSON.parse(
    readFileSync("docs/data/ielts-writing.json", "utf8"),
  );
  assert.equal(rows.filter((row) => row.part === "小作文").length, 109);
  assert.equal(rows.filter((row) => row.part === "大作文").length, 125);
  assert.equal(new Set(rows.map((row) => row.scope)).size, 19);
  assert.deepEqual(
    new Set(rows.map((row) => row.expressionType)),
    new Set(["动词短语", "名词短语", "句型", "形容词与副词", "衔接表达"]),
  );
  for (const topic of [
    "折线图",
    "柱状图",
    "饼图",
    "表格",
    "地图",
    "流程图",
    "混合图",
  ]) {
    assert.ok(rows.some((row) => row.part === "小作文" && row.topic === topic));
  }
  for (const row of rows) {
    assert.ok(row.part);
    assert.ok(row.topic);
    assert.ok(row.expressionType);
    assert.ok(row.usage);
  }
});
