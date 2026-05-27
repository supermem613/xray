import type { Command } from "commander";
import type { CommandEntry } from "../registry.js";

export function addExamples(command: Command, entry: CommandEntry): Command {
  if (entry.examples.length === 0) {
    return command;
  }
  return command.addHelpText("after", [
    "",
    "Examples:",
    ...entry.examples.map((example) => `  ${example}`),
  ].join("\n"));
}

export function writeJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

export function writeSuccessJson(command: string, data: unknown, options: { ok?: boolean; warnings?: string[] } = {}): void {
  const envelope: { ok: boolean; command: string; data: unknown; warnings?: string[] } = {
    ok: options.ok ?? true,
    command,
    data,
  };
  if (options.warnings && options.warnings.length > 0) {
    envelope.warnings = options.warnings;
  }
  writeJson(envelope);
}
