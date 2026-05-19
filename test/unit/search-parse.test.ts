import test from "node:test";
import assert from "node:assert/strict";
import { parseRgJson } from "../../src/core/search.js";

test("parse ripgrep JSON caps returned matches", () => {
  const stdout = [
    JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/a.ts" },
        line_number: 10,
        lines: { text: "const needle = true;\n" },
      },
    }),
    JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/b.ts" },
        line_number: 20,
        lines: { text: "needle again\n" },
      },
    }),
  ].join("\n");

  const parsed = parseRgJson(stdout, 1);
  assert.equal(parsed.totalMatches, 2);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.files.size, 2);
  assert.deepEqual(parsed.matches, [{ path: "src/a.ts", line: 10, text: "const needle = true;", context: [] }]);
});

test("parse ripgrep JSON attaches surrounding context lines to matches", () => {
  const stdout = [
    JSON.stringify({
      type: "context",
      data: {
        path: { text: "src/a.ts" },
        line_number: 9,
        lines: { text: "const before = true;\n" },
      },
    }),
    JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/a.ts" },
        line_number: 10,
        lines: { text: "const needle = true;\n" },
      },
    }),
    JSON.stringify({
      type: "context",
      data: {
        path: { text: "src/a.ts" },
        line_number: 11,
        lines: { text: "const after = true;\n" },
      },
    }),
  ].join("\n");

  const parsed = parseRgJson(stdout, 10);
  assert.deepEqual(parsed.matches, [
    {
      path: "src/a.ts",
      line: 10,
      text: "const needle = true;",
      context: [
        { line: 9, text: "const before = true;" },
        { line: 11, text: "const after = true;" },
      ],
    },
  ]);
});
