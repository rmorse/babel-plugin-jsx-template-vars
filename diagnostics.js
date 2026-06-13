const diagnostics = {
	error( path, message ) {
		if ( path && typeof path.buildCodeFrameError === 'function' ) {
			throw path.buildCodeFrameError( message );
		}
		throw new Error( message );
	},

	warn( path, message ) {
		if ( path && path.hub && path.hub.file && typeof path.hub.file.log === 'object' && typeof path.hub.file.log.warn === 'function' ) {
			path.hub.file.log.warn( message );
			return;
		}
		if ( typeof console !== 'undefined' && typeof console.warn === 'function' ) {
			console.warn( message );
		}
	},

	unsupported( path, message, config = {} ) {
		if ( config.strict === true ) {
			this.error( path, message );
			return;
		}
		if ( config.warnOnUnsupported === false ) {
			return;
		}
		this.warn( path, message );
	},
};

module.exports = diagnostics;
