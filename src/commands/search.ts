import { Command } from "commander";
import { runXraySearch, type SearchEnvelope } from "../core/search.js";
import { addExamples, writeJson } from "./common.js";
import { getCommandEntry } from "../registry.js";

export function registerSearch(program: Command): void {
  const entry = getCommandEntry(["search"]);
  addExamples(program
    .command("search")
    .description(entry.summary)
    .argument("<query...>", "Search query. Literal by default.")
    .option("--root <path>", "Root path to search. Defaults to the current working directory.")
    .option("--glob <glob>", "Restrict paths with ripgrep glob patterns.", collect, [])
    .option("--type <type>", "Restrict paths with ripgrep file type filters.", collect, [])
    .option("-C, --context <n>", "Context lines around matches.", parseNonNegativeInt, 1)
    .option("--max <n>", "Maximum matches to return.", parsePositiveInt, 200)
    .option("--timeout <ms>", "Wall-clock timeout in milliseconds.", parsePositiveInt, 5000)
    .option("--regex", "Treat query as a regular expression.", false)
    .option("--tracked-only", "Search only git-tracked files.", false)
    .action(async (queryParts: string[], opts: Record<string, unknown>) => {
      const result = await runXraySearch({
        query: queryParts.join(" "),
        root: typeof opts.root === "string" ? opts.root : null,
        globs: Array.isArray(opts.glob) ? opts.glob.map(String) : [],
        types: Array.isArray(opts.type) ? opts.type.map(String) : [],
        context: Number(opts.context ?? 1),
        max: Number(opts.max ?? 200),
        timeoutMs: Number(opts.timeout ?? 5000),
        regex: opts.regex === true,
        trackedOnly: opts.trackedOnly === true,
      });

      writeJson({ ok: true, command: "search", data: formatJsonData(result), warnings: result.warnings, timingMs: result.elapsedMs });
    }), entry);
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function parsePositiveInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("expected a positive integer");
  }
  return n;
}

function parseNonNegativeInt(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("expected a non-negative integer");
  }
  return n;
}

function formatJsonData(result: SearchEnvelope) {
  return {
    matches: result.matches,
    summary: {
      root: result.root,
      scope: result.scope,
      matchCount: result.matchCount,
      fileCount: result.fileCount,
      truncated: result.truncated,
      timedOut: result.timedOut,
      elapsedMs: result.elapsedMs,
    },
  };
}

