import test from "node:test";
import assert from "node:assert/strict";
import { planSmartSearch } from "../../src/core/smart-plan.js";

test("smart planner keeps regex searches sequential", () => {
  const regex = planSmartSearch("createController", { regex: true });
  assert.equal(regex.strategy, "sequential");
  assert.equal(regex.reason, "regex search uses one rg walk");
});

test("smart planner narrows extension-like queries to one mechanical lane", () => {
  const cases = [
    ["README.md", "markdown"],
    ["guide.mdx", "markdown"],
    ["controller.ts", "code"],
    ["script.py", "code"],
  ];
  for (const [query, lane] of cases) {
    const plan = planSmartSearch(query, { regex: false });
    assert.equal(plan.strategy, "narrowed", query);
    assert.deepEqual(plan.lanes.map((item) => item.name), [lane], query);
  }
});

test("smart planner fans out non-markdown non-code extension queries", () => {
  for (const query of ["package.json", "styles.css"]) {
    const plan = planSmartSearch(query, { regex: false });
    assert.equal(plan.strategy, "fanout", query);
    assert.deepEqual(plan.lanes.map((lane) => lane.name), ["markdown", "code", "everything"], query);
  }
});

test("smart planner fans out non-extension literal queries across markdown code and everything", () => {
  const plan = planSmartSearch("TODO auth", { regex: false });
  assert.equal(plan.strategy, "fanout");
  assert.deepEqual(plan.lanes.map((lane) => lane.name), ["markdown", "code", "everything"]);
  assert.equal(plan.fallbackOnZero, true);
});
