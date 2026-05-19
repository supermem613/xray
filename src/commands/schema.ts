import { Command } from "commander";
import { commands, getCommandEntry } from "../registry.js";
import { addExamples, writeJson } from "./common.js";

export function registerSchema(program: Command, version: string): void {
  const entry = getCommandEntry(["schema"]);
  addExamples(program
    .command("schema")
    .description(entry.summary)
    .argument("[path...]", "Optional command path prefix.")
    .option("--summary", "Emit only cheap discovery metadata.", false)
    .action((pathParts: string[] | undefined, opts: { summary?: boolean }) => {
      const prefix = pathParts ?? [];
      const filtered = prefix.length === 0
        ? commands
        : commands.filter((c) => prefix.every((part, i) => c.path[i] === part));
      if (opts.summary) {
        writeJson({
          schemaVersion: 1,
          cliVersion: version,
          commandCount: filtered.length,
          commands: filtered.map((c) => c.path),
        });
        return;
      }
      writeJson({
        schemaVersion: 1,
        cliVersion: version,
        envelope: {
          stdout: "JSON only for non-interactive commands",
          stderr: "progress, diagnostics, and human narration",
          successEnvelope: ["ok", "command", "data", "warnings", "timingMs"],
          errorEnvelope: ["ok", "command", "error", "hint"],
        },
        globalFlags: [],
        commands: filtered,
        errorCodes: ["SEARCH_FAILED", "UPDATE_FAILED"],
        exitCodes: [{ code: 0, meaning: "success" }, { code: 1, meaning: "error" }],
      });
    }), entry);
}
