/**
 * ESLint Rule: no-dict-bracket-assign
 *
 * Inside a `for...of` over `Object.entries(x)` or `Object.keys(x)`, rejects
 * `out[key] = value` where `key` is the loop's key binding. A `__proto__` key
 * assigned with brackets reparents `out` instead of storing an own property.
 * `setDictField(out, key, value)` stores it with `Object.defineProperty`.
 *
 * Targets:
 * - for (const [k, v] of Object.entries(src)) out[k] = v;
 * - for (const k of Object.keys(src)) out[k] = src[k];
 *
 * Not auto-fixable: the fix adds an import whose path depends on the file.
 */

function loopKeyName(node) {
  const right = node.right;
  if (
    right?.type !== 'CallExpression' ||
    right.callee.type !== 'MemberExpression' ||
    right.callee.computed ||
    right.callee.object.type !== 'Identifier' ||
    right.callee.object.name !== 'Object' ||
    right.callee.property.type !== 'Identifier'
  ) {
    return null;
  }
  const method = right.callee.property.name;
  if (method !== 'entries' && method !== 'keys') return null;

  const left = node.left;
  if (left?.type !== 'VariableDeclaration') return null;
  const id = left.declarations[0]?.id;
  if (method === 'entries' && id?.type === 'ArrayPattern') {
    const first = id.elements[0];
    return first?.type === 'Identifier' ? first.name : null;
  }
  if (method === 'keys' && id?.type === 'Identifier') return id.name;
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow bracket assignment keyed by an Object.entries/keys loop variable',
      recommended: true,
    },
    schema: [],
    messages: {
      useSetDictField:
        "Use setDictField(obj, {{key}}, value): bracket assignment with a '__proto__' key reparents the object.",
    },
  },

  create(context) {
    const keys = [];

    return {
      ForOfStatement(node) {
        keys.push(loopKeyName(node));
      },
      'ForOfStatement:exit'() {
        keys.pop();
      },
      AssignmentExpression(node) {
        if (node.operator !== '=') return;
        const left = node.left;
        if (
          left.type !== 'MemberExpression' ||
          !left.computed ||
          left.property.type !== 'Identifier'
        ) {
          return;
        }
        const name = left.property.name;
        if (keys.includes(name)) {
          context.report({
            node,
            messageId: 'useSetDictField',
            data: { key: name },
          });
        }
      },
    };
  },
};
