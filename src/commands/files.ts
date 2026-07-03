import { Command } from "commander";
import { runXrayFiles, type FilesEnvelope } from "../core/files.js";
import { addExamples, writeSuccessJson } from "./common.js";
import { getCommandEntry } from "../registry.js";

export function registerFiles(program: Command): void {
  const entry = getCommandEntry(["files"]);
  addExamples(program
    .command("files")
    .description(entry.summary)
    .argument("[query...]", "Optional query. With a query, lists files containing it; without, lists every file in scope.")
    .option("--query <query>", "Query for files-with-matches mode. Use this when the query itself starts with a dash.")
    .option("--root <path>", "Root path to list. Defaults to the current working directory.")
    .option("--glob <glob>", "Restrict paths with ripgrep glob patterns.", collect, [])
    .option("--type <type>", "Restrict paths with ripgrep file type filters.", collect, [])
    .option("--max <n>", "Maximum files to return.", parsePositiveInt, 1000)
    .option("--timeoutMs <ms>", "Wall-clock timeout in milliseconds.", parsePositiveInt, 5000)
    .option("--regex", "Treat the query as a regular expression.", false)
    .option("--all", "Remove all exclusions: include hidden, gitignored, and normally-excluded files.", false)
    .action(async (queryParts: string[], opts: Record<string, unknown>) => {
      const joined = typeof opts.query === "string" ? opts.query : queryParts.join(" ");

      const result = await runXrayFiles({
        query: joined ? joined : null,
        root: typeof opts.root === "string" ? opts.root : null,
        globs: Array.isArray(opts.glob) ? opts.glob.map(String) : [],
        types: Array.isArray(opts.type) ? opts.type.map(String) : [],
        max: Number(opts.max ?? 1000),
        timeoutMs: Number(opts.timeoutMs ?? 5000),
        regex: opts.regex === true,
        all: opts.all === true,
      });

      writeSuccessJson("files", formatJsonData(result), { warnings: result.warnings });
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

function formatJsonData(result: FilesEnvelope) {
  const summary: { fileCount: number; truncated?: boolean; timedOut?: boolean } = {
    fileCount: result.fileCount,
  };
  if (result.truncated) {
    summary.truncated = true;
  }
  if (result.timedOut) {
    summary.timedOut = true;
  }
  return {
    matches: result.matches.map((match) => ({ path: match.path })),
    summary,
    metrics: result.metrics,
  };
}
