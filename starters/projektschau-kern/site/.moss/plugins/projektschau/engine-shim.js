/*
 * engine-shim.js: the two browser objects the Projektschau renderer needs, for moss's QuickJS plugin engine.
 *
 * The listing hook evaluates this file, then the unchanged projektschau.js, calls Projektschau.render() to draw the board
 * at build time, and removes the globals again. It is not a DOM: it implements exactly what the renderer reads.
 *   document.baseURI, document.querySelectorAll   url() resolves links against the base; the last line of the renderer
 *                                                  looks for mounts (there are none to find in the engine).
 *   DOMParser                                      svg() (image/svg+xml) and kses() (text/html) parse the plugin's own
 *                                                  markup: documentElement, body, children, childNodes, nodeType 1 and 3,
 *                                                  nodeValue (entity-decoded), localName, getAttribute, hasAttribute.
 *   URL.protocol                                   the engine's URL resolves addresses (href) but has no protocol, which url()
 *                                                  reads to refuse javascript: and data: links; without it every link is dropped.
 * Parsing is defensive: unknown tags, unclosed tags and a stray "<" never throw. HTML follows the browser's forgiving
 * rules in the few cases the board's markup can reach (void tags, <p> and <li> closing on the next one, raw-text
 * script/style); the XML mode is strict, and malformed input yields a "parsererror" document, as in a browser.
 */
