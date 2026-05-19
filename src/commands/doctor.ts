import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { resolveBundledRgPath } from "../core/rg-path.js";
import { addExamples, writeJson } from "./common.js";
import { getCommandEntry } from "../registry.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

export function registerDoctor(program: Command): void {
  const entry = getCommandEntry(["doctor"]);
  addExamples(program
    .command("doctor")
    .description(entry.summary)
    .action(() => {
      const checks = runDoctorChecks();
      const ok = checks.every((c) => c.ok);
      writeJson({ ok, command: "doctor", data: { checks }, warnings: [], timingMs: 0 });
      if (!ok) {
        process.exitCode = 1;
      }
    }), entry);
}

export function runDoctorChecks(): CheckResult[] {
  const rgPath = resolveBundledRgPath();
  const rg = rgPath
    ? spawnSync(rgPath, ["--version"], { encoding: "utf8" })
    : null;
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  return [
    {
      name: "bundled-ripgrep",
      ok: !!rgPath && rg?.status === 0,
      detail: rgPath ? `${rgPath} ${(rg?.stdout ?? "").split(/\r?\n/)[0] ?? ""}`.trim() : "not found",
      hint: "Run npm install to install @vscode/ripgrep.",
    },
    {
      name: "git",
      ok: git.status === 0,
      detail: git.status === 0 ? git.stdout.trim() : (git.stderr || "git not found").trim(),
      hint: "Install git and ensure it is on PATH.",
    },
  ];
}

