module.exports = {
  'no-force-update': {
    meta: {
      type: 'suggestion',
      docs: {
        description: 'disallow using $forceUpdate() in any case',
        category: 'Stylistic Issues',
        recommended: false,
      },
      schema: [], // no options
    },
    create(context) {
      return {
        CallExpression(node) {
          const { callee, arguments: args } = node;
          if (callee.type === 'MemberExpression') {
            if (callee.property.name === '$forceUpdate') {
              context.report({
                node,
                message:
                  'Do not use $forceUpdate() in any case. If you need it, something is fundamentally wrong with your component',
              });
            }
          }
        },
      };
    },
  },
  'no-get-element-by-id': {
    meta: {
      type: 'suggestion',
      docs: {
        description: "disallow using getElementById() in favor of vue's refs",
        category: 'Stylistic Issues',
        recommended: false,
      },
      schema: [], // no options
    },
    create(context) {
      return {
        CallExpression(node) {
          const { callee, arguments: args } = node;
          if (callee.type === 'MemberExpression') {
            if (callee.property.name === 'getElementById') {
              context.report({
                node,
                message: 'Do not use getElementById(). Instead, bind a ref to your component using :ref="..."',
              });
            }
          }
        },
      };
    },
  },
  'use-await-nexttick': {
    meta: {
      type: 'suggestion',
      docs: {
        description: 'disallow using .$nextTick() syntax in favor for await nextTick()',
        category: 'Stylistic Issues',
        recommended: false,
      },
      schema: [], // no options
    },
    create(context) {
      return {
        CallExpression(node) {
          const { callee, arguments: args } = node;
          if (callee.type === 'MemberExpression') {
            if (callee.property.name === '$nextTick') {
              context.report({
                node,
                message:
                  "Do not use the $nextTick() legacy function. Instead, make your function async and use 'await nextTick()' instead.",
              });
            }
          }
        },
      };
    },
  },
  'vue-component-section-order': {
    meta: {
      type: 'suggestion',
      docs: {
        description: 'enforce order of sections in Vue components (script, template, style)',
        category: 'Stylistic Issues',
        recommended: false,
      },
      fixable: 'code',
      schema: [], // no options
    },
    create(context) {
      return {
        Program(node) {
          const sourceCode = context.getSourceCode();
          const text = sourceCode.getText(node);

          const scriptMatch = text.match(/<script.*?>/s);
          const templateMatch = text.match(/<template.*?>/s);
          const styleMatch = text.match(/<style.*?>/s);

          const sections = [
            { name: 'script', index: scriptMatch ? scriptMatch.index : null },
            { name: 'template', index: templateMatch ? templateMatch.index : null },
            { name: 'style', index: styleMatch ? styleMatch.index : null },
          ];

          const presentSections = sections.filter((section) => section.index !== null);
          const sortedSections = [...presentSections].sort((a, b) => a.index - b.index);

          for (let i = 0; i < presentSections.length; i++) {
            if (presentSections[i].name !== sortedSections[i].name) {
              context.report({
                node,
                message: 'Sections in Vue components should be ordered: <script>, <template>, <style>.',
              });
              break;
            }
          }
        },
      };
    },
  },
};
