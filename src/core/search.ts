import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveBundledRgPath } from "./rg-path.js";

const DEFAULT_EXCLUDES = [
  "!**/.git/**",
  "!**/node_modules/**",
  "!**/.copilot/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.next/**",
  "!**/coverage/**",
  "!**/.cache/**",
  "!AppData/**",
];

export interface SearchOptions {
  query: string;
  root: string | null;
  globs: string[];
  types: string[];
  context: number;
  max: number;
  timeoutMs: number;
  regex: boolean;
  trackedOnly: boolean;
}

export interface MatchResult {
  path: string;
  line: number | null;
  text: string;
  context: MatchContextLine[];
}

export interface MatchContextLine {
  line: number | null;
  text: string;
}

type PendingContextLine = MatchContextLine & { path: string };

export interface SearchEnvelope {
  root: string;
  scope: string;
  regex: boolean;
  elapsedMs: number;
  timedOut: boolean;
  truncated: boolean;
  matchCount: number;
  fileCount: number;
  matches: MatchResult[];
  warnings: string[];
  command: string[];
}

interface RootInfo {
  root: string;
  realRoot: string;
  gitRoot: string | null;
  realGitRoot: string | null;
  git: boolean;
}

interface ScopeInfo {
  paths: string[] | null;
  label: string;
  receipt: string;
  warning: string | null;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export async function runXraySearch(opts: SearchOptions): Promise<SearchEnvelope> {
  const start = Date.now();
  const rootInfo = await resolveRoot(opts.root);
  const rgPath = resolveBundledRgPath() ?? "rg";
  const warnings: string[] = [];

  const baseArgs = [
    "--json",
    "--color", "never",
    "--max-filesize", "2M",
    "--max-count", String(Math.max(opts.max, 1)),
  ];
  if (!opts.regex) {
    baseArgs.push("--fixed-strings");
  }
  if (opts.context > 0) {
    baseArgs.push("-C", String(opts.context));
  }
  for (const g of DEFAULT_EXCLUDES) {
    baseArgs.push("--glob", g);
  }
  for (const g of opts.globs) {
    baseArgs.push("--glob", g);
  }
  for (const t of opts.types) {
    baseArgs.push("--type", t);
  }

  const scope = await buildScope(rootInfo, opts.trackedOnly);
  const child = scope.paths
    ? await runRipgrepPathChunks(rgPath, baseArgs, opts.query, scope.paths, {
      cwd: rootInfo.root,
      timeoutMs: opts.timeoutMs,
      maxMatches: opts.max,
    })
    : await runRipgrep(rgPath, [...baseArgs, opts.query, "."], {
      cwd: rootInfo.root,
      timeoutMs: opts.timeoutMs,
      maxMatches: opts.max,
    });
  if (child.timedOut) {
    warnings.push(`search stopped after ${opts.timeoutMs} ms`);
  }
  if (child.truncated) {
    warnings.push(`display capped at ${opts.max} matches; narrow the root, glob, type, or query`);
  }
  if (scope.warning) {
    warnings.push(scope.warning);
  }

  return {
    root: rootInfo.root,
    scope: scope.label,
    regex: opts.regex,
    elapsedMs: Date.now() - start,
    timedOut: child.timedOut,
    truncated: child.truncated,
    matchCount: child.totalMatches,
    fileCount: child.files.size,
    matches: child.matches,
    warnings,
    command: [rgPath, ...baseArgs, opts.query, scope.receipt],
  };
}

export async function resolveRoot(explicitRoot: string | null): Promise<RootInfo> {
  const base = explicitRoot ? path.resolve(explicitRoot) : process.cwd();
  if (!fs.existsSync(base)) {
    throw new Error(`root does not exist: ${base}`);
  }
  const realRoot = fs.realpathSync.native(base);
  const gitRoot = await getGitRoot(base);
  if (gitRoot) {
    return { root: base, realRoot, gitRoot, realGitRoot: fs.realpathSync.native(gitRoot), git: true };
  }
  return { root: base, realRoot, gitRoot: null, realGitRoot: null, git: false };
}

async function getGitRoot(cwd: string): Promise<string | null> {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeoutMs: 2000,
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  const root = result.stdout.trim();
  return root ? path.resolve(root) : null;
}

async function buildScope(rootInfo: RootInfo, trackedOnly: boolean): Promise<ScopeInfo> {
  if (!rootInfo.git || !trackedOnly) {
    return {
      paths: null,
      label: rootInfo.git ? "git repo files plus untracked non-ignored files" : "non-git root",
      receipt: ".",
      warning: null,
    };
  }

  const relativeRoot = path.relative(rootInfo.realGitRoot!, rootInfo.realRoot);
  const gitArgs = ["ls-files"];
  if (relativeRoot && !relativeRoot.startsWith("..") && !path.isAbsolute(relativeRoot)) {
    gitArgs.push("--", normalizeGitPath(relativeRoot));
  }
  const files = await runCommand("git", gitArgs, {
    cwd: rootInfo.gitRoot!,
    timeoutMs: 5000,
  });
  const rels = files.stdout.split(/\r?\n/)
    .filter(Boolean)
    .filter((p) => !relativeRoot || isUnderRelativeRoot(p, relativeRoot))
    .map((p) => path.relative(rootInfo.realRoot, path.join(rootInfo.realGitRoot!, p)))
    .filter((p) => p && !p.startsWith("..") && !path.isAbsolute(p));
  return {
    paths: rels,
    label: `git-tracked files (${rels.length})`,
    receipt: `<${rels.length} git-tracked files in chunks>`,
    warning: null,
  };
}

function normalizeGitPath(p: string): string {
  return p.split(path.sep).join("/");
}

function isUnderRelativeRoot(filePath: string, relativeRoot: string): boolean {
  if (!relativeRoot) {
    return true;
  }
  const normalizedFile = normalizeGitPath(filePath);
  const normalizedRoot = normalizeGitPath(relativeRoot).replace(/\/+$/u, "");
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

export function parseRgJson(stdout: string, maxMatches: number): RgSnapshot {
  const accumulator = createMatchAccumulator(maxMatches);
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    accumulator.consume(line);
  }
  return accumulator.snapshot();
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; allowFailure?: boolean } = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: command.endsWith(".cmd"),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      if (!timedOut && exitCode !== 0 && exitCode !== 1 && !options.allowFailure) {
        reject(new Error(`${command} exited ${exitCode}: ${stderr.trim()}`));
        return;
      }
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

interface RgRunResult extends RgSnapshot {
  timedOut: boolean;
}

function runRipgrep(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxMatches?: number } = {},
): Promise<RgRunResult> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxMatches = options.maxMatches ?? 200;
  const accumulator = createMatchAccumulator(maxMatches);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
    });
    let stderr = "";
    let pending = "";
    let timedOut = false;
    let capped = false;
    const finishByKilling = (reason: "timeout" | "cap") => {
      if (reason === "timeout") {
        timedOut = true;
      }
      if (reason === "cap") {
        capped = true;
      }
      child.kill();
    };
    const timer = setTimeout(() => finishByKilling("timeout"), timeoutMs);

    child.stdout.on("data", (d) => {
      pending += d.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        accumulator.consume(line);
        if (accumulator.isOverLimit()) {
          finishByKilling("cap");
          return;
        }
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending.trim()) {
        accumulator.consume(pending);
      }
      const exitCode = code ?? 1;
      if (!timedOut && !capped && exitCode !== 0 && exitCode !== 1) {
        reject(new Error(`${command} exited ${exitCode}: ${stderr.trim()}`));
        return;
      }
      resolve({ ...accumulator.snapshot(), timedOut, truncated: capped || accumulator.snapshot().truncated });
    });
  });
}

