
const handlebars = {
	name: "handlebars",
	replace: {
		format: `{{||%1||}}`,
	},
	list: {
		open: '{{#||%1||}}',
		close: '{{/||%1||}}',
		formatObjectProperty: `{{||%1||}}`,
		formatPrimitive: `{{.}}`,
	},
	control: {
		ifTruthy: {
			open: '{{#if_truthy ||%1||}}',
			close: '{{/if_truthy}}',
		},
		ifFalsy: {
			open: '{{#if_falsy ||%1||}}',
			close: '{{/if_falsy}}',
		},
		ifEqual: {
			open: '{{#if_equal ||%1|| ||%2||}}',
			close: '{{/if_equal}}',
		},
		ifNotEqual: {
			open: '{{#if_not_equal ||%1|| ||%2||}}',
			close: '{{/if_not_equal}}',
		},
	}
};

module.exports = handlebars;
