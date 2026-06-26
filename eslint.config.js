import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
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
      "unused-imports/no-unused-vars": ["warn", {
        vars: "all", varsIgnorePattern: "^_",
        args: "after-used", argsIgnorePattern: "^_",
      }],
      "react/no-unescaped-entities": "off",
      "react-refresh/only-export-components": "off",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn"
    },
  },
]);
