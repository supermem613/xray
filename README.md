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
- Parse JSON stdout: matches are in `data.matches` with `line`, `text`, and
  `context`; counts, truncation, timeout, and scope are in `data.summary`.
- Fall back to raw rg/glob only when xray cannot express the search or the user
  explicitly asks for those tools.
```

## Commands

```powershell
xray search <query> [options]
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
xray search "needle" --root path\to\repo
xray search "needle" --root path\to\file.log
xray doctor
xray schema
xray schema search --summary
xray update
```

Defaults:

- Search is fixed-string by default. Use `--regex` for regular expressions.
- Search includes one surrounding context line by default. Use `--context 0` for compact output.
- Inside git repos, search includes tracked files and non-gitignored untracked files by default.
- Outside git repos, search still runs with the same caps, timeouts, and excludes.
- Default literal search uses markdown/code/everything fanout unless the query has an obvious markdown or code extension.
- `--no-smart` forces the sequential fallback.
- Results are capped and timed out by default.
- Non-interactive command stdout is JSON only.

## Agent contract

- Primary archetype: standard deterministic local CLI.
- stdout: compact JSON only for non-interactive commands.
- stderr: reserved for diagnostics from the runtime or child tools.
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
