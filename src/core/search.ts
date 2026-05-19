import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveBundledRgPath } from "./rg-path.js";
import { planSmartSearch, type SmartLane, type SmartPlan, type SmartStrategy } from "./smart-plan.js";

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
  smart: boolean;
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
  mode: "smart" | "sequential";
  plan: SearchPlanSummary;
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

export interface SearchPlanSummary {
  strategy: SmartStrategy;
  reason: string;
  buckets: SearchPlanBucketSummary[];
}

export interface SearchPlanBucketSummary {
  name: string;
  pathCount: number | null;
}

interface RootInfo {
  root: string;
  realRoot: string;
  gitRoot: string | null;
  realGitRoot: string | null;
  git: boolean;
}

interface ScopeInfo {
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

  const scope = buildScope(rootInfo);
  const explicitScope = opts.globs.length > 0 || opts.types.length > 0;
  const useSmart = opts.smart && !explicitScope;
  const execution = useSmart
    ? await runSmartSearch(rgPath, opts, rootInfo, scope)
    : await runSequentialSearch(rgPath, opts, rootInfo, scope, explicitScope ? "explicit glob or type filter" : "requested by --no-smart");
  const child = execution.result;
  if (child.timedOut) {
    warnings.push(`search stopped after ${opts.timeoutMs} ms`);
  }
  if (child.truncated) {
    warnings.push(`display capped at ${opts.max} matches`);
  }
  if (scope.warning) {
    warnings.push(scope.warning);
  }

  return {
    root: rootInfo.root,
    scope: scope.label,
    mode: execution.mode,
    plan: execution.plan,
    regex: opts.regex,
    elapsedMs: Date.now() - start,
    timedOut: child.timedOut,
    truncated: child.truncated,
    matchCount: child.totalMatches,
    fileCount: child.files.size,
    matches: child.matches,
    warnings,
    command: execution.command,
  };
}

interface SearchExecution {
  mode: "smart" | "sequential";
  plan: SearchPlanSummary;
  result: RgRunResult;
  command: string[];
}

async function runSequentialSearch(
  rgPath: string,
  opts: SearchOptions,
  rootInfo: RootInfo,
  scope: ScopeInfo,
  reason: string,
): Promise<SearchExecution> {
  const baseArgs = buildBaseArgs(opts);
  const result = await runRipgrep(rgPath, [...baseArgs, opts.query, "."], {
    cwd: rootInfo.root,
    timeoutMs: opts.timeoutMs,
    maxMatches: opts.max,
  });
  return {
    mode: "sequential",
    plan: {
      strategy: "sequential",
      reason,
      buckets: [{ name: "all", pathCount: null }],
    },
    result,
    command: [rgPath, ...baseArgs, opts.query, scope.receipt],
  };
}

async function runSmartSearch(
  rgPath: string,
  opts: SearchOptions,
  rootInfo: RootInfo,
  scope: ScopeInfo,
): Promise<SearchExecution> {
  const plan = planSmartSearch(opts.query, { regex: opts.regex });
  if (plan.strategy === "sequential") {
    const execution = await runSequentialSearch(rgPath, opts, rootInfo, scope, plan.reason);
    return { ...execution, mode: "smart" };
  }

  const execution = plan.strategy === "fanout"
    ? await runFanoutSearch(rgPath, opts, rootInfo, plan)
    : await runNarrowedSearch(rgPath, opts, rootInfo, plan);

  if (plan.fallbackOnZero && execution.result.totalMatches === 0 && !execution.result.timedOut) {
    const fallback = await runSequentialSearch(rgPath, opts, rootInfo, scope, `${plan.reason}; narrowed search found no matches, fell back to broad search`);
    return { ...fallback, mode: "smart" };
  }

  return execution;
}

async function runNarrowedSearch(
  rgPath: string,
  opts: SearchOptions,
  rootInfo: RootInfo,
  plan: SmartPlan,
): Promise<SearchExecution> {
  const lane = plan.lanes[0]!;
  const baseArgs = buildLaneArgs(opts, lane);
  const result = await runRipgrep(rgPath, [...baseArgs, opts.query, "."], {
    cwd: rootInfo.root,
    timeoutMs: opts.timeoutMs,
    maxMatches: opts.max,
  });
  return {
    mode: "smart",
    plan: toSearchPlanSummary(plan),
    result,
    command: [rgPath, ...baseArgs, opts.query, "."],
  };
}

async function runFanoutSearch(
  rgPath: string,
  opts: SearchOptions,
  rootInfo: RootInfo,
  plan: SmartPlan,
): Promise<SearchExecution> {
  const result = await runRipgrepFanout(rgPath, opts, rootInfo.root, plan.lanes);
  return {
    mode: "smart",
    plan: toSearchPlanSummary(plan),
    result,
    command: [rgPath, ...buildBaseArgs(opts), opts.query, `<smart fanout: ${plan.lanes.map((lane) => lane.name).join(",")}>`],
  };
}

