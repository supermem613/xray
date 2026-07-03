import { spawn } from "node:child_process";
import { resolveBundledRgPath } from "./rg-path.js";
import { DEFAULT_EXCLUDES, resolveRoot } from "./search.js";

export interface FilesOptions {
  query: string | null;
  root: string | null;
  globs: string[];
  types: string[];
  max: number;
  timeoutMs: number;
  regex: boolean;
  all: boolean;
}

export interface FileMatch {
  path: string;
}

export interface FilesMetrics {
  backend: "ripgrep";
  runs: number;
  lanes: number;
  elapsedMs: number;
}

export interface FilesEnvelope {
  matches: FileMatch[];
  fileCount: number;
  truncated: boolean;
  timedOut: boolean;
  warnings: string[];
  metrics: FilesMetrics;
}

interface FilesRun {
  paths: string[];
  truncated: boolean;
  timedOut: boolean;
}

export async function runXrayFiles(opts: FilesOptions): Promise<FilesEnvelope> {
  const start = Date.now();
  const rootInfo = await resolveRoot(opts.root);
  const rgPath = resolveBundledRgPath() ?? "rg";
  const query = opts.query && opts.query.trim() ? opts.query : null;

  const args: string[] = ["--color", "never"];
  if (query === null) {
    args.push("--files");
  } else {
    args.push("--files-with-matches", "--text");
    if (!opts.regex) {
      args.push("--fixed-strings");
    }
  }
  if (opts.all) {
    args.push("--hidden", "--no-ignore");
  } else {
    for (const g of DEFAULT_EXCLUDES) {
      args.push("--glob", g);
    }
  }
  const effectiveGlobs = rootInfo.fileGlob ? [...opts.globs, rootInfo.fileGlob] : opts.globs;
  for (const g of effectiveGlobs) {
    args.push("--glob", g);
  }
  for (const t of opts.types) {
    args.push("--type", t);
  }
  if (query === null) {
    args.push(".");
  } else {
    args.push("--", query, ".");
  }

  const run = await runRipgrepFiles(rgPath, args, {
    cwd: rootInfo.root,
    timeoutMs: opts.timeoutMs,
    max: opts.max,
  });

  const warnings: string[] = [];
  if (run.timedOut) {
    warnings.push(`search stopped after ${opts.timeoutMs} ms`);
  }
  if (run.truncated) {
    warnings.push(`display capped at ${opts.max} files`);
  }

  return {
    matches: run.paths.map((filePath) => ({ path: filePath })),
    fileCount: run.paths.length,
    truncated: run.truncated,
    timedOut: run.timedOut,
    warnings,
    metrics: {
      backend: "ripgrep",
      runs: 1,
      lanes: 1,
      elapsedMs: Date.now() - start,
    },
  };
}

function runRipgrepFiles(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; max: number },
): Promise<FilesRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, shell: false });
    const paths: string[] = [];
    let pending = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let stopped = false;

    const stop = (reason: "timeout" | "cap") => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (reason === "timeout") {
        timedOut = true;
      }
      if (reason === "cap") {
        truncated = true;
      }
      child.kill();
    };
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);

    const take = (line: string) => {
      if (stopped) {
        return;
      }
      const trimmed = line.replace(/[\r\n]+$/u, "");
      if (!trimmed) {
        return;
      }
      if (paths.length >= options.max) {
        stop("cap");
        return;
      }
      paths.push(trimmed);
    };

    child.stdout.on("data", (d) => {
      if (stopped) {
        return;
      }
      pending += d.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        take(line);
        if (stopped) {
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
        take(pending);
      }
      const exitCode = code ?? 1;
      if (!timedOut && !truncated && exitCode !== 0 && exitCode !== 1) {
        reject(new Error(`${command} exited ${exitCode}: ${stderr.trim()}`));
        return;
      }
      resolve({ paths, truncated, timedOut });
    });
  });
}
