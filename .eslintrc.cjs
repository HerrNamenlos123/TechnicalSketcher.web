module.exports = {
  parser: "vue-eslint-parser",
  parserOptions: {
    parser: "@typescript-eslint/parser",
    ecmaVersion: 2022,
    project: "./tsconfig.json",
    extraFileExtensions: [".vue"],
    sourceType: "module",
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:vue/vue3-recommended",
  ],
  plugins: ["eslint-plugin-local-rules"],
  rules: {
    "@typescript-eslint/naming-convention": [
      "warn",
      {
        selector: "variable",
        format: ["camelCase", "UPPER_CASE", "PascalCase"],
        leadingUnderscore: "allow",
      },
    ],
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        args: "all",
        varsIgnorePattern: "^(_.*|props|emit)$",
        argsIgnorePattern: "^(_.*)$",
        caughtErrors: "all",
        destructuredArrayIgnorePattern: "^_",
      },
    ],
    "vue/no-unused-vars": [
      "error",
      {
        ignorePattern: "^(_.*|props|emit)$",
      },
    ],
    "vue/max-attributes-per-line": [
      "error",
      {
        singleline: {
          max: 100,
        },
        multiline: {
          max: 1,
        },
      },
    ],
    "vue/attributes-order": [
      "error",
      {
        order: [
          "DEFINITION",
          "LIST_RENDERING",
          "CONDITIONALS",
          "RENDER_MODIFIERS",
          "GLOBAL",
          "UNIQUE",
          "SLOT",
          "TWO_WAY_BINDING",
          "OTHER_DIRECTIVES",
          "ATTR_STATIC",
          "ATTR_DYNAMIC",
          "ATTR_SHORTHAND_BOOL",
          "EVENTS",
          "CONTENT",
        ],
        alphabetical: true,
      },
    ],
    "vue/html-self-closing": [
      "warn",
      {
        html: {
          void: "always",
          normal: "always",
          component: "always",
        },
        svg: "always",
        math: "always",
      },
    ],
    "vue/block-order": [
      "error",
      {
        order: ["script", "template", "style"],
      },
    ],
    "vue/block-lang": [
      "error",
      {
        script: {
          lang: "ts",
        },
      },
    ],
    // "vue/no-restricted-syntax": [
    //   "error",
    //   {
    //     selector: "VElement[BasicButton]",
    //   },
    // ],
    "vue/no-restricted-v-on": [
      "error",
      {
        argument: "click",
        element: "BasicButton",
        message:
          "Using the native 'click' event on <BasicButton> is a mistake as is does not accept keyboard controls. Use '@clicked' instead.",
      },
    ],
    // "vue/no-restricted-html-elements": ["error", "span", "h1", "h2", "h3", "h4", "p"],
    "dot-notation": ["error", { allowKeywords: true }],
    "vue/component-api-style": ["error", ["script-setup"]],
    "vue/define-emits-declaration": ["error", "type-literal"],
    "vue/define-props-declaration": ["error", "type-based"],
    "vue/next-tick-style": ["error", "promise"],
    "vue/camelcase": "error",
    "local-rules/no-force-update": "error",
    // "local-rules/no-get-element-by-id": "error",
    "local-rules/use-await-nexttick": "warn",
    "vue/no-undef-components": [
      "error",
      {
        ignorePatterns: [],
      },
    ],
  },
  globals: {
    _APP_NAME: "readonly",
    _APP_VERSION: "readonly",
  },
};
