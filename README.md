# xray

Git-aware safe code search CLI with bundled ripgrep and agent-safe JSON output.

`xray` is a search envelope, not a new search engine. It uses a known bundled
`rg` from `@vscode/ripgrep`, defaults to safe git-aware scope, and returns
receipts so agents can see what was searched.

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
Use xray for code search. Do not start with glob, raw rg, grep, find, or broad
filesystem search.

Default command from the target repo:
  xray search "<literal query>"

Default command when searching another repo:
  xray search "<literal query>" --root path\to\repo

Common forms:
  xray search "<literal query>" --glob "src/**"
  xray search "<literal query>" --root path\to\repo --glob "src/**"
  xray search "<regex>" --regex --glob "src/**"
  xray search "<literal query>" --tracked-only

Rules:
- Use xray first for code search.
- Always include the `search` subcommand.
- Search is literal by default. Add --regex only when regex is required.
- Use --glob to narrow paths. Do not use a separate glob/find step first.
- By default, xray searches git repo files plus non-gitignored untracked files.
- Outside git repos, xray still searches with the same caps, timeouts, and excludes.
- Use --tracked-only only when uncommitted files would be misleading.
- Parse stdout as JSON. Read matches from `data.matches`.
- Read count, truncation, timeout, and scope from `data.summary`.
- If `warnings` includes truncation or timeout, rerun with a narrower --glob,
  more specific query, or higher --max/--timeout.
- Use raw rg or glob only when xray cannot express the query or the user asks
  for those tools explicitly.
```

## Commands

```powershell
xray search <query> [options]
xray doctor [--human]
xray schema [--summary]
```

Examples:

```powershell
xray search "createController"
xray search createController
xray search "TODO.*auth" --regex --glob "src/**" --context 2
xray search needle --tracked-only
xray search "needle" --root path\to\repo
xray doctor
xray schema
xray schema search --summary
```

Defaults:

- Search is fixed-string by default. Use `--regex` for regular expressions.
- Inside git repos, search includes tracked files and non-gitignored untracked files by default.
- Use `--tracked-only` to restrict search to git-tracked files.
- Outside git repos, search still runs with the same caps, timeouts, and excludes.
- Results are capped and timed out by default.
- Non-interactive command stdout is JSON only.

## Agent contract

- Primary archetype: standard deterministic local CLI.
- stdout: compact JSON only for non-interactive commands unless `--human` is passed.
- stderr: reserved for diagnostics from the runtime or child tools.
- `schema`: `xray schema [<command>...] [--summary]` is the command catalog.
- `doctor`: `xray doctor` checks bundled ripgrep and git.
- mutations: none. Search, schema, and doctor are read-only commands.
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
