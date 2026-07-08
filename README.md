# xray

Markdown+code-first search CLI with bundled ripgrep and agent-safe JSON output.

`xray` is a search envelope, not a new search engine. It uses a known bundled
`rg` from `@vscode/ripgrep`, splits broad searches across markdown, code, and
everything else, and returns receipts so agents can see what was searched.

## Quickstart

```powershell
npm install
npm run build
npm link
xray doctor
xray search "needle" --root path\to\repo
```

Add this to `CLAUDE.md`, `copilot-instructions.md`, or equivalent agent instructions:

```text
Use xray as the default replacement for code search. Do not start with glob,
raw rg, grep, find, or broad filesystem search.

Commands:
  xray search "<literal query>"
  xray search "<literal query>" --root path\to\repo
  xray search "<literal query>" --root path\to\file.log
  xray search --query "--flag-name" --root path\to\repo
  xray search "<literal query>" --root path\to\repo --glob "src/**"
  xray search "<regex>" --regex --glob "src/**"
  xray search "<literal query>" --timeoutMs 30000
  xray search "<literal query>" --no-smart

Rules:
- Always include the `search` subcommand.
- Search is literal by default. Add --regex only when regex is required.
- Default search is smart: markdown/code extension queries search one lane;
  other literal queries fan out across markdown, code, and everything else.
- Use --no-smart only when comparing against the explicit sequential fallback.
- Use --root when the target repo is not the current directory.
- Use --root with a file path for direct log, jsonl, or generated artifact searches.
- Use --glob to narrow paths instead of a separate glob/find command.
- Use --timeoutMs for wall-clock timeout in milliseconds.
- For option-looking query literals, use --query:
  `xray search --query "--timeoutMs" --root path\to\repo --timeoutMs 30000`.
- Parse JSON stdout as one compact object. Matches are in `data.matches` with
  `line`, `text`, and optional `context`; counts are in `data.summary`.
  `truncated` and `timedOut` are present only when true.
- Recoverable ripgrep file errors return parsed partial results with `warnings`
  while stdout remains one compact JSON object.
- If xray cannot express the search, stop and report the unsupported shape.
```

## Commands

```powershell
xray search <query> [options]
xray files <query> [options]
xray doctor
xray schema [--summary]
xray update
```

Examples:

```powershell
xray search "createController"
xray search createController
xray search "TODO.*auth" --regex --glob "src/**" --context 2
xray search "needle" --timeoutMs 30000
xray search --query "--timeoutMs" --root path\to\repo --timeoutMs 30000
xray search needle --no-smart
xray search needle --all
xray search "needle" --root path\to\repo
xray search "needle" --root path\to\file.log
xray files --root path\to\repo
xray files needle --glob "src/**"
xray files --root path\to\repo --all
xray doctor
xray schema
xray schema search --summary
xray update
```

Defaults:

- Search is fixed-string by default. Use `--regex` for regular expressions.
- Search omits surrounding context by default. Use `--context 1` or higher when nearby lines matter.
- Inside git repos, search includes tracked files and non-gitignored untracked files by default.
- Outside git repos, search still runs with the same caps, timeouts, and excludes.
- Default literal search uses markdown/code/everything fanout unless the query has an obvious markdown or code extension.
- `--no-smart` forces the sequential fallback.
- Results are capped and timed out by default. `warnings` is emitted only when
  capped, timed out, or scoped with an important caveat.
- Non-interactive command stdout is JSON only.

## File listing

`xray files` lists file paths instead of content matches, for path discovery.
With no query it lists every file in scope (ripgrep `--files`); with a query it
lists only files that contain it (ripgrep `--files-with-matches`).

- `files` lists all files, with no binary/text distinction.
- Symlinked directories are not followed.
- Results use ripgrep's native traversal order and are not sorted.
- `--max` bounds the number of files (default 1000), not lines. `truncated` is
  reported when the cap is hit.
- `data.matches` holds `{ path }` objects; `data.summary.fileCount` is the count.

### --all scope override

Both `search` and `files` accept `--all`, which removes every exclusion: hidden
files, gitignored files, and the built-in vendor/build excludes (`.git`,
`node_modules`, `dist`, and similar). Without `--all`, both commands skip hidden
files, respect `.gitignore`, and apply the built-in excludes.

## Agent contract

- Primary archetype: standard deterministic local CLI.
- stdout: one compact JSON object only for non-interactive commands.
- stderr: reserved for diagnostics from the runtime or child tools.
- success envelope: `{ "ok": true, "command": "...", "data": ... }`, with
  optional `warnings` only when non-empty.
- recoverable ripgrep file errors: parsed partial results are returned with
  `warnings`; nonrecoverable ripgrep failures still fail loudly.
- `schema`: `xray schema [<command>...] [--summary]` is the command catalog.
- `doctor`: `xray doctor` checks bundled ripgrep and git.
- mutations: `update` mutates the install checkout by pulling, installing dependencies, and rebuilding. Search, schema, and doctor are read-only commands.
- registry: `src/registry.ts` is the command catalog source for schema, examples, and help text.

## Develop

```powershell
npm run build
npm run lint
npm test
node dist/cli.js schema
```

## License

MIT © Marcus Markiewicz
