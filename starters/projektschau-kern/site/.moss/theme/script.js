( function () {
	'use strict';

	// KERN and Projektschau switch dark mode on data-kern-theme; moss's toggle sets data-theme on <html>.
	var root = document.documentElement;
	function mirror() { var t = root.getAttribute( 'data-theme' ); if ( t ) { root.setAttribute( 'data-kern-theme', t ); } }
	mirror();
	new MutationObserver( mirror ).observe( root, { attributes: true, attributeFilter: [ 'data-theme' ] } );

	// A partner without a portrait gets initials in the tile the stylesheet reserves for the portrait (moss exposes no initials for a list card).
	document.querySelectorAll( 'body[data-path$="/partners/"] .moss-card-row' ).forEach( function ( row ) {
		if ( row.querySelector( '.moss-card-cover' ) ) { return; }
		var words = ( ( row.querySelector( '.moss-card-title' ) || {} ).textContent || '' ).trim().split( /\s+/ ).filter( function ( w ) { return /^\p{Lu}/u.test( w ); } );
		if ( !words.length ) { return; }
		row.setAttribute( 'data-initials', words[ 0 ][ 0 ] + ( words.length > 1 ? words[ words.length - 1 ][ 0 ] : '' ) );
	} );
}() );
