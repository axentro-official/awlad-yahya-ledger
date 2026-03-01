import googleappsscript from "eslint-plugin-googleappsscript";

/**
 * ESLint Flat Config (ESLint v9+)
 * - Lints both frontend JS and Apps Script .gs files
 * - Keeps rules conservative to avoid breaking existing logic
 */
export default [
  {
    ignores: [
      "node_modules/**",
      "images/**",
      "**/*.min.js",
      "playwright-report/**",
      "test-results/**"
    ],
  },

  // Frontend/browser JS
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        console: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        alert: "readonly",
        confirm: "readonly",
        prompt: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { "args": "none", "ignoreRestSiblings": true }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "eqeqeq": ["warn", "smart"],
      "curly": ["warn", "multi-line"],
    },
  },

  // Google Apps Script (.gs)
  {
    files: ["**/*.gs"],
    plugins: { googleappsscript },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...googleappsscript.environments.googleappsscript.globals,
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { "args": "none", "ignoreRestSiblings": true }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "eqeqeq": ["warn", "smart"],
      "curly": ["warn", "multi-line"],
    },
  },
];
