import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitPullMadeNoChanges, runSelfUpdate } from "../../src/commands/update.js";

test("update skips install and build when pull keeps the same revision", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "xray-update-"));
  const calls: string[] = [];
  try {
    const result = await runSelfUpdate({
      repoRoot,
      isGitRepo: () => true,
      runCommand: async (command, args) => {
        calls.push([command, ...args].join(" "));
        if (command === "git" && args.join(" ") === "rev-parse HEAD") {
          return { stdout: "abc123\n", stderr: "" };
        }
        return { stdout: "Already up to date.\n", stderr: "" };
      },
    });
    assert.deepEqual(calls, ["git rev-parse HEAD", "git pull --ff-only", "git rev-parse HEAD"]);
    assert.equal(result.alreadyUpToDate, true);
    assert.equal(result.installed, false);
    assert.equal(result.built, false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("update installs and builds when pull changes the revision", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "xray-update-"));
  const revisions = ["abc123\n", "def456\n"];
  const calls: string[] = [];
  try {
    const result = await runSelfUpdate({
      repoRoot,
      isGitRepo: () => true,
      runCommand: async (command, args) => {
        calls.push([command, ...args].join(" "));
        if (command === "git" && args.join(" ") === "rev-parse HEAD") {
          return { stdout: revisions.shift() ?? "def456\n", stderr: "" };
        }
        return { stdout: "Fast-forward\n", stderr: "" };
      },
    });
    assert.deepEqual(calls, [
      "git rev-parse HEAD",
      "git pull --ff-only",
      "git rev-parse HEAD",
      "npm install --no-audit --no-fund",
      "npm run build",
    ]);
    assert.equal(result.pulled, true);
    assert.equal(result.installed, true);
    assert.equal(result.built, true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("update fails clearly when install directory is not a git repo", async () => {
  await assert.rejects(
    () => runSelfUpdate({ repoRoot: "not-a-repo", isGitRepo: () => false }),
    /not a git repo/i,
  );
});

test("legacy git pull no-change output is recognized", () => {
  assert.equal(gitPullMadeNoChanges("Already up-to-date."), true);
  assert.equal(gitPullMadeNoChanges("Fast-forward\n package.json | 2 +-"), false);
});
