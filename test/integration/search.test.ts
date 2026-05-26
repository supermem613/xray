import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runXraySearch } from "../../src/core/search.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

test("search defaults to git repo files plus non-ignored untracked files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-integration-"));
  try {
    git(workspace, ["init", "-b", "main"]);
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "other"), { recursive: true });
    await writeFile(join(workspace, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(workspace, "src", "tracked.txt"), "tracked needle\n", "utf8");
    await writeFile(join(workspace, "src", "untracked.txt"), "untracked needle\n", "utf8");
    await writeFile(join(workspace, "src", "ignored.txt"), "ignored needle\n", "utf8");
    await writeFile(join(workspace, "src", "regex.txt"), "abc123\n", "utf8");
    await writeFile(join(workspace, "other", "tracked.txt"), "tracked needle outside src\n", "utf8");
    git(workspace, ["add", ".gitignore", "src/tracked.txt", "src/regex.txt", "other/tracked.txt"]);

    const defaultScope = await runXraySearch(baseOptions("needle", workspace));
    assert.equal(defaultScope.matchCount, 3);
    assert.deepEqual(
      defaultScope.matches.map((m) => normalizePath(m.path)).sort(),
      ["other/tracked.txt", "src/tracked.txt", "src/untracked.txt"],
    );
    assert.equal(defaultScope.scope, "git repo files plus untracked non-ignored files");

    const subdir = await runXraySearch(baseOptions("needle", join(workspace, "src")));
    assert.equal(subdir.matchCount, 2);
    assert.deepEqual(
      subdir.matches.map((m) => normalizePath(m.path)).sort(),
      ["tracked.txt", "untracked.txt"],
    );

    const regex = await runXraySearch({
      ...baseOptions("abc\\d+", workspace),
      regex: true,
      globs: ["src/**"],
    });
    assert.equal(regex.matchCount, 1);
    assert.equal(normalizePath(regex.matches[0]?.path ?? ""), "src/regex.txt");

    const exactCap = await runXraySearch({ ...baseOptions("abc123", workspace), max: 1 });
    assert.equal(exactCap.matchCount, 1);
    assert.equal(exactCap.truncated, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("search works outside a git repository without extra flags", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-nongit-"));
  try {
    await writeFile(join(workspace, "note.txt"), "plain needle\n", "utf8");

    const result = await runXraySearch(baseOptions("needle", workspace));
    assert.equal(result.matchCount, 1);
    assert.equal(normalizePath(result.matches[0]?.path ?? ""), "note.txt");
    assert.equal(result.scope, "non-git root");
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("search accepts a file path as the root", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-file-root-"));
  try {
    await writeFile(join(workspace, "target.log"), "needle in target\n", "utf8");
    await writeFile(join(workspace, "other.log"), "needle outside target\n", "utf8");

    const result = await runXraySearch(baseOptions("needle", join(workspace, "target.log")));
    assert.equal(result.matchCount, 1);
    assert.equal(normalizePath(result.matches[0]?.path ?? ""), "target.log");
    assert.equal(result.scope, "single file");
    assert.equal(result.mode, "sequential");
    assert.equal(result.plan.reason, "explicit file root");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("smart search defaults to markdown code everything fanout and preserves sequential results", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-"));
  try {
    await writeFile(join(workspace, "package.json"), "{\"name\":\"needle\"}\n", "utf8");
    await writeFile(join(workspace, "README.md"), "docs needle\n", "utf8");
    await writeFile(join(workspace, "index.html"), "<p>web needle</p>\n", "utf8");
    await writeFile(join(workspace, "main.ts"), "const value = 'code needle';\n", "utf8");
    await writeFile(join(workspace, "blob.xyz"), "other needle\n", "utf8");

    const smart = await runXraySearch(baseOptions("needle", workspace));
    const sequential = await runXraySearch({ ...baseOptions("needle", workspace), smart: false });

    assert.equal(smart.mode, "smart");
    assert.equal(smart.plan.strategy, "fanout");
    assert.equal(smart.plan.reason, "default markdown/code/everything fanout");
    assert.deepEqual(smart.plan.buckets.map((bucket) => bucket.name), ["markdown", "code", "everything"]);
    assert.equal(sequential.mode, "sequential");
    assert.deepEqual(matchKeys(smart), matchKeys(sequential));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("smart search narrows extension-like queries and falls back on zero matches", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-narrow-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "docs mention controller.ts\n", "utf8");
    await writeFile(join(workspace, "src", "main.ts"), "export function unrelated() {}\n", "utf8");

    const result = await runXraySearch(baseOptions("controller.ts", workspace));
    assert.equal(result.mode, "smart");
    assert.equal(result.plan.strategy, "sequential");
    assert.match(result.plan.reason, /fell back to broad search/u);
    assert.deepEqual(result.matches.map((m) => normalizePath(m.path)), ["README.md"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("smart search fans out non-markdown non-code extensions across all lanes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-everything-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "package.json"), "{\"name\":\"package.json\"}\n", "utf8");
    await writeFile(join(workspace, "README.md"), "docs mention package.json\n", "utf8");
    await writeFile(join(workspace, "src", "main.ts"), "const file = 'package.json';\n", "utf8");

    const smart = await runXraySearch(baseOptions("package.json", workspace));
    assert.equal(smart.mode, "smart");
    assert.equal(smart.plan.strategy, "fanout");
    assert.deepEqual(smart.plan.buckets.map((bucket) => bucket.name), ["markdown", "code", "everything"]);
    assert.deepEqual(smart.matches.map((m) => normalizePath(m.path)).sort(), ["README.md", "package.json", "src/main.ts"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("smart narrowed markdown and code searches preserve sequential matches when lane is complete", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-lane-complete-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "README.md"), "README.md in docs\n", "utf8");
    await writeFile(join(workspace, "README.md"), "top README.md\n", "utf8");
    await writeFile(join(workspace, "src", "controller.ts"), "controller.ts implementation\n", "utf8");
    await writeFile(join(workspace, "src", "other.ts"), "controller.ts reference\n", "utf8");

    for (const query of ["README.md", "controller.ts"]) {
      const smart = await runXraySearch(baseOptions(query, workspace));
      const sequential = await runXraySearch({ ...baseOptions(query, workspace), smart: false });
      assert.notEqual(smart.plan.strategy, "sequential", query);
      assert.deepEqual(matchKeys(smart), matchKeys(sequential), query);
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("smart fanout uses three mechanical lanes and preserves the global display cap", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-fanout-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "docs"), { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      await writeFile(join(workspace, "src", `todo-${i}.ts`), `// TODO auth code ${i}\n`, "utf8");
      await writeFile(join(workspace, "docs", `todo-${i}.md`), `TODO auth docs ${i}\n`, "utf8");
    }

    const result = await runXraySearch({ ...baseOptions("TODO auth", workspace), max: 3 });
    assert.equal(result.mode, "smart");
    assert.equal(result.plan.strategy, "fanout");
    assert.deepEqual(result.plan.buckets.map((bucket) => bucket.name), ["markdown", "code", "everything"]);
    assert.equal(result.matches.length, 3);
    assert.equal(result.truncated, true);
    assert.ok(result.matchCount > result.matches.length);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("smart fanout deduplicates overlapping lane results", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-dedupe-"));
  try {
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "todo.txt"), "TODO auth only once\n", "utf8");

    const result = await runXraySearch(baseOptions("TODO auth", workspace));
    assert.equal(result.mode, "smart");
    assert.equal(result.plan.strategy, "fanout");
    assert.deepEqual(matchKeys(result), ["docs/todo.txt:1:TODO auth only once"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("regex smart search remains broad and preserves sequential matches", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-smart-regex-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await writeFile(join(workspace, "README.md"), "runXraySearch in docs\n", "utf8");
    await writeFile(join(workspace, "src", "main.ts"), "runXrayDoctor in code\n", "utf8");

    const smart = await runXraySearch({ ...baseOptions("runXray(Search|Doctor)", workspace), regex: true });
    const sequential = await runXraySearch({ ...baseOptions("runXray(Search|Doctor)", workspace), regex: true, smart: false });
    assert.equal(smart.mode, "smart");
    assert.equal(smart.plan.strategy, "sequential");
    assert.equal(smart.plan.reason, "regex search uses one rg walk");
    assert.deepEqual(matchKeys(smart), matchKeys(sequential));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("explicit glob and type filters use the sequential search path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-explicit-"));
  try {
    await writeFile(join(workspace, "README.md"), "docs needle\n", "utf8");
    await writeFile(join(workspace, "main.ts"), "code needle\n", "utf8");

    const globbed = await runXraySearch({ ...baseOptions("needle", workspace), globs: ["**/*.md"] });
    assert.equal(globbed.mode, "sequential");
    assert.equal(globbed.plan.reason, "explicit glob or type filter");
    assert.deepEqual(globbed.matches.map((m) => normalizePath(m.path)), ["README.md"]);

    const typed = await runXraySearch({ ...baseOptions("needle", workspace), types: ["ts"] });
    assert.equal(typed.mode, "sequential");
    assert.deepEqual(typed.matches.map((m) => normalizePath(m.path)), ["main.ts"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("search streams matches and marks truncated after the display cap", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-stream-cap-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    for (let i = 0; i < 8; i += 1) {
      await writeFile(join(workspace, "src", `file-${i}.txt`), `needle ${i}\n`, "utf8");
    }

    const result = await runXraySearch({ ...baseOptions("needle", workspace), max: 3 });
    assert.equal(result.mode, "smart");
    assert.equal(result.matches.length, 3);
    assert.equal(result.truncated, true);
    assert.ok(result.matchCount > result.matches.length);
    assert.deepEqual(result.warnings, ["display capped at 3 matches"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function baseOptions(query: string, root: string) {
  return {
    query,
    root,
    globs: [] as string[],
    types: [] as string[],
    context: 0,
    max: 10,
    timeoutMs: 5000,
    regex: false,
    smart: true,
  };
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function matchKeys(result: Awaited<ReturnType<typeof runXraySearch>>): string[] {
  return result.matches
    .map((match) => `${normalizePath(match.path)}:${match.line}:${match.text}`)
    .sort();
}
