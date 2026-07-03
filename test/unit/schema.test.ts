import test from "node:test";
import assert from "node:assert/strict";
import { commands } from "../../src/registry.js";

test("registry includes baseline commands", () => {
  assert.deepEqual(commands.map((c) => c.path.join(" ")).sort(), ["doctor", "files", "schema", "search", "update"]);
});
