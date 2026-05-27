import { Command } from "commander";
import { runXraySearch, type MatchResult, type SearchEnvelope } from "../core/search.js";
import { addExamples, writeSuccessJson } from "./common.js";
import { getCommandEntry } from "../registry.js";

export function registerSearch(program: Command): void {
  const entry = getCommandEntry(["search"]);
  addExamples(program
    .command("search")
    .description(entry.summary)
    .argument("[query...]", "Search query. Literal by default.")
    .option("--query <query>", "Search query. Use this when the query itself starts with a dash.")
    .option("--root <path>", "Root path to search. Defaults to the current working directory.")
    .option("--glob <glob>", "Restrict paths with ripgrep glob patterns.", collect, [])
    .option("--type <type>", "Restrict paths with ripgrep file type filters.", collect, [])
    .option("-C, --context <n>", "Context lines around matches.", parseNonNegativeInt, 0)
    .option("--max <n>", "Maximum matches to return.", parsePositiveInt, 200)
    .option("--timeoutMs <ms>", "Wall-clock timeout in milliseconds.", parsePositiveInt, 5000)
    .option("--regex", "Treat query as a regular expression.", false)
    .option("--no-smart", "Force the sequential search fallback.")
    .action(async (queryParts: string[], opts: Record<string, unknown>) => {
      const query = typeof opts.query === "string" ? opts.query : queryParts.join(" ");
      if (!query) {
        throw new Error("expected a search query");
      }

      const result = await runXraySearch({
        query,
        root: typeof opts.root === "string" ? opts.root : null,
        globs: Array.isArray(opts.glob) ? opts.glob.map(String) : [],
        types: Array.isArray(opts.type) ? opts.type.map(String) : [],
        context: Number(opts.context ?? 0),
        max: Number(opts.max ?? 200),
        timeoutMs: Number(opts.timeoutMs ?? 5000),
        regex: opts.regex === true,
        smart: opts.smart !== false,
      });

      writeSuccessJson("search", formatJsonData(result), { warnings: result.warnings });
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
  const summary: {
    matchCount: number;
    fileCount: number;
    truncated?: boolean;
    timedOut?: boolean;
  } = {
    matchCount: result.matchCount,
    fileCount: result.fileCount,
  };
  if (result.truncated) {
    summary.truncated = true;
  }
  if (result.timedOut) {
    summary.timedOut = true;
  }
  return {
    matches: result.matches.map(formatMatch),
    summary,
  };
}

function formatMatch(match: MatchResult) {
  const formatted: Omit<MatchResult, "context"> & { context?: MatchResult["context"] } = {
    path: match.path,
    line: match.line,
    text: match.text,
  };
  if (match.context.length > 0) {
    formatted.context = match.context;
  }
  return formatted;
}
