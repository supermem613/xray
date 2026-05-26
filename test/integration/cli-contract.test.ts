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

test("search emits compact JSON with matches and summary", () => {
  const result = runCli(["search", "xray", "--root", ".", "--glob", "README.md"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "search");
  assert.ok(Array.isArray(parsed.data.matches));
  assert.equal(typeof parsed.data.summary.root, "string");
  assert.equal(typeof parsed.data.summary.scope, "string");
  assert.equal(typeof parsed.data.summary.matchCount, "number");
  assert.equal(typeof parsed.data.summary.fileCount, "number");
  assert.equal(typeof parsed.data.summary.truncated, "boolean");
  assert.equal(typeof parsed.data.summary.timedOut, "boolean");
  assert.equal(typeof parsed.data.summary.elapsedMs, "number");
  assert.equal(parsed.data.summary.mode, "sequential");
  assert.equal(parsed.data.summary.plan.strategy, "sequential");
  assert.equal(parsed.data.command, undefined);
  assert.equal(parsed.data.regex, undefined);
  assert.ok(parsed.data.matches.some((match: { context?: unknown[] }) => Array.isArray(match.context) && match.context.length > 0));
});

test("search timeout is explicit milliseconds only", () => {
  const timeoutMs = runCli(["search", "xray", "--root", ".", "--glob", "README.md", "--timeoutMs", "30000"]);
  assert.equal(timeoutMs.status, 0);
  assert.deepEqual(JSON.parse(timeoutMs.stdout).warnings, []);

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

test("search defaults to smart mode and supports --no-smart", () => {
  const smart = runCli(["search", "xray", "--root", ".", "--max", "5"]);
  assert.equal(smart.status, 0);
  const smartSummary = JSON.parse(smart.stdout).data.summary;
  assert.equal(smartSummary.mode, "smart");
  assert.ok(["sequential", "narrowed", "fanout"].includes(smartSummary.plan.strategy));
  assert.equal(Array.isArray(smartSummary.plan.buckets), true);

  const noSmart = runCli(["search", "xray", "--root", ".", "--no-smart"]);
  assert.equal(noSmart.status, 0);
  const parsed = JSON.parse(noSmart.stdout);
  assert.equal(parsed.data.summary.mode, "sequential");
  assert.equal(parsed.data.summary.plan.reason, "requested by --no-smart");
});

test("search supports compact output with explicit zero context", () => {
  const result = runCli(["search", "Agent contract", "--root", ".", "--glob", "README.md", "--context", "0"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.data.matches.every((match: { context?: unknown[] }) => Array.isArray(match.context) && match.context.length === 0));
});