async function runRipgrepPathChunks(
  command: string,
  baseArgs: string[],
  query: string,
  paths: string[],
  options: { cwd?: string; timeoutMs?: number; maxMatches?: number } = {},
): Promise<RgRunResult> {
  const accumulator = createMergeAccumulator(options.maxMatches ?? 200);
  if (paths.length === 0) {
    return { ...accumulator.snapshot(), timedOut: false, truncated: false };
  }
  const chunks = chunkPaths(paths, 20000);
  const started = Date.now();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const elapsed = Date.now() - started;
    const remaining = (options.timeoutMs ?? 5000) - elapsed;
    if (remaining <= 0) {
      return { ...accumulator.snapshot(), timedOut: true, truncated: accumulator.snapshot().truncated };
    }
    const child = await runRipgrep(command, [...baseArgs, query, ...chunk], {
      cwd: options.cwd,
      timeoutMs: remaining,
      maxMatches: Math.max((options.maxMatches ?? 200) - accumulator.snapshot().matches.length, 1),
    });
    accumulator.merge(child);
    if (child.timedOut || accumulator.isAtLimit()) {
      const omittedLaterChunks = i < chunks.length - 1 && accumulator.isAtLimit();
      return {
        ...accumulator.snapshot(),
        timedOut: child.timedOut,
        truncated: child.truncated || accumulator.snapshot().truncated || omittedLaterChunks,
      };
    }
  }
  return { ...accumulator.snapshot(), timedOut: false, truncated: accumulator.snapshot().truncated };
}

