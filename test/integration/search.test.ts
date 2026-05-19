import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
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

test("search defaults to git repo files and supports tracked-only scope", async () => {
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

    const trackedOnly = await runXraySearch({ ...baseOptions("needle", workspace), trackedOnly: true });
    assert.equal(trackedOnly.matchCount, 2);
    assert.deepEqual(
      trackedOnly.matches.map((m) => normalizePath(m.path)).sort(),
      ["other/tracked.txt", "src/tracked.txt"],
    );
    assert.match(trackedOnly.scope, /^git-tracked files/);

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

test("tracked-only search handles an alias path to the git root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "xray-alias-"));
  const workspace = join(parent, "real");
  const alias = join(parent, "alias");
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    git(workspace, ["init", "-b", "main"]);
    await writeFile(join(workspace, "src", "tracked.txt"), "tracked needle\n", "utf8");
    git(workspace, ["add", "src/tracked.txt"]);
    await symlink(workspace, alias, process.platform === "win32" ? "junction" : "dir");

    const result = await runXraySearch({ ...baseOptions("needle", alias), trackedOnly: true });
    assert.equal(result.matchCount, 1);
    assert.deepEqual(result.matches.map((m) => normalizePath(m.path)), ["src/tracked.txt"]);
    assert.match(result.scope, /^git-tracked files/);
  } finally {
    await rm(parent, { recursive: true, force: true });
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
    trackedOnly: false,
  };
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}
