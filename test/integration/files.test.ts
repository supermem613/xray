import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runXrayFiles } from "../../src/core/files.js";

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function paths(result: Awaited<ReturnType<typeof runXrayFiles>>): string[] {
  return result.matches.map((m) => normalizePath(m.path)).sort();
}

function baseOptions(root: string) {
  return {
    query: null as string | null,
    root,
    globs: [] as string[],
    types: [] as string[],
    max: 100,
    timeoutMs: 15000,
    regex: false,
    all: false,
  };
}

test("files lists all in-scope paths without a query", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-"));
  try {
    git(ws, ["init", "-b", "main"]);
    await writeFile(join(ws, ".gitignore"), "ignored.log\n", "utf8");
    await writeFile(join(ws, "a.txt"), "alpha needle\n", "utf8");
    await writeFile(join(ws, "b.txt"), "beta\n", "utf8");
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "c.ts"), "const needle = 1;\n", "utf8");
    await writeFile(join(ws, "ignored.log"), "hidden from default\n", "utf8");
    await writeFile(join(ws, ".secret.txt"), "dot file\n", "utf8");
    await mkdir(join(ws, "node_modules", "dep"), { recursive: true });
    await writeFile(join(ws, "node_modules", "dep", "index.js"), "vendor\n", "utf8");

    const res = await runXrayFiles(baseOptions(ws));
    assert.deepEqual(paths(res), ["a.txt", "b.txt", "src/c.ts"]);
    assert.equal(res.fileCount, 3);
    assert.equal(res.truncated, false);
    assert.equal(res.timedOut, false);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.metrics.backend, "ripgrep");
    assert.equal(res.metrics.runs, 1);
    assert.equal(res.metrics.lanes, 1);
    assert.equal(typeof res.metrics.elapsedMs, "number");
    assert.ok(res.matches.every((m) => typeof m.path === "string" && Object.keys(m).length === 1));
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("files with a query lists only files containing it", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-q-"));
  try {
    git(ws, ["init", "-b", "main"]);
    await writeFile(join(ws, "a.txt"), "alpha needle\n", "utf8");
    await writeFile(join(ws, "b.txt"), "beta only\n", "utf8");
    await mkdir(join(ws, "src"), { recursive: true });
    await writeFile(join(ws, "src", "c.ts"), "const needle = 1;\n", "utf8");

    const res = await runXrayFiles({ ...baseOptions(ws), query: "needle" });
    assert.deepEqual(paths(res), ["a.txt", "src/c.ts"]);
    assert.equal(res.fileCount, 2);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("files --max caps the number of files and marks truncated", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-cap-"));
  try {
    await mkdir(join(ws, "d"), { recursive: true });
    for (let i = 0; i < 6; i += 1) {
      await writeFile(join(ws, "d", `f-${i}.txt`), `body ${i}\n`, "utf8");
    }
    const res = await runXrayFiles({ ...baseOptions(ws), max: 2 });
    assert.equal(res.matches.length, 2);
    assert.equal(res.fileCount, 2);
    assert.equal(res.truncated, true);
    assert.deepEqual(res.warnings, ["display capped at 2 files"]);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("files honors glob and type filters", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-glob-"));
  try {
    await writeFile(join(ws, "keep.ts"), "x\n", "utf8");
    await writeFile(join(ws, "skip.md"), "y\n", "utf8");

    const globbed = await runXrayFiles({ ...baseOptions(ws), globs: ["**/*.ts"] });
    assert.deepEqual(paths(globbed), ["keep.ts"]);

    const typed = await runXrayFiles({ ...baseOptions(ws), types: ["ts"] });
    assert.deepEqual(paths(typed), ["keep.ts"]);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("files scopes to a single file when the root is a file path", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-fileroot-"));
  try {
    await writeFile(join(ws, "target.txt"), "needle here\n", "utf8");
    await writeFile(join(ws, "other.txt"), "needle too\n", "utf8");

    const listed = await runXrayFiles(baseOptions(join(ws, "target.txt")));
    assert.deepEqual(paths(listed), ["target.txt"]);

    const queried = await runXrayFiles({ ...baseOptions(join(ws, "target.txt")), query: "needle" });
    assert.deepEqual(paths(queried), ["target.txt"]);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("files --all includes hidden, gitignored, and vendor paths", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-all-"));
  try {
    git(ws, ["init", "-b", "main"]);
    await writeFile(join(ws, ".gitignore"), "ignored.log\n", "utf8");
    await writeFile(join(ws, "a.txt"), "x\n", "utf8");
    await writeFile(join(ws, "ignored.log"), "x\n", "utf8");
    await writeFile(join(ws, ".secret.txt"), "x\n", "utf8");
    await mkdir(join(ws, "node_modules", "dep"), { recursive: true });
    await writeFile(join(ws, "node_modules", "dep", "index.js"), "x\n", "utf8");

    const res = await runXrayFiles({ ...baseOptions(ws), all: true, max: 1000 });
    const p = paths(res);
    assert.ok(p.includes("a.txt"), "keeps normal file");
    assert.ok(p.includes("ignored.log"), "reaches gitignored file");
    assert.ok(p.includes(".secret.txt"), "reaches hidden dotfile");
    assert.ok(p.includes("node_modules/dep/index.js"), "reaches vendor dir");
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test("files works outside a git repository", async () => {
  const ws = await mkdtemp(join(tmpdir(), "xray-files-nongit-"));
  try {
    await writeFile(join(ws, "only.txt"), "hi\n", "utf8");
    const res = await runXrayFiles(baseOptions(ws));
    assert.deepEqual(paths(res), ["only.txt"]);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});
