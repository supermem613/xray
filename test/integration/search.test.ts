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

test("search defaults to git-tracked files and supports subdir roots", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-integration-"));
  try {
    git(workspace, ["init", "-b", "main"]);
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "other"), { recursive: true });
    await writeFile(join(workspace, "src", "tracked.txt"), "tracked needle\n", "utf8");
    await writeFile(join(workspace, "src", "untracked.txt"), "untracked needle\n", "utf8");
    await writeFile(join(workspace, "src", "regex.txt"), "abc123\n", "utf8");
    await writeFile(join(workspace, "other", "tracked.txt"), "tracked needle outside src\n", "utf8");
    git(workspace, ["add", "src/tracked.txt", "src/regex.txt", "other/tracked.txt"]);

    const tracked = await runXraySearch(baseOptions("needle", workspace));
    assert.equal(tracked.matchCount, 2);
    assert.deepEqual(
      tracked.matches.map((m) => m.path.replaceAll("\\", "/")).sort(),
      ["other/tracked.txt", "src/tracked.txt"],
    );

    const subdir = await runXraySearch(baseOptions("needle", join(workspace, "src")));
    assert.equal(subdir.matchCount, 1);
    assert.equal(subdir.matches[0]?.path.replaceAll("\\", "/"), "tracked.txt");

    const includeUntracked = await runXraySearch({ ...baseOptions("needle", workspace), includeUntracked: true });
    assert.equal(includeUntracked.matchCount, 3);

    const regex = await runXraySearch({
      ...baseOptions("abc\\d+", workspace),
      regex: true,
      globs: ["src/**"],
    });
    assert.equal(regex.matchCount, 1);
    assert.equal(regex.matches[0]?.path.replaceAll("\\", "/"), "src/regex.txt");

    const exactCap = await runXraySearch({ ...baseOptions("abc123", workspace), max: 1 });
    assert.equal(exactCap.matchCount, 1);
    assert.equal(exactCap.truncated, false);
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
    includeUntracked: false,
    allowBroad: false,
  };
}
