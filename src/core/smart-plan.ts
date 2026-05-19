export type SmartStrategy = "sequential" | "narrowed" | "fanout";
export type SmartLaneName = "markdown" | "code" | "everything";

export interface SmartLane {
  name: SmartLaneName;
  args: string[];
}

export interface SmartPlan {
  strategy: SmartStrategy;
  reason: string;
  lanes: SmartLane[];
  fallbackOnZero: boolean;
}

const MARKDOWN_TYPE = "xraymarkdown";
const CODE_TYPE = "xraycode";
const MARKDOWN_TYPE_ARGS = [
  "--type-add", `${MARKDOWN_TYPE}:*.md`,
  "--type-add", `${MARKDOWN_TYPE}:*.mdx`,
  "--type-add", `${MARKDOWN_TYPE}:*.rst`,
  "--type-add", `${MARKDOWN_TYPE}:*.adoc`,
  "--type-add", `${MARKDOWN_TYPE}:*.txt`,
];
const CODE_TYPE_ARGS = [
  "--type-add", `${CODE_TYPE}:*.ts`,
  "--type-add", `${CODE_TYPE}:*.tsx`,
  "--type-add", `${CODE_TYPE}:*.js`,
  "--type-add", `${CODE_TYPE}:*.jsx`,
  "--type-add", `${CODE_TYPE}:*.mjs`,
  "--type-add", `${CODE_TYPE}:*.cjs`,
  "--type-add", `${CODE_TYPE}:*.mts`,
  "--type-add", `${CODE_TYPE}:*.cts`,
  "--type-add", `${CODE_TYPE}:*.py`,
  "--type-add", `${CODE_TYPE}:*.go`,
  "--type-add", `${CODE_TYPE}:*.rs`,
  "--type-add", `${CODE_TYPE}:*.java`,
  "--type-add", `${CODE_TYPE}:*.cs`,
  "--type-add", `${CODE_TYPE}:*.c`,
  "--type-add", `${CODE_TYPE}:*.cc`,
  "--type-add", `${CODE_TYPE}:*.cpp`,
  "--type-add", `${CODE_TYPE}:*.h`,
  "--type-add", `${CODE_TYPE}:*.hpp`,
  "--type-add", `${CODE_TYPE}:*.rb`,
  "--type-add", `${CODE_TYPE}:*.php`,
  "--type-add", `${CODE_TYPE}:*.swift`,
  "--type-add", `${CODE_TYPE}:*.kt`,
  "--type-add", `${CODE_TYPE}:*.kts`,
  "--type-add", `${CODE_TYPE}:*.scala`,
  "--type-add", `${CODE_TYPE}:*.sh`,
  "--type-add", `${CODE_TYPE}:*.ps1`,
  "--type-add", `${CODE_TYPE}:*.sql`,
];

const LANES: Record<SmartLaneName, SmartLane> = {
  markdown: {
    name: "markdown",
    args: [...MARKDOWN_TYPE_ARGS, "--type", MARKDOWN_TYPE],
  },
  code: {
    name: "code",
    args: [...CODE_TYPE_ARGS, "--type", CODE_TYPE],
  },
  everything: {
    name: "everything",
    args: [...MARKDOWN_TYPE_ARGS, ...CODE_TYPE_ARGS, "--type-not", MARKDOWN_TYPE, "--type-not", CODE_TYPE],
  },
};

export function planSmartSearch(query: string, opts: { regex: boolean }): SmartPlan {
  if (opts.regex) {
    return sequential("regex search uses one rg walk");
  }

  const normalized = query.trim();
  if (!normalized) {
    return sequential("empty query uses one rg walk");
  }

  const extensionLane = laneForExtensionLikeQuery(normalized.toLowerCase());
  if (extensionLane) {
    return {
      strategy: "narrowed",
      reason: `extension-like query targets ${extensionLane}`,
      lanes: [LANES[extensionLane]],
      fallbackOnZero: true,
    };
  }

  return {
    strategy: "fanout",
    reason: "default markdown/code/everything fanout",
    lanes: [LANES.markdown, LANES.code, LANES.everything],
    fallbackOnZero: true,
  };
}

function sequential(reason: string): SmartPlan {
  return { strategy: "sequential", reason, lanes: [], fallbackOnZero: false };
}

function laneForExtensionLikeQuery(lower: string): SmartLaneName | null {
  const match = lower.match(/\.([a-z0-9]+)\b/u);
  const extension = match?.[1];
  if (!extension) {
    return null;
  }
  if (["md", "mdx", "rst", "adoc", "txt"].includes(extension)) {
    return "markdown";
  }
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "py", "go", "rs", "java", "cs", "c", "cc", "cpp", "h", "hpp", "rb", "php", "swift", "kt", "kts", "scala", "sh", "ps1", "sql"].includes(extension)) {
    return "code";
  }
  return null;
}
