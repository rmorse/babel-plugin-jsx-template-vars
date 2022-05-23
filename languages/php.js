
const php = {
	name: 'php',
	replace: {
		format: `<?php echo htmlspecialchars( $data[ '||%1||' ], ENT_QUOTES ); ?>`,
	},
	list: {
		open: `<?php foreach ( $data[ '||%1||' ] as $item ) { ?>`,
		close: `<?php } ?>`,
		formatObjectProperty: `<?php echo htmlspecialchars( $item[ '||%1||' ], ENT_QUOTES ); ?>`,
		formatPrimitive: `<?php echo htmlspecialchars( $item, ENT_QUOTES ); ?>`,
	},
	control: {
		ifTruthy: {
			open: `<?php if ( $data[ '||%1||' ] ) { ?>`,
			close: '<?php } ?>',
		},
		ifFalsy: {
			open: `<?php if ( ! $data[ '||%1||' ] ) { ?>`,
			close: '<?php } ?>',
		},
		ifEqual: {
			open: `<?php if ( $data[ '||%1||' ] === ||%2|| ) { ?>`,
			close: '<?php } ?>',
		},
		ifNotEqual: {
			open: `<?php if ( $data[ '||%1||' ] !== ||%2|| ) { ?>`,
			close: '<?php } ?>',
		},
	}
};
module.exports = php;