( function () {
	'use strict';

	var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', middot: '·', times: '×' };
	var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
	var RAW = { script: 1, style: 1, textarea: 1, title: 1 };
	var CLOSES_P = { p: 1, ul: 1, ol: 1, li: 0, div: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, table: 1, blockquote: 1, pre: 1 };

	function decode( s, xml ) {
		return s.replace( /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g, function ( all, dec, hex, name ) {
			if ( name ) { return Object.prototype.hasOwnProperty.call( NAMED, name ) && ( ! xml || /^(amp|lt|gt|quot|apos)$/.test( name ) ) ? NAMED[ name ] : all; }
			var n = dec ? parseInt( dec, 10 ) : parseInt( hex, 16 );
			return n > 0 && n <= 0x10ffff && ! ( n >= 0xd800 && n <= 0xdfff ) ? String.fromCodePoint( n ) : '�';
		} );
	}

	function element( name, attrs ) {
		var el = { nodeType: 1, localName: name, children: [], childNodes: [], _attrs: attrs || {} };
		el.getAttribute = function ( a ) { return Object.prototype.hasOwnProperty.call( el._attrs, a ) ? el._attrs[ a ] : null; };
		el.hasAttribute = function ( a ) { return Object.prototype.hasOwnProperty.call( el._attrs, a ); };
		return el;
	}
	function append( parent, node ) {
		if ( node.nodeType === 3 ) {
			var last = parent.childNodes[ parent.childNodes.length - 1 ];
			if ( last && last.nodeType === 3 ) { last.nodeValue += node.nodeValue; return; }
		} else { parent.children.push( node ); }
		parent.childNodes.push( node );
	}
	function text( s ) { return { nodeType: 3, nodeValue: s, localName: null }; }

	// Attributes of a start tag body such as ` href="x" disabled`; returns null in XML mode when it is malformed.
	function parseAttrs( s, xml ) {
		var attrs = {}, re = /\s*([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, m, pos = 0;
		s = s.replace( /\/\s*$/, '' );
		while ( pos < s.length && ( m = re.exec( s ) ) && m.index === pos ) {
			pos = re.lastIndex;
			var name = xml ? m[ 1 ] : m[ 1 ].toLowerCase(), v = m[ 2 ] !== undefined ? m[ 2 ] : m[ 3 ] !== undefined ? m[ 3 ] : m[ 4 ];
			if ( xml && v === undefined ) { return null; }
			if ( ! Object.prototype.hasOwnProperty.call( attrs, name ) ) { attrs[ name ] = decode( v === undefined ? '' : v, xml ); }
			if ( re.lastIndex === m.index ) { re.lastIndex++; }
		}
		if ( xml && s.slice( pos ).trim() ) { return null; }
		return attrs;
	}

	// Returns { root, ok }. HTML mode never fails; XML mode sets ok = false on anything a strict parser refuses.
	function parse( src, xml ) {
		src = String( src ).replace( /\r\n?/g, '\n' );
		var root = element( xml ? '' : 'body' ), stack = [ root ], pos = 0, ok = true, top = function () { return stack[ stack.length - 1 ]; };
		function open( name ) { for ( var i = stack.length - 1; i > 0; i-- ) { if ( stack[ i ].localName === name ) { return i; } } return -1; }
		while ( pos < src.length ) {
			var lt = src.indexOf( '<', pos );
			if ( lt < 0 ) { lt = src.length; }
			if ( lt > pos ) {
				var chunk = src.slice( pos, lt );
				if ( xml && /&(?!(?:#\d+|#[xX][0-9a-fA-F]+|amp|lt|gt|quot|apos);)/.test( chunk ) ) { ok = false; }
				append( top(), text( decode( chunk, xml ) ) );
				pos = lt;
				if ( pos >= src.length ) { break; }
			}
			var rest = src.slice( pos );
			var m;
			if ( rest.slice( 0, 4 ) === '<!--' ) {
				var ce = src.indexOf( '-->', pos + 4 );
				if ( ce < 0 ) { if ( xml ) { ok = false; } break; }
				pos = ce + 3;
			} else if ( ( m = /^<([!?])[^>]*>/.exec( rest ) ) ) {
				pos += m[ 0 ].length;
			} else if ( ( m = /^<\/([A-Za-z][^\s\/>]*)\s*>/.exec( rest ) ) ) {
				var cname = xml ? m[ 1 ] : m[ 1 ].toLowerCase(), at = open( cname );
				if ( at >= 0 ) { if ( xml && at !== stack.length - 1 ) { ok = false; } stack.length = at; }
				else if ( xml ) { ok = false; }
				pos += m[ 0 ].length;
			} else if ( ( m = /^<([A-Za-z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec( rest ) ) ) {
				pos += m[ 0 ].length;
				var name = xml ? m[ 1 ] : m[ 1 ].toLowerCase(), selfClose = /\/\s*$/.test( m[ 2 ] ), attrs = parseAttrs( m[ 2 ], xml );
				if ( ! attrs ) { ok = false; attrs = {}; }
				if ( ! xml ) {
					if ( name === 'html' || name === 'head' || name === 'body' ) { continue; }
					if ( name === 'li' ) { var li = open( 'li' ), blocker = Math.max( open( 'ul' ), open( 'ol' ) ); if ( li > blocker ) { stack.length = li; } }
					if ( CLOSES_P[ name ] && open( 'p' ) >= 0 && top().localName === 'p' ) { stack.pop(); }
				}
				var el = element( name, attrs );
				append( top(), el );
				if ( xml ? selfClose : VOID[ name ] ) { continue; }
				if ( ! xml && RAW[ name ] ) {
					var re = new RegExp( '</' + name + '\\s*>', 'i' ), tail = src.slice( pos ), cm = re.exec( tail );
					append( el, text( cm ? tail.slice( 0, cm.index ) : tail ) );
					pos += cm ? cm.index + cm[ 0 ].length : tail.length;
					continue;
				}
				stack.push( el );
			} else {
				// a "<" that opens nothing is text (HTML); a strict parser refuses it
				if ( xml ) { ok = false; }
				append( top(), text( '<' ) );
				pos += 1;
			}
		}
		if ( xml && stack.length > 1 ) { ok = false; }
		return { root: root, ok: ok };
	}

	function DOMParser() {}
	DOMParser.prototype.parseFromString = function ( src, type ) {
		var xml = /xml/.test( String( type ) ), r = parse( src, xml );
		if ( xml ) {
			var only = r.root.children;
			if ( ! r.ok || only.length !== 1 ) { return { documentElement: element( 'parsererror' ), body: null }; }
			return { documentElement: only[ 0 ], body: null };
		}
		var html = element( 'html' );
		append( html, r.root );
		return { documentElement: html, body: r.root };
	};

	var EngineURL = globalThis.URL;
	if ( typeof EngineURL === 'function' && new EngineURL( 'a:b', 'https://example.org/' ).protocol === undefined ) {
		globalThis.URL = function URL( u, base ) {
			var o = new EngineURL( u, base ), m = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec( o.href );
			this.href = o.href;
			this.protocol = m ? m[ 1 ].toLowerCase() : '';
		};
	}
	globalThis.DOMParser = DOMParser;
	globalThis.document = { baseURI: 'https://example.org/', querySelectorAll: function () { return []; } };
}() );
