import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commands } from "../../src/registry.js";

const repoRoot = process.cwd();
const cli = join(repoRoot, "src", "cli.ts");

function runCli(args: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (!options.allowFailure) {
    assert.equal(result.stderr, "");
  }
  return result;
}

test("schema emits parseable JSON with every registered command", () => {
  const result = runCli(["schema"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.commands.map((c: { path: string[] }) => c.path), commands.map((c) => c.path));
  assert.deepEqual(parsed.envelope.successEnvelope, ["ok", "command", "data"]);
  assert.deepEqual(parsed.envelope.optionalSuccessFields, ["warnings"]);
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
  assert.equal(parsed.warnings, undefined);
  assert.equal(parsed.timingMs, undefined);
});

test("search emits compact JSON with matches and counts", () => {
  const result = runCli(["search", "xray", "--root", ".", "--glob", "README.md"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "search");
  assert.equal(parsed.warnings, undefined);
  assert.equal(parsed.timingMs, undefined);
  assert.ok(Array.isArray(parsed.data.matches));
  assert.equal(typeof parsed.data.summary.matchCount, "number");
  assert.equal(typeof parsed.data.summary.fileCount, "number");
  assert.equal(parsed.data.summary.truncated, undefined);
  assert.equal(parsed.data.summary.timedOut, undefined);
  assert.equal(parsed.data.summary.root, undefined);
  assert.equal(parsed.data.summary.scope, undefined);
  assert.equal(parsed.data.summary.mode, undefined);
  assert.equal(parsed.data.summary.strategy, undefined);
  assert.equal(parsed.data.summary.plan, undefined);
  assert.equal(parsed.data.command, undefined);
  assert.equal(parsed.data.regex, undefined);
  assert.equal(parsed.data.metrics.backend, "ripgrep");
  assert.equal(typeof parsed.data.metrics.runs, "number");
  assert.equal(typeof parsed.data.metrics.lanes, "number");
  assert.equal(typeof parsed.data.metrics.elapsedMs, "number");
  assert.deepEqual(Object.keys(parsed.data.metrics.events).sort(), ["context", "fileBegin", "json", "match"]);
  assert.equal(parsed.data.metrics.root, undefined);
  assert.equal(parsed.data.metrics.query, undefined);
  assert.equal(parsed.data.metrics.files, undefined);
  assert.ok(parsed.data.matches.every((match: { context?: unknown[] }) => match.context === undefined));
});

test("search timeout is explicit milliseconds only", () => {
  const timeoutMs = runCli(["search", "xray", "--root", ".", "--glob", "README.md", "--timeoutMs", "30000"]);
  assert.equal(timeoutMs.status, 0);
  assert.equal(JSON.parse(timeoutMs.stdout).warnings, undefined);

  const timeout = runCli(["search", "xray", "--root", ".", "--glob", "README.md", "--timeout", "30000"], { allowFailure: true });
  assert.notEqual(timeout.status, 0);
  assert.match(timeout.stderr, /unknown option '--timeout'/u);
});

test("search supports option-looking query literals through --query", () => {
  const result = runCli(["search", "--query", "--timeoutMs", "--root", ".", "--glob", "README.md", "--timeoutMs", "30000"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.data.matches.length > 0);
});

test("search supports --no-smart without exposing planner metadata", () => {
  const smart = runCli(["search", "xray", "--root", ".", "--max", "5"]);
  assert.equal(smart.status, 0);
  const smartSummary = JSON.parse(smart.stdout).data.summary;
  assert.equal(smartSummary.mode, undefined);
  assert.equal(smartSummary.strategy, undefined);

  const noSmart = runCli(["search", "xray", "--root", ".", "--no-smart"]);
  assert.equal(noSmart.status, 0);
  const parsed = JSON.parse(noSmart.stdout);
  assert.equal(parsed.data.summary.mode, undefined);
  assert.equal(parsed.data.summary.strategy, undefined);
});

test("search emits context only when requested", () => {
  const result = runCli(["search", "Agent contract", "--root", ".", "--glob", "README.md", "--context", "1"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.data.matches.some((match: { context?: unknown[] }) => Array.isArray(match.context) && match.context.length > 0));
});

test("search emits warnings only when present", () => {
  const result = runCli(["search", "xray", "--root", ".", "--max", "1"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.warnings, ["display capped at 1 matches"]);
  assert.equal(parsed.data.summary.truncated, true);
  assert.equal(parsed.data.summary.timedOut, undefined);
});
