import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveBundledRgPath(): string | null {
  try {
    const mod = require("@vscode/ripgrep") as { rgPath?: string };
    return mod.rgPath ?? null;
  } catch {
    return null;
  }
}
