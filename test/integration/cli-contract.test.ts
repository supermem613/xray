import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commands } from "../../src/registry.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "src", "cli.ts");

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.stderr, "");
  return result;
}

test("schema emits parseable JSON with every registered command", () => {
  const result = runCli(["schema"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.commands.map((c: { path: string[] }) => c.path), commands.map((c) => c.path));
  assert.deepEqual(parsed.envelope.successEnvelope, ["ok", "command", "data", "warnings", "timingMs"]);
});

test("schema summary supports command prefix filtering", () => {
  const result = runCli(["schema", "search", "--summary"]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).commands, [["search"]]);
});

test("help and README cover every registered command example", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  for (const entry of commands) {
    const help = runCli([...entry.path, "--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, new RegExp(entry.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    for (const example of entry.examples) {
      assert.match(help.stdout, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(readme, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

test("doctor emits the standard JSON envelope", () => {
  const result = runCli(["doctor"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "doctor");
  assert.ok(Array.isArray(parsed.data.checks));
  assert.deepEqual(parsed.warnings, []);
  assert.equal(typeof parsed.timingMs, "number");
});