function chunkPaths(paths: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;
  for (const p of paths) {
    const nextChars = p.length + 1;
    if (current.length > 0 && currentChars + nextChars > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(p);
    currentChars += nextChars;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

interface RgSnapshot {
  matches: MatchResult[];
  files: Set<string>;
  totalMatches: number;
  truncated: boolean;
}

function createMatchAccumulator(maxMatches: number) {
  const matches: MatchResult[] = [];
  const files = new Set<string>();
  const pendingContext: PendingContextLine[] = [];
  let totalMatches = 0;
  let truncated = false;
  return {
    consume(line: string) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "context") {
        const contextLine = parseContextLine(event);
        if (contextLine) {
          pendingContext.push(contextLine);
          const previousMatch = matches.at(-1);
          if (previousMatch && previousMatch.path === contextLine.path) {
            previousMatch.context.push({ line: contextLine.line, text: contextLine.text });
          }
        }
        return;
      }
      if (event.type !== "match") {
        return;
      }
      totalMatches += 1;
      const filePath = event.data?.path?.text ?? "";
      if (filePath) {
        files.add(filePath);
      }
      if (matches.length >= maxMatches) {
        truncated = true;
        return;
      }
      const lines = event.data?.lines?.text ?? "";
      const context = pendingContext
        .filter((contextLine) => contextLine.path === filePath)
        .map((contextLine) => ({ line: contextLine.line, text: contextLine.text }));
      pendingContext.length = 0;
      matches.push({
        path: filePath,
        line: event.data?.line_number ?? null,
        text: lines.replace(/\s+/g, " ").trim(),
        context,
      });
    },
    isOverLimit() {
      return totalMatches > maxMatches;
    },
    snapshot(): RgSnapshot {
      return { matches, files, totalMatches, truncated };
    },
  };
}

function parseContextLine(event: unknown): PendingContextLine | null {
  if (!isObject(event)) {
    return null;
  }
  const data = event.data;
  if (!isObject(data)) {
    return null;
  }
  const pathData = data.path;
  const linesData = data.lines;
  if (!isObject(pathData) || !isObject(linesData) || typeof pathData.text !== "string" || typeof linesData.text !== "string") {
    return null;
  }
  return {
    path: pathData.text,
    line: typeof data.line_number === "number" ? data.line_number : null,
    text: linesData.text.replace(/\s+/g, " ").trim(),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createMergeAccumulator(maxMatches: number) {
  const matches: MatchResult[] = [];
  const files = new Set<string>();
  let totalMatches = 0;
  let truncated = false;
  return {
    merge(result: RgSnapshot) {
      totalMatches += result.totalMatches;
      for (const f of result.files) {
        files.add(f);
      }
      for (const m of result.matches) {
        if (matches.length >= maxMatches) {
          truncated = true;
          break;
        }
        matches.push(m);
      }
      truncated = truncated || result.truncated;
    },
    isAtLimit() {
      return matches.length >= maxMatches;
    },
    snapshot(): RgSnapshot {
      return { matches, files, totalMatches, truncated };
    },
  };
}
