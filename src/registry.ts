export interface CommandEntry {
  path: string[];
  summary: string;
  effect: "read";
  input: {
    positionals: Array<{ name: string; required: boolean; variadic?: boolean }>;
    flags: Array<{ name: string; type: string; summary: string; default?: unknown }>;
  };
  output: { documented: boolean; schema: string };
  examples: string[];
}

export const commands: CommandEntry[] = [
  {
    path: ["search"],
    summary: "Search code safely with git-aware scope and bundled ripgrep.",
    effect: "read",
    input: {
      positionals: [{ name: "query", required: true, variadic: true }],
      flags: [
        { name: "--root", type: "string", summary: "Root path to search. Defaults to the current working directory." },
        { name: "--glob", type: "string[]", summary: "Restrict paths with ripgrep glob patterns." },
        { name: "--type", type: "string[]", summary: "Restrict paths with ripgrep file type filters." },
        { name: "--context", type: "number", summary: "Context lines around matches.", default: 0 },
        { name: "--max", type: "number", summary: "Maximum matches to return.", default: 200 },
        { name: "--timeout", type: "number", summary: "Wall-clock timeout in milliseconds.", default: 5000 },
        { name: "--regex", type: "boolean", summary: "Treat query as a regular expression.", default: false },
        { name: "--tracked-only", type: "boolean", summary: "Search only git-tracked files.", default: false },
        { name: "--human", type: "boolean", summary: "Render human-readable output.", default: false },
      ],
    },
    output: { documented: true, schema: "SearchEnvelope" },
    examples: [
      "xray search createController",
      "xray search \"TODO.*auth\" --regex --glob \"src/**\" --context 2",
      "xray search needle --tracked-only",
    ],
  },
  {
    path: ["doctor"],
    summary: "Run health checks for bundled ripgrep and git.",
    effect: "read",
    input: {
      positionals: [],
      flags: [{ name: "--human", type: "boolean", summary: "Render human-readable output.", default: false }],
    },
    output: { documented: true, schema: "DoctorEnvelope" },
    examples: ["xray doctor"],
  },
  {
    path: ["schema"],
    summary: "Emit the machine-readable command catalog.",
    effect: "read",
    input: {
      positionals: [{ name: "path", required: false, variadic: true }],
      flags: [{ name: "--summary", type: "boolean", summary: "Emit only cheap discovery metadata.", default: false }],
    },
    output: { documented: true, schema: "SchemaEnvelope" },
    examples: ["xray schema", "xray schema search --summary"],
  },
];

export function getCommandEntry(path: string[]): CommandEntry {
  const entry = commands.find((c) => c.path.length === path.length && c.path.every((part, index) => part === path[index]));
  if (!entry) {
    throw new Error(`unknown command registry path: ${path.join(" ")}`);
  }
  return entry;
}
