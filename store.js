function useStoreSelector( selector, state = {} ) {
	if ( typeof selector !== 'function' ) {
		throw new TypeError( 'useStoreSelector expects a selector function.' );
	}

	return selector( state );
}

module.exports = {
	useStoreSelector,
};
