function useStoreSelector( selector, state ) {
	if ( typeof selector !== 'function' ) {
		throw new TypeError( 'useStoreSelector expects a selector function.' );
	}

	if ( arguments.length < 2 ) {
		return undefined;
	}

	return selector( state );
}

module.exports = {
	useStoreSelector,
};
