#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./commands/common.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerSchema } from "./commands/schema.js";
import { registerSearch } from "./commands/search.js";

const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const VERSION = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;

const program = new Command();

program
  .name("xray")
  .description("Git-aware safe code search CLI with bundled ripgrep and agent-safe JSON output.")
  .version(VERSION);

registerSearch(program);
registerDoctor(program);
registerSchema(program, VERSION);

if (process.argv.slice(2).length === 0) {
  process.stdout.write(`xray v${VERSION}\n\n`);
  program.outputHelp();
  process.exit(0);
}

program.parseAsync().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  writeJson({
    ok: false,
    command: "xray",
    error: "SEARCH_FAILED",
    hint: msg,
  });
  process.exit(1);
});
