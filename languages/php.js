
const php = {
	name: 'php',
	replace: {
		format: `<?php echo htmlspecialchars( $||%parent||[ '||%1||' ], ENT_QUOTES ); ?>`,
	},
	list: {
		open: `<?php foreach ( $||%parent||[ '||%1||' ] as $||%child|| ) { ?>`,
		close: `<?php } ?>`,
		formatObjectProperty: `<?php echo htmlspecialchars( $item[ '||%1||' ], ENT_QUOTES ); ?>`,
		formatPrimitive: `<?php echo htmlspecialchars( $item, ENT_QUOTES ); ?>`,
	},
	control: {
		ifTruthy: {
			open: `<?php if ( $||%parent||[ '||%1||' ] ) { ?>`,
			close: '<?php } ?>',
		},
		ifFalsy: {
			open: `<?php if ( ! $||%parent||[ '||%1||' ] ) { ?>`,
			close: '<?php } ?>',
		},
		ifEqual: {
			open: `<?php if ( $||%parent||[ '||%1||' ] === ||%2|| ) { ?>`,
			close: '<?php } ?>',
		},
		ifNotEqual: {
			open: `<?php if ( $||%parent||[ '||%1||' ] !== ||%2|| ) { ?>`,
			close: '<?php } ?>',
		},
	},
	supportsContext: true,
};
module.exports = php;
