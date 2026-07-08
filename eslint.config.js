import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "scratch", ".claude", "scripts"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      react.configs.flat.recommended,
      react.configs.flat["jsx-runtime"],
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: { "unused-imports": unusedImports },
    rules: {
      "react/prop-types": "off",
      // unused-imports/no-unused-imports is auto-fixable (strips dead imports);
      // its no-unused-vars handles the rest, ignoring intentional _-prefixed args.
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/no-unescaped-entities": "off",
      "react-refresh/only-export-components": "off",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // TypeScript engine files. typescript-eslint's recommended set catches genuine
  // bugs; the migration-specific rules below make the "zero any / zero casts /
  // zero V1" north star (see TYPE_V2_MIGRATION_HANDOFF.md) machine-visible. They
  // are `warn`, not `error`, because most of the ~138 `any`s are V1↔V2 boundary
  // noise that dissolves as V2 becomes the native shape. `lint:js` caps warnings
  // at that count as a RATCHET: it can't regress, and we lower the cap as we
  // migrate. At the finish line (migration step 8) the cap goes to 0 and these
  // flip to `error`, locking it in.
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
