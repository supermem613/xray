import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "test/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      curly: ["error", "all"],
      "brace-style": ["error", "1tbs", { allowSingleLine: false }],
      indent: ["error", 2, { SwitchCase: 1 }],
      "@typescript-eslint/no-explicit-any": "off"
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    },
  },
];
