import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addExamples, writeJson, writeSuccessJson } from "./common.js";
import { getCommandEntry } from "../registry.js";

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type UpdateDeps = {
  repoRoot?: string;
  isGitRepo?: (dir: string) => boolean;
  runCommand?: (command: string, args: string[], cwd: string) => Promise<CommandResult>;
};

export type UpdateResult = {
  repoRoot: string;
  beforeRevision: string | null;
  afterRevision: string | null;
  pulled: boolean;
  alreadyUpToDate: boolean;
  installed: boolean;
  built: boolean;
};

const OUTPUT_LIMIT = 64 * 1024;

export function gitPullMadeNoChanges(output: string): boolean {
  return /already up[- ]to[- ]date\.?/i.test(output);
}

function defaultIsGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

function repoRootFromModule(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return dirname(dirname(dirname(thisFile)));
}

async function defaultRunCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: command === "npm" && process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_LIMIT) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_LIMIT) {
        stderr += chunk.toString("utf8");
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

async function currentRevision(runCommand: NonNullable<UpdateDeps["runCommand"]>, repoRoot: string): Promise<string | null> {
  const result = await runCommand("git", ["rev-parse", "HEAD"], repoRoot);
  return result.stdout.trim() || null;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runSelfUpdate(deps: UpdateDeps = {}): Promise<UpdateResult> {
  const repoRoot = deps.repoRoot ?? repoRootFromModule();
  const checkGitRepo = deps.isGitRepo ?? defaultIsGitRepo;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  if (!checkGitRepo(repoRoot)) {
    throw new Error("Xray install directory is not a git repo. Reinstall by cloning the repository, then run npm install and npm link.");
  }

  const beforeRevision = await currentRevision(runCommand, repoRoot);
  await runCommand("git", ["pull", "--ff-only"], repoRoot);
  const afterRevision = await currentRevision(runCommand, repoRoot);
  const alreadyUpToDate = beforeRevision === afterRevision;

  if (alreadyUpToDate) {
    return {
      repoRoot,
      beforeRevision,
      afterRevision,
      pulled: false,
      alreadyUpToDate: true,
      installed: false,
      built: false,
    };
  }

  await runCommand("npm", ["install", "--no-audit", "--no-fund"], repoRoot);
  await runCommand("npm", ["run", "build"], repoRoot);
  return {
    repoRoot,
    beforeRevision,
    afterRevision,
    pulled: true,
    alreadyUpToDate: false,
    installed: true,
    built: true,
  };
}

export async function updateCommand(deps: UpdateDeps = {}): Promise<void> {
  try {
    const result = await runSelfUpdate(deps);
    writeSuccessJson("update", result);
  } catch (err: unknown) {
    const hint = formatError(err);
    writeJson({ ok: false, command: "update", error: "UPDATE_FAILED", hint });
    process.exitCode = 1;
  }
}

export function registerUpdate(program: Command): void {
  const entry = getCommandEntry(["update"]);
  addExamples(program
    .command("update")
    .description(entry.summary)
    .action(() => updateCommand()), entry);
}
