import globals from "globals";
export default [{
  ignores: ["public/vendor/**", "node_modules/**", ".netlify/**"],
  linterOptions: { reportUnusedDisableDirectives: false },
}, {
  files: ["public/*.js", "netlify/**/*.js", "tests/**/*.js", "scripts/*.mjs"],
  languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: {
    ...globals.browser, ...globals.node, XLSX: "readonly",
  } },
  rules: { "no-undef": "error" },
}, { files: ["**/*.mjs"], languageOptions: { sourceType: "module" } }];
