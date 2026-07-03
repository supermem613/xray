import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runXraySearch } from "../../src/core/search.js";

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

test("search --all reaches hidden, gitignored, and default-excluded files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "xray-all-"));
  try {
    git(workspace, ["init", "-b", "main"]);
    await writeFile(join(workspace, ".gitignore"), "ignored.txt\n", "utf8");
    await writeFile(join(workspace, "normal.txt"), "token here\n", "utf8");
    await writeFile(join(workspace, "ignored.txt"), "token here\n", "utf8");
    await mkdir(join(workspace, ".hiddendir"), { recursive: true });
    await writeFile(join(workspace, ".hiddendir", "hidden.txt"), "token here\n", "utf8");
    await mkdir(join(workspace, "node_modules", "dep"), { recursive: true });
    await writeFile(join(workspace, "node_modules", "dep", "index.js"), "token here\n", "utf8");

    const def = await runXraySearch(baseOptions("token", workspace));
    assert.deepEqual(
      def.matches.map((m) => normalizePath(m.path)).sort(),
      ["normal.txt"],
    );

    const all = await runXraySearch({ ...baseOptions("token", workspace), all: true });
    const allPaths = all.matches.map((m) => normalizePath(m.path)).sort();
    assert.ok(allPaths.includes("normal.txt"), "all keeps normal file");
    assert.ok(allPaths.includes("ignored.txt"), "all reaches gitignored file");
    assert.ok(allPaths.includes(".hiddendir/hidden.txt"), "all reaches hidden dir");
    assert.ok(allPaths.includes("node_modules/dep/index.js"), "all reaches default-excluded dir");
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
    max: 50,
    timeoutMs: 15000,
    regex: false,
    smart: true,
    all: false,
  };
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}