function toSearchPlanSummary(plan: SmartPlan): SearchPlanSummary {
  return {
    strategy: plan.strategy,
    reason: plan.reason,
    buckets: plan.lanes.length > 0 ? plan.lanes.map((lane) => ({ name: lane.name, pathCount: null })) : [{ name: "all", pathCount: null }],
  };
}

function buildBaseArgs(opts: SearchOptions, extraArgs: string[] = []): string[] {
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
  baseArgs.push(...extraArgs);
  for (const g of opts.globs) {
    baseArgs.push("--glob", g);
  }
  for (const t of opts.types) {
    baseArgs.push("--type", t);
  }
  return baseArgs;
}

function buildLaneArgs(opts: SearchOptions, lane: SmartLane): string[] {
  return buildBaseArgs(opts, lane.args);
}

function buildFanoutLaneArgs(opts: SearchOptions, lane: SmartLane): string[] {
  return buildLaneArgs(opts, lane);
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

function buildScope(rootInfo: RootInfo): ScopeInfo {
  return {
    label: rootInfo.git ? "git repo files plus untracked non-ignored files" : "non-git root",
    receipt: ".",
    warning: null,
  };
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
    let stopped = false;
    const finishByKilling = (reason: "timeout" | "cap") => {
      if (stopped) {
        return;
      }
      stopped = true;
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
      if (stopped) {
        return;
      }
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
      if (!stopped && pending.trim()) {
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

function runRipgrepFanout(
  command: string,
  opts: SearchOptions,
  cwd: string,
  lanes: SmartLane[],
): Promise<RgRunResult> {
  const laneStates = lanes.map((lane) => ({
    lane,
    accumulator: createMatchAccumulator(opts.max),
    pending: "",
    stderr: "",
  }));
  const children: Array<ReturnType<typeof spawn>> = [];
  let closed = 0;
  let timedOut = false;
  let capped = false;
  let stopped = false;

  return new Promise((resolve, reject) => {
    const finish = () => {
      const merged = mergeLaneSnapshots(laneStates.map((state) => state.accumulator.snapshot()), opts.max);
      resolve({ ...merged, timedOut, truncated: capped || merged.truncated });
    };
    const stopAll = (reason: "timeout" | "cap") => {
      if (stopped) {
        return;
      }
      stopped = true;
      timedOut = reason === "timeout";
      capped = reason === "cap";
      for (const child of children) {
        child.kill();
      }
    };
    const timer = setTimeout(() => stopAll("timeout"), opts.timeoutMs);

    lanes.forEach((lane, index) => {
      const state = laneStates[index]!;
      const child = spawn(command, [...buildFanoutLaneArgs(opts, lane), opts.query, "."], {
        cwd,
        windowsHide: true,
        shell: false,
      });
      children.push(child);

      child.stdout.on("data", (d) => {
        if (stopped) {
          return;
        }
        state.pending += d.toString();
        const lines = state.pending.split(/\r?\n/);
        state.pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          state.accumulator.consume(line);
          if (totalObserved(laneStates) > opts.max) {
            stopAll("cap");
            return;
          }
        }
      });
      child.stderr.on("data", (d) => {
        state.stderr += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (!stopped && state.pending.trim()) {
          state.accumulator.consume(state.pending);
          if (totalObserved(laneStates) > opts.max) {
            stopAll("cap");
          }
        }
        const exitCode = code ?? 1;
        if (!stopped && exitCode !== 0 && exitCode !== 1) {
          clearTimeout(timer);
          stopAll("cap");
          reject(new Error(`${command} exited ${exitCode}: ${state.stderr.trim()}`));
          return;
        }
        closed += 1;
        if (closed === lanes.length) {
          clearTimeout(timer);
          finish();
        }
      });
    });
  });
}

function totalObserved(laneStates: Array<{ accumulator: ReturnType<typeof createMatchAccumulator> }>): number {
  return laneStates.reduce((sum, state) => sum + state.accumulator.snapshot().totalMatches, 0);
}

function mergeLaneSnapshots(snapshots: RgSnapshot[], maxMatches: number): RgSnapshot {
  const matches: MatchResult[] = [];
  const files = new Set<string>();
  const seenMatches = new Set<string>();
  let totalMatches = 0;
  let truncated = false;
  for (const snapshot of snapshots) {
    totalMatches += snapshot.totalMatches;
    for (const file of snapshot.files) {
      files.add(file);
    }
    for (const match of snapshot.matches) {
      const key = `${match.path}\0${match.line ?? ""}\0${match.text}`;
      if (seenMatches.has(key)) {
        continue;
      }
      seenMatches.add(key);
      if (matches.length >= maxMatches) {
        truncated = true;
        continue;
      }
      matches.push(match);
    }
    truncated = truncated || snapshot.truncated;
  }
  return { matches, files, totalMatches, truncated: truncated || totalMatches > maxMatches };
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

