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
For code search, use `xray search <query>` instead of glob, raw `rg`, `grep`,
or broad filesystem search. `xray` enforces git-aware scoping,
generated-directory excludes, result caps, timeouts, and receipts. Use
`xray search <query> --glob <pattern>` to narrow paths. Use `xray search
<query> --regex` only when regular expressions are required. Use glob or raw
`rg` only when `xray` cannot express the query or the user explicitly requests
those tools.
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
xray search "needle" --include-untracked
xray search "needle" --root path\to\repo
xray doctor
xray schema
xray schema search --summary
```

Defaults:

- Search is fixed-string by default. Use `--regex` for regular expressions.
- Inside git repos, search is restricted to git-tracked files by default.
- Use `--include-untracked` to search non-gitignored untracked files too.
- Outside git repos, broad searches require `--allow-broad`.
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
