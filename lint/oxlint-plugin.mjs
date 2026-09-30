// The rules of the amxts repositories' lint that oxlint has no native rule
// for, and whose ESLint plugin it cannot load, as an oxlint JS plugin:
//   "jsPlugins": [{ "name": "amxts", "specifier": "@amxts/core/lint/oxlint-plugin.mjs" }]

/**
 * ESLint's no-restricted-syntax: each option is an AST selector, or
 * `{ selector, message }`, and a node it matches is an error.
 */
const noRestrictedSyntax = {
	meta: {
		type: 'suggestion',
		docs: { description: 'Disallow the syntax the options name, by AST selector (ESLint\'s no-restricted-syntax).' },
		schema: false,
	},
	create(context) {
		const visitors = {};
		for (const option of context.options) {
			const { selector, message } = typeof option === 'string' ? { selector: option, message: undefined } : option;
			visitors[selector] = node => context.report({ node, message: message ?? `Using '${selector}' is not allowed.` });
		}
		return visitors;
	},
};

/**
 * eslint-plugin-jsdoc's check-alignment: the asterisks of a JSDoc block stand
 * under the first asterisk of its `/**`. (The plugin itself imports eslint,
 * which oxlint does not have.)
 */
const jsdocCheckAlignment = {
	meta: {
		type: 'layout',
		fixable: 'whitespace',
		docs: { description: 'The asterisks of a JSDoc block stand in one column (eslint-plugin-jsdoc\'s check-alignment).' },
		schema: [],
	},
	create(context) {
		const source = context.sourceCode;
		return {
			Program() {
				const text = source.text;
				for (const comment of source.getAllComments()) {
					if (comment.type !== 'Block' || !comment.value.startsWith('*')) continue;
					const lineStart = text.lastIndexOf('\n', comment.range[0] - 1) + 1;
					const indent = text.slice(lineStart, comment.range[0]);
					// A block after code on its line has no column to keep.
					if (/\S/.test(indent)) continue;
					const wanted = `${indent} `;
					const lines = comment.value.split('\n');
					const wrong = [];
					let at = comment.range[0] + 2;
					for (const [index, line] of lines.entries()) {
						// A line's own asterisk, or the last line's closing `*/`.
						const lead = index === 0 ? null : index === lines.length - 1 && /^[ \t]*$/.test(line) ? [line, line] : /^([ \t]*)\*/.exec(line);
						if (lead && lead[1] !== wanted) wrong.push([at, at + lead[1].length]);
						at += line.length + 1;
					}
					// One report a block, as the plugin makes, and one fix for all its lines.
					if (wrong.length === 0) continue;
					context.report({
						loc: { start: source.getLocFromIndex(wrong[0][0]), end: source.getLocFromIndex(wrong[0][1]) },
						message: 'Expected JSDoc block to be aligned.',
						fix: fixer => wrong.map(range => fixer.replaceTextRange(range, wanted)),
					});
				}
			},
		};
	},
};

export default {
	meta: { name: 'amxts' },
	rules: {
		'no-restricted-syntax': noRestrictedSyntax,
		'jsdoc-check-alignment': jsdocCheckAlignment,
	},
};
