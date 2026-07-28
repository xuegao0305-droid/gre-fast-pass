import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import appWords from "../app/data/words.json" with { type: "json" };
import pageWords from "../docs/words.json" with { type: "json" };

test("the GitHub Pages build contains the complete word list", () => {
  assert.equal(pageWords.length, 905);
  assert.deepEqual(pageWords, appWords);
});

test("the GitHub Pages files are complete and use browser persistence", () => {
  for (const file of [
    "docs/index.html",
    "docs/styles.css",
    "docs/app.js",
    "docs/words.json",
    "docs/og.png",
    "docs/service-worker.js",
  ]) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }

  const html = readFileSync("docs/index.html", "utf8");
  const app = readFileSync("docs/app.js", "utf8");
  assert.match(html, /等价词快刷/);
  assert.match(html, /xuegao0305-droid\.github\.io\/gre-fast-pass/);
  assert.match(html, /id="previousButton"/);
  assert.match(html, /中文释义/);
  assert.match(app, /localStorage\.setItem/);
  assert.match(app, /buildQueue/);
  assert.match(app, /function goPrevious/);
  assert.match(app, /historyOffset/);
});

test("the static JavaScript files pass syntax checks", () => {
  for (const file of ["docs/app.js", "docs/service-worker.js"]) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
