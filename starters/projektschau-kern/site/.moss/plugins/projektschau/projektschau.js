/*!
 * Projektschau für KERN: Projektübersicht mit Karten, Filtern und Zeitleiste auf Basis des KERN UX-Standards.
 * Lizenz: EUPL-1.2. Kein Framework, kein Build. Rendert ein Datenpaket (JSON) in ein Element mit [data-projektschau].
 *
 * Die Daten gelten als vertrauenswürdig wie die Seite selbst: Felder mit HTML (Einleitung, Beschreibung, Abschnitte,
 * Kennzahl, Fußtexte) werden unverändert eingesetzt, alle anderen Texte werden maskiert.
 */
( function () {
	'use strict';

	var LIVE = { de: '%d Projekte sichtbar', en: '%d projects shown' };
	var LEER = { de: 'Keine Projekte sichtbar', en: 'No projects shown' };

	/* Steuerzeichen, die Text umdrehen oder verstecken (Bidi, Zero-Width, BOM, C0 außer Tab/Umbruch), fallen überall weg */
	var RE_STEUER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
	function esc( s ) {
		return String( s == null ? '' : s ).replace( RE_STEUER, '' ).replace( /[&<>"']/g, function ( c ) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ];
		} );
	}
	function pad( n ) { n = parseInt( n, 10 ); return isNaN( n ) ? '' : ( n < 10 ? '0' : '' ) + n; }
	var zaehler = 0;
	/* Formate, die roh im Stylesheet, in Attributnamen oder Selektoren landen und deshalb nicht maskiert werden können */
	var RE_SCHLUESSEL = /^[a-z][a-z0-9_-]{0,40}$/, RE_SPRACHE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i, RE_FARBE = /^#[0-9a-f]{3,8}$/i;
	/* Links nur mit http(s), mailto, tel oder relativ; javascript: und data: fallen weg. */
	function url( u ) {
		try { return /^(https?|mailto|tel):$/.test( new URL( String( u ), document.baseURI ).protocol ) ? String( u ) : ''; } catch ( e ) { return ''; }
	}
	/* Icon-Markup auf Formen beschränken, nur diese Elemente und Attribute, kein Skript, kein Ereignis, kein use/href. */
	var SVG_ELEMENTE = [ 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse' ], SVG_ATTRIBUTE = [ 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'rx', 'ry', 'points' ];
	function svg( inner ) {
		if ( ! inner || typeof DOMParser === 'undefined' ) { return ''; }
		var doc = new DOMParser().parseFromString( '<svg xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>', 'image/svg+xml' ), out = '';
		if ( doc.documentElement.localName !== 'svg' ) { return ''; }
		Array.prototype.forEach.call( doc.documentElement.children, function ( el ) {
			if ( SVG_ELEMENTE.indexOf( el.localName ) < 0 ) { return; }
			out += '<' + el.localName;
			SVG_ATTRIBUTE.forEach( function ( a ) { if ( el.hasAttribute( a ) ) { out += ' ' + a + '="' + esc( el.getAttribute( a ) ) + '"'; } } );
			if ( /^(none|currentColor)$/.test( el.getAttribute( 'fill' ) || '' ) ) { out += ' fill="' + el.getAttribute( 'fill' ) + '"'; }
			out += '/>';
		} );
		return out;
	}
	/* HTML-Felder (Einleitung, Beschreibung, Abschnitte, Kennzahl, Fußtexte) auf eine Allowlist reduzieren: Links mit
	 * geprüftem href, Hervorhebung, Absatz, Umbruch, Listen. Alles andere fällt weg, der Text bleibt. Ohne DOMParser wird maskiert. */
	var HTML_ELEMENTE = [ 'a', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li' ];
	function kses( s ) {
		s = String( s == null ? '' : s ).replace( RE_STEUER, '' );
		if ( ! s || s.indexOf( '<' ) < 0 ) { return esc( s ); }
		if ( typeof DOMParser === 'undefined' ) { return esc( s ); }
		var doc = new DOMParser().parseFromString( '<body>' + s + '</body>', 'text/html' );
		function knoten( n ) {
			var out = '';
			Array.prototype.forEach.call( n.childNodes, function ( c ) {
				if ( c.nodeType === 3 ) { out += esc( c.nodeValue ); return; }
				if ( c.nodeType !== 1 ) { return; }
				var name = c.localName, innen = knoten( c );
				if ( HTML_ELEMENTE.indexOf( name ) < 0 ) { out += innen; return; }
				if ( name === 'br' ) { out += '<br>'; return; }
				var h = name === 'a' ? url( c.getAttribute( 'href' ) || '' ) : '';
				out += '<' + name + ( h ? ' href="' + esc( h ) + '"' : '' ) + '>' + innen + '</' + name + '>';
			} );
			return out;
		}
		return knoten( doc.body );
	}
	function icon( inner, klasse ) {
		inner = svg( inner );
		return inner ? '<svg class="' + ( klasse || 'ps-icon' ) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>' : '';
	}

	/* Baut Markup und Stylesheet-Regeln getrennt: init() setzt die Regeln über das CSSOM ein, das auch unter einer strengen
	 * Content-Security-Policy ohne 'unsafe-inline' erlaubt ist; render() liefert beides als eine Zeichenkette (API). Deshalb gibt es
	 * keine style-Attribute: Bereichsvariablen hängen an data-bereich. */
	/* Nur Objekte aus einer Liste; alles andere (null, Zahlen, Zeichenketten, kein Array) fällt weg, damit kaputte Pakete nicht werfen */
	function liste( x ) { return Array.isArray( x ) ? x.filter( function ( v ) { return v && typeof v === 'object' && ! Array.isArray( v ); } ) : []; }
	function objekt( x ) { return x && typeof x === 'object' && ! Array.isArray( x ) ? x : {}; }
	function bauen( d, opt ) {
		opt = objekt( opt );
		d = objekt( d );
		var sprachen = ( Array.isArray( d.sprachen ) ? d.sprachen : [] ).filter( function ( s ) { return typeof s === 'string' && RE_SPRACHE.test( s ); } );
		if ( ! sprachen.length ) { sprachen = [ 'de' ]; }
		var t = objekt( d.texte );
		var bereiche = {}, einordnungen = {};
		/* Begriffe mit ungültigem Schlüssel bleiben draußen; ihre Karten erscheinen ohne Bereich bzw. Einordnung */
		liste( d.bereiche ).forEach( function ( b ) { if ( typeof b.schluessel === 'string' && RE_SCHLUESSEL.test( b.schluessel ) ) { bereiche[ b.schluessel ] = b; } } );
		liste( d.einordnungen ).forEach( function ( e ) { if ( typeof e.schluessel === 'string' && RE_SCHLUESSEL.test( e.schluessel ) ) { einordnungen[ e.schluessel ] = e; } } );
		var projekte = liste( d.projekte );
		var ebene = Math.max( 1, Math.min( 4, opt.ebene || 2 ) );
		var h = function ( plus ) { return 'h' + Math.min( 6, ebene + plus ); };
		var zeitleiste = opt.ansicht === 'zeitleiste';
		var vorBereich = bereiche[ opt.bereich ] ? opt.bereich : 'all';
		var sprache = sprachen.indexOf( opt.sprache ) >= 0 ? opt.sprache : sprachen[ 0 ];

		/* Sprachpaar: identische oder einsprachige Texte stehen ohne Hülle; sonst je Sprache ein Element mit lang. */
		function sp( paar, html, block ) {
			if ( ! paar || typeof paar !== 'object' ) { return ''; }
			var f = html ? kses : esc;
			var werte = sprachen.map( function ( s ) { return String( paar[ s ] == null ? '' : paar[ s ] ); } );
			if ( sprachen.length < 2 || werte.every( function ( w ) { return w === werte[ 0 ]; } ) ) { return f( werte[ 0 ] ); }
			var tag = block ? 'div' : 'span';
			return sprachen.map( function ( s, i ) { return '<' + tag + ' lang="' + esc( s ) + '">' + f( werte[ i ] ) + '</' + tag + '>'; } ).join( '' );
		}
		/* aria-label in der Startsprache plus data-aria-<sprache> für den Sprachwechsel. */
		function aria( paar ) {
			if ( ! paar || ! paar[ sprache ] ) { return ''; }
			var o = ' aria-label="' + esc( paar[ sprache ] ) + '"';
			if ( sprachen.length > 1 ) { sprachen.forEach( function ( s ) { o += ' data-aria-' + esc( s ) + '="' + esc( paar[ s ] || '' ) + '"'; } ); }
			return o;
		}
		function label( paar ) { return '<span class="kern-label">' + sp( paar ) + '</span>'; }
		function btn( attrs, inhalt, aktiv, klasse, groesse ) {
			return '<button type="button" class="kern-btn kern-btn--' + ( groesse || 'small' ) + ' ' + ( aktiv ? 'kern-btn--primary' : 'kern-btn--secondary' ) + ( klasse ? ' ' + klasse : '' ) + '" aria-pressed="' + ( aktiv ? 'true' : 'false' ) + '" ' + attrs + '>' + inhalt + '</button>';
		}
		function filterBtn( k, text, ic, aktiv, n, bereich ) {
			return btn( 'data-filter="' + esc( k ) + '"' + ( bereich ? ' data-bereich="' + esc( k ) + '"' : '' ), icon( ic ) + '<span class="kern-label">' + sp( text ) + ' <span class="ps-count">(' + n + ')</span></span>', aktiv, bereich ? 'ps-btn-bereich' : '', 'x-small' );
		}
		function badge( k, inhalt ) {
			return '<span class="kern-badge kern-badge--small' + ( k ? ' ps-badge' : '' ) + '"' + ( k ? ' data-bereich="' + esc( k ) + '"' : '' ) + '>' + inhalt + '</span>';
		}

		/* Nur bekannte Schlüssel kommen in Attribute und Variablennamen; unbekannte Karten laufen ohne Bereich bzw. Einordnung */
		function kb( p ) { return bereiche[ p.bereich ] ? p.bereich : ''; }
		function ke( p ) { return einordnungen[ p.einordnung ] ? p.einordnung : ''; }
		function karte( p ) {
			var b = bereiche[ p.bereich ] || {}, e = einordnungen[ p.einordnung ] || {}, k = kb( p );
			var o = '<div class="kern-col-12 kern-col-md-6 kern-col-lg-4 kern-col-xxl-3 ps-col' + ( vorBereich !== 'all' && k !== vorBereich ? ' is-hidden' : '' ) + '"><article class="kern-card kern-card--small kern-layer kern-level-1 ps-card" data-bereich="' + esc( k ) + '" data-cat="' + esc( ke( p ) ) + '">';
			// Cover mit großem Symbol; sichtbar nur mit data-symbole="ja" am Wrapper (CSS)
			if ( p.icon_svg ) { o += '<div class="kern-card__media ps-cover">' + icon( p.icon_svg, 'ps-cover-icon' ) + '</div>'; }
			o += '<div class="kern-card__container"><div class="kern-card__header">';
			o += '<div class="ps-tags">' + badge( k, icon( b.icon_svg ) + label( b.label ) ) + badge( null, label( e.label ) ) + '<span class="ps-num kern-label kern-label--subtle">' + pad( p.nr ) + '</span></div>';
			o += '<div class="kern-hgroup"><' + h( 1 ) + ' class="kern-title">' + sp( p.titel ) + '</' + h( 1 ) + '>';
			if ( p.status ) { o += '<p class="kern-subline kern-subline--small">' + sp( p.status ) + '</p>'; }
			o += '</div></div><div class="kern-card__body">';
			if ( p.beschreibung ) { o += '<p class="kern-body">' + sp( p.beschreibung, true ) + '</p>'; }
			liste( p.abschnitte ).forEach( function ( a ) {
				if ( a.label ) { o += '<p class="kern-label ps-field">' + sp( a.label ) + '</p>'; }
				if ( a.typ === 'liste' ) {
					o += '<ul class="kern-list kern-list--bullet kern-list--small">' + ( Array.isArray( a.punkte ) ? a.punkte : [] ).map( function ( pt ) { return '<li>' + sp( pt, true ) + '</li>'; } ).join( '' ) + '</ul>';
				} else {
					o += '<p class="kern-body kern-body--small">' + sp( a.text, true ) + '</p>';
				}
			} );
			// <strong> statt kern-body--bold: die Regeln der kompakten Karte überschreiben den Modifikator.
			if ( p.kennzahl ) { o += '<p class="kern-body ps-kpi"><strong>' + sp( p.kennzahl, true ) + '</strong></p>'; }
			o += '</div>';
			var links = liste( p.links ).filter( function ( l ) { return url( l.url ); } );
			if ( links.length ) {
				o += '<hr class="kern-divider kern-divider--decorative ps-card-divider"><div class="kern-card__footer">' + links.map( function ( l ) { return '<a class="kern-link kern-link--small" href="' + esc( url( l.url ) ) + '">' + sp( l.text ) + '</a>'; } ).join( '' ) + '</div>';
			}
			return o + '</div></article></div>';
		}

		function zeitleisteHtml() {
			var zeilen = projekte.filter( function ( p ) { return p.zeitleiste && typeof p.zeitleiste === 'object'; } ).sort( function ( a, b ) {
				return ( a.zeitleiste.sortierung - b.zeitleiste.sortierung ) || ( a.nr - b.nr );
			} );
			var jahre = {}, reihenfolge = [];
			zeilen.forEach( function ( p ) {
				var j = String( p.zeitleiste.jahr || String( p.zeitleiste.sortierung ).slice( 0, 4 ) );
				if ( ! jahre[ j ] ) { jahre[ j ] = []; reihenfolge.push( j ); }
				jahre[ j ].push( p );
			} );
			return '<ol class="ps-tl">' + reihenfolge.map( function ( j ) {
				return '<li class="ps-year" data-year="' + esc( j ) + '"><' + h( 1 ) + ' class="kern-heading kern-heading-medium ps-tl-jahr">' + esc( j ) + '</' + h( 1 ) + '><ol class="ps-tl-liste">' + jahre[ j ].map( function ( p ) {
					var z = p.zeitleiste, b = bereiche[ p.bereich ] || {}, e = einordnungen[ p.einordnung ] || {}, k = kb( p );
					return '<li class="ps-row" data-cat="' + esc( ke( p ) ) + '" data-bereich="' + esc( k ) + '">'
						+ '<span class="ps-tl-zeit kern-body kern-body--small kern-body--muted">' + sp( z.zeitraum ) + '</span>'
						+ '<div class="ps-tl-main"><div class="ps-tl-kopf"><span class="ps-num">' + pad( p.nr ) + '</span>' + badge( k, icon( b.icon_svg ) + label( b.label ) )
						+ '<' + h( 2 ) + ' class="kern-title ps-tl-titel">' + sp( p.titel ) + '</' + h( 2 ) + '><span class="kern-label kern-label--subtle ps-tl-cat">' + sp( e.label_zeitleiste || e.label ) + '</span></div>'
						+ ( z.notiz ? '<p class="kern-body kern-body--small ps-tl-notiz">' + sp( z.notiz ) + '</p>' : '' )
						+ '</div></li>';
				} ).join( '' ) + '</ol></li>';
			} ).join( '' ) + '</ol>';
		}

		/* Bereichsfarben als Variablen: hell am Wrapper, dunkel über die KERN-Theme-Schalter. */
		var hell = '', dunkel = '';
		Object.keys( bereiche ).forEach( function ( k ) {
			var f = bereiche[ k ].farben || {};
			[ [ 'area', '' ], [ 'on', '-on' ], [ 'fg', '-fg' ] ].forEach( function ( s ) {
				/* Nur Hex-Farben: der Wert steht roh im Stylesheet */
				if ( f.hell && RE_FARBE.test( f.hell[ s[ 0 ] ] ) ) { hell += '--ps-area-' + k + s[ 1 ] + ':' + f.hell[ s[ 0 ] ] + ';'; }
				if ( f.dunkel && RE_FARBE.test( f.dunkel[ s[ 0 ] ] ) ) { dunkel += '--ps-area-' + k + s[ 1 ] + ':' + f.dunkel[ s[ 0 ] ] + ';'; }
			} );
		} );
		/* Eine Regel je Eintrag, damit init() sie einzeln über insertRule() setzen kann */
		var regeln = sprachen.map( function ( s ) { return '.ps[data-lang="' + s + '"] [lang]:not([lang="' + s + '"]){display:none}'; } );
		/* Helle Werte im Stylesheet, nicht als style-Attribut: ein Inline-Stil würde die dunklen Regeln darunter überstimmen */
		regeln.push( '.ps{' + hell + '}' );
		if ( dunkel ) {
			regeln.push( '[data-kern-theme="dark"] .ps,.kern-dark .ps{' + dunkel + '}' );
			regeln.push( '@media (prefers-color-scheme:dark){:root:not([data-kern-theme="light"]):not(.kern-light) .ps{' + dunkel + '}}' );
		}
		/* Bereichsvariablen je Element über data-bereich statt über style-Attribute (Karte, Zeile, Badge, Filterknopf) */
		Object.keys( bereiche ).forEach( function ( k ) {
			regeln.push( '.ps [data-bereich="' + k + '"]{--ps-area:var(--ps-area-' + k + ');--ps-area-on:var(--ps-area-' + k + '-on);--ps-area-fg:var(--ps-area-' + k + '-fg)}' );
		} );

		var o = '<div class="ps kern-stack-lg" data-lang="' + esc( sprache ) + '" lang="' + esc( sprache ) + '"' + ( opt.sprache ? ' data-sprache-vorgabe="' + esc( opt.sprache ) + '"' : '' ) + ( opt.symbole === 'ja' || opt.symbole === 'nein' ? ' data-symbole="' + opt.symbole + '"' : '' ) + '>';
		/* Kopf */
		o += '<header class="ps-head kern-stack-sm">';
		/* Kopfzeile rechts: Symbolschalter (Option) und Sprachumschalter, beide so hoch wie Karten/Zeitlich (x-small) */
		var kopfzeile = '';
		if ( opt.symbolschalter ) {
			var ts = t.symbole || {}, an = opt.symbole === 'ja';
			// KERN-Checkbox (kern-form-check), weil das Kit keinen Schalter hat; der sichtbare Text ist das Label, das aria-label aus den Daten beschreibt genauer
			var symId = 'ps-symbole-' + ( ++zaehler );
			kopfzeile += '<div class="kern-form-check ps-symbolschalter"><input type="checkbox" class="kern-form-check__checkbox" id="' + symId + '"' + ( an ? ' checked' : '' ) + aria( ts.aria ) + '><label class="kern-label" for="' + symId + '">' + sp( ts.label || { de: 'Symbole', en: 'Icons' } ) + '</label></div>';
		}
		if ( sprachen.length > 1 && opt.sprachumschalter !== false ) {
			kopfzeile += '<div class="kern-btn-wrapper ps-seg ps-lang" role="group"' + aria( ( t.sprache || {} ).aria ) + '>' + sprachen.map( function ( s ) {
				return btn( 'data-lang="' + esc( s ) + '"', '<span class="kern-label">' + esc( s.toUpperCase() ) + '</span>', s === sprache, '', 'x-small' );
			} ).join( '' ) + '</div>';
		}
		if ( kopfzeile ) { o += '<div class="ps-kopfzeile">' + kopfzeile + '</div>'; }
		o += '<' + h( 0 ) + ' class="kern-heading-x-large">' + sp( ( t.kopf || {} ).titel ) + '</' + h( 0 ) + '>';
		if ( t.kopf && t.kopf.einleitung ) { o += '<div class="kern-body kern-body--large ps-lede">' + sp( t.kopf.einleitung, true, true ) + '</div>'; }
		o += '</header>';

		/* Filter und Ansicht */
		var view = '';
		if ( opt.zeitleiste !== false ) {
			var ta = t.ansicht || {};
			// Icons: Lucide „grid-2x2“ und „chart-gantt“ (ISC)
			view = '<div class="ps-view" role="group"' + aria( ta.aria ) + '><div class="kern-btn-wrapper ps-seg">'
				+ btn( 'data-view="karten"', icon( '<path d="M12 3v18"/><path d="M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/>' ) + label( ta.karten || { de: 'Karten', en: 'Cards' } ), ! zeitleiste, '', 'x-small' )
				+ btn( 'data-view="zeitleiste"', icon( '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>' ) + label( ta.zeitleiste || { de: 'Zeitlich', en: 'Timeline' } ), zeitleiste, '', 'x-small' )
				+ '</div></div>';
		}
		var tf = t.filter || {}, alle = ( d.filter_alle || {} ).bereich || { label: { de: 'Alle', en: 'All' } };
		var bl = tf.bereich_label || { de: 'Bereich', en: 'Area' };
		/* Beide Filterblöcke liegen in KERN-Details: auf Desktop offen ohne Kopf, auf Mobil aufklappbar mit dem Kopf als Beschriftung */
		o += '<div class="ps-controls">' + view;
		o += '<details class="kern-details ps-panel ps-panel-bereich" open><summary class="kern-details__header"><span class="kern-label">' + sp( bl ) + '</span></summary><div class="kern-details__body">';
		o += '<div class="ps-filter ps-filter-bereich" role="group"' + aria( tf.aria_bereich ) + '>';
		if ( tf.bereich_label ) { o += '<span class="kern-label ps-filter-label">' + sp( tf.bereich_label ) + '</span>'; }
		o += '<div class="kern-btn-wrapper">' + filterBtn( 'all', alle.label, alle.icon_svg, vorBereich === 'all', projekte.length );
		Object.keys( bereiche ).forEach( function ( k ) {
			o += filterBtn( k, bereiche[ k ].label, bereiche[ k ].icon_svg, k === vorBereich, projekte.filter( function ( p ) { return p.bereich === k; } ).length, true );
		} );
		o += '</div></div></div></details>';
		var chips = Object.keys( einordnungen ).filter( function ( k ) { return einordnungen[ k ].als_filter_chip; } );
		if ( chips.length && opt.einordnungsfilter !== false ) {
			var sichtbar = projekte.filter( function ( p ) { return vorBereich === 'all' || p.bereich === vorBereich; } );
			var fl = tf.einordnung_label || { de: 'Filter', en: 'Filter' };
			o += '<details class="kern-details ps-panel ps-panel-cat"><summary class="kern-details__header"><span class="kern-label">' + sp( fl ) + '</span></summary><div class="kern-details__body">';
			o += '<div class="ps-filter ps-filter-cat" role="group"' + aria( tf.aria_einordnung ) + '>';
			if ( tf.einordnung_label ) { o += '<span class="kern-label ps-filter-label">' + sp( tf.einordnung_label ) + '</span>'; }
			o += '<div class="kern-btn-wrapper">' + filterBtn( 'all', alle.label, '', true, sichtbar.length );
			chips.forEach( function ( k ) {
				o += filterBtn( k, einordnungen[ k ].label, '', false, sichtbar.filter( function ( p ) { return p.einordnung === k; } ).length );
			} );
			o += '</div></div></div></details>';
		}
		o += '<hr class="kern-divider kern-divider--decorative ps-controls-divider"></div>';

		/* Karten, Leerzustand, Zeitleiste, Live-Region, Fuß */
		o += '<div class="ps-grid kern-row"' + ( zeitleiste ? ' hidden' : '' ) + '>' + projekte.map( karte ).join( '' ) + '</div>';
		var tl = t.leerzustand || {};
		o += '<div class="ps-empty kern-stack-sm" role="status" hidden><p class="kern-body">' + sp( tl.meldung || { de: 'Kein Projekt passt zu dieser Auswahl.', en: 'No project matches this selection.' } ) + '</p>'
			+ '<button type="button" class="kern-btn kern-btn--tertiary ps-reset">' + label( tl.zuruecksetzen || { de: 'Filter zurücksetzen', en: 'Reset filters' } ) + '</button></div>';
		if ( opt.zeitleiste !== false ) {
			o += '<section class="ps-timeline"' + aria( ( t.zeitleiste || {} ).aria ) + ( zeitleiste ? '' : ' hidden' ) + '>' + zeitleisteHtml() + '</section>';
		}
		o += '<p class="kern-sr-only ps-live" aria-live="polite"' + sprachen.map( function ( s ) { return ' data-text-' + esc( s ) + '="' + esc( ( opt.live || LIVE )[ s ] || LIVE.de ) + '" data-leer-' + esc( s ) + '="' + esc( ( opt.leer || LEER )[ s ] || LEER.de ) + '"'; } ).join( '' ) + '></p>';
		var u = objekt( objekt( t.fuss ).ueber );
		if ( u.ueberschrift ) {
			o += '<details class="kern-details ps-ueber"><summary class="kern-details__header"><span class="kern-title">' + sp( u.ueberschrift ) + '</span></summary><div class="kern-details__body">'
				+ ( Array.isArray( u.absaetze ) ? u.absaetze : [] ).map( function ( a ) { return '<p class="kern-body">' + sp( a, true ) + '</p>'; } ).join( '' ) + '</div></details>';
		}
		return { html: o + '</div>', regeln: regeln };
	}
	function render( d, opt ) {
		var t = bauen( d, opt );
		return '<style>' + t.regeln.join( '' ) + '</style>' + t.html;
	}

	/* Interaktion: Sprache, Filter, Ansicht, URL-Hash. Ohne Skript bleibt die gerenderte Liste vollständig lesbar. */
	function interaktion( root ) {
		var q = function ( s ) { return root.querySelector( s ); };
		var qa = function ( s ) { return Array.prototype.slice.call( root.querySelectorAll( s ) ); };
		var store = {
			get: function ( k ) { try { return localStorage.getItem( k ); } catch ( e ) { return null; } },
			set: function ( k, v ) { try { localStorage.setItem( k, v ); } catch ( e ) { /* privater Modus */ } }
		};
		function setPressed( b, on ) {
			b.setAttribute( 'aria-pressed', on ? 'true' : 'false' );
			b.classList.toggle( 'kern-btn--primary', on );
			b.classList.toggle( 'kern-btn--secondary', ! on );
		}

		var langBtns = qa( '.ps-lang button' ), live = q( '.ps-live' );
		var sprachen = langBtns.map( function ( b ) { return b.getAttribute( 'data-lang' ); } );
		var lang = root.getAttribute( 'data-lang' );
		function setLang( l ) {
			lang = l;
			root.setAttribute( 'data-lang', l );
			root.setAttribute( 'lang', l );
			langBtns.forEach( function ( b ) { setPressed( b, b.getAttribute( 'data-lang' ) === l ); } );
			qa( '[data-aria-' + l + ']' ).forEach( function ( el ) { el.setAttribute( 'aria-label', el.getAttribute( 'data-aria-' + l ) ); } );
		}
		if ( sprachen.length > 1 ) {
			/* Reihenfolge: gespeicherte Wahl, ausdrückliche Vorgabe (data-sprache), Browsersprache, erste Sprache des Pakets */
			var gespeichert = store.get( 'ps-lang' ), browser = ( navigator.language || '' ).slice( 0, 2 ).toLowerCase(), vorgabe = root.getAttribute( 'data-sprache-vorgabe' );
			setLang( sprachen.indexOf( gespeichert ) >= 0 ? gespeichert : ( sprachen.indexOf( vorgabe ) >= 0 ? vorgabe : ( sprachen.indexOf( browser ) >= 0 ? browser : lang ) ) );
			langBtns.forEach( function ( b ) { b.addEventListener( 'click', function () { setLang( b.getAttribute( 'data-lang' ) ); store.set( 'ps-lang', lang ); } ); } );
		}

		/* Symbolschalter: Cover mit großem Symbol; ausdrückliche Vorgabe (data-symbole) vor gespeicherter Wahl, sonst aus */
		var sw = q( '.ps-symbolschalter input' );
		if ( sw ) {
			var vorgabeSym = root.getAttribute( 'data-symbole' ), symAn = vorgabeSym ? vorgabeSym === 'ja' : store.get( 'ps-symbole' ) === 'ja';
			function setzeSymbole( v ) {
				symAn = v;
				if ( v ) { root.setAttribute( 'data-symbole', 'ja' ); } else { root.removeAttribute( 'data-symbole' ); }
				sw.checked = v;
			}
			setzeSymbole( symAn );
			sw.addEventListener( 'change', function () { setzeSymbole( sw.checked ); store.set( 'ps-symbole', symAn ? 'ja' : 'nein' ); } );
		}

		var catBtns = qa( '.ps-filter-cat [data-filter]' ), berBtns = qa( '.ps-filter-bereich [data-filter]' );
		var grid = q( '.ps-grid' ), timeline = q( '.ps-timeline' ), empty = q( '.ps-empty' );
		var cards = qa( '.ps-card' ), rows = qa( '.ps-row' ), years = qa( '.ps-year' );
		var vCards = q( '[data-view="karten"]' ), vTl = q( '[data-view="zeitleiste"]' );
		function pressed( btns ) {
			var p = btns.filter( function ( b ) { return b.getAttribute( 'aria-pressed' ) === 'true'; } )[ 0 ];
			return p ? p.getAttribute( 'data-filter' ) : 'all';
		}
		function press( btns, v ) {
			var found = btns.some( function ( b ) { return b.getAttribute( 'data-filter' ) === v; } );
			if ( ! found ) { v = 'all'; }
			btns.forEach( function ( b ) { setPressed( b, b.getAttribute( 'data-filter' ) === v ); } );
			return v;
		}
		var activeCat = pressed( catBtns ), activeBer = pressed( berBtns );
		var cardsView = ! ( timeline && ! timeline.hidden );
		function matches( el ) {
			return ( activeCat === 'all' || el.getAttribute( 'data-cat' ) === activeCat ) && ( activeBer === 'all' || el.getAttribute( 'data-bereich' ) === activeBer );
		}
		function counts() {
			function setN( b, pred ) { var el = b.querySelector( '.ps-count' ); if ( el ) { el.textContent = '(' + cards.filter( pred ).length + ')'; } }
			catBtns.forEach( function ( b ) { var v = b.getAttribute( 'data-filter' ); setN( b, function ( c ) { return ( v === 'all' || c.getAttribute( 'data-cat' ) === v ) && ( activeBer === 'all' || c.getAttribute( 'data-bereich' ) === activeBer ); } ); } );
			berBtns.forEach( function ( b ) { var v = b.getAttribute( 'data-filter' ); setN( b, function ( c ) { return ( v === 'all' || c.getAttribute( 'data-bereich' ) === v ) && ( activeCat === 'all' || c.getAttribute( 'data-cat' ) === activeCat ); } ); } );
		}
		function apply( announce ) {
			var n = 0;
			cards.forEach( function ( c ) { var m = matches( c ); ( c.parentElement.classList.contains( 'ps-col' ) ? c.parentElement : c ).classList.toggle( 'is-hidden', ! m ); if ( m ) { n++; } } );
			rows.forEach( function ( r ) { r.classList.toggle( 'is-hidden', ! matches( r ) ); } );
			years.forEach( function ( y ) {
				var alle = Array.prototype.slice.call( y.querySelectorAll( '.ps-row' ) ), sichtbar = alle.filter( function ( r ) { return ! r.classList.contains( 'is-hidden' ); } );
				y.hidden = ! sichtbar.length;
				/* Erste sichtbare Zeile je Jahr: dort beginnt die Linie erst am Punkt */
				alle.forEach( function ( r ) { r.classList.remove( 'ps-row--erste', 'ps-row--letzte' ); } );
				if ( sichtbar.length ) { sichtbar[ 0 ].classList.add( 'ps-row--erste' ); sichtbar[ sichtbar.length - 1 ].classList.add( 'ps-row--letzte' ); }
			} );
			counts();
			var none = n === 0;
			if ( empty ) { empty.hidden = ! none; }
			if ( grid ) { grid.hidden = none || ! cardsView; }
			if ( timeline ) { timeline.hidden = none || cardsView; }
			if ( live && announce ) { live.textContent = none ? live.getAttribute( 'data-leer-' + lang ) : ( live.getAttribute( 'data-text-' + lang ) || '' ).replace( '%d', n ); }
		}
		function setView( c ) {
			cardsView = c;
			if ( vCards ) { setPressed( vCards, c ); }
			if ( vTl ) { setPressed( vTl, ! c ); }
		}
		function syncURL() {
			var p = new URLSearchParams();
			if ( activeBer !== 'all' ) { p.set( 'bereich', activeBer ); }
			if ( activeCat !== 'all' ) { p.set( 'filter', activeCat ); }
			if ( ! cardsView ) { p.set( 'ansicht', 'zeitleiste' ); }
			var qs = p.toString();
			try { history.replaceState( null, '', qs ? '#' + qs : location.pathname + location.search ); } catch ( e ) { location.hash = qs; }
		}
		function readState() {
			var raw = ( location.hash || '' ).replace( /^#/, '' );
			if ( ! raw ) { return; }
			var p = new URLSearchParams( raw );
			activeBer = press( berBtns, p.get( 'bereich' ) || 'all' );
			activeCat = press( catBtns, p.get( 'filter' ) || 'all' );
			setView( ( p.get( 'ansicht' ) || '' ) !== 'zeitleiste' );
		}
		if ( vCards ) { vCards.addEventListener( 'click', function () { setView( true ); apply( false ); syncURL(); } ); }
		if ( vTl ) { vTl.addEventListener( 'click', function () { setView( false ); apply( false ); syncURL(); } ); }
		catBtns.forEach( function ( b ) { b.addEventListener( 'click', function () { activeCat = press( catBtns, b.getAttribute( 'data-filter' ) ); apply( true ); syncURL(); } ); } );
		berBtns.forEach( function ( b ) { b.addEventListener( 'click', function () { activeBer = press( berBtns, b.getAttribute( 'data-filter' ) ); apply( true ); syncURL(); } ); } );
		var reset = q( '.ps-reset' );
		if ( reset ) { reset.addEventListener( 'click', function () { activeBer = press( berBtns, 'all' ); activeCat = press( catBtns, 'all' ); apply( true ); syncURL(); } ); }
		/* Einordnungsfilter: auf Desktop immer offen (Kopf per CSS ausgeblendet), auf Mobil einklappbar */
		var panels = qa( '.ps-panel' ), mq = window.matchMedia ? window.matchMedia( '(min-width: 48rem)' ) : null;
		function panelLage( e ) {
			panels.forEach( function ( panel ) {
				panel.open = e.matches || panel.classList.contains( 'ps-panel-bereich' );
				panel.classList.toggle( 'ps-panel--offen', e.matches );
			} );
		}
		if ( mq ) { panelLage( mq ); if ( mq.addEventListener ) { mq.addEventListener( 'change', panelLage ); } }
		window.addEventListener( 'hashchange', function () { readState(); apply( true ); } );
		readState();
		apply( false );
	}

	/* Startet alle [data-projektschau]: Daten aus data-src (fetch) oder aus einem <script type="application/json"> darin. */
	function init( el ) {
		var opt = {
			ansicht: el.getAttribute( 'data-ansicht' ) || 'karten',
			bereich: el.getAttribute( 'data-bereich' ) || 'all',
			ebene: parseInt( el.getAttribute( 'data-ebene' ) || '2', 10 ),
			sprache: el.getAttribute( 'data-sprache' ) || '',
			zeitleiste: el.getAttribute( 'data-zeitleiste' ) !== 'nein',
			einordnungsfilter: el.getAttribute( 'data-einordnungsfilter' ) !== 'nein',
			sprachumschalter: el.getAttribute( 'data-sprachumschalter' ) !== 'nein',
			symbole: el.getAttribute( 'data-symbole' ),
			symbolschalter: el.getAttribute( 'data-symbolschalter' ) === 'ja'
		};
		function zeichne( d ) {
			var t = bauen( d, opt );
			el.innerHTML = t.html;
			/* Regeln über das CSSOM statt als Text: ein konstruiertes Stylesheet läuft auch mit style-src ohne 'unsafe-inline'
			 * (ein <style>-Element wäre dort blockiert). Ältere Browser bekommen das <style>-Element. */
			if ( 'adoptedStyleSheets' in document && typeof CSSStyleSheet === 'function' ) {
				var sh = new CSSStyleSheet();
				t.regeln.forEach( function ( r ) { try { sh.insertRule( r, sh.cssRules.length ); } catch ( e ) { console.error( 'Projektschau: Regel abgelehnt.', r, e ); } } );
				document.adoptedStyleSheets = document.adoptedStyleSheets.concat( sh );
			} else {
				var st = document.createElement( 'style' );
				st.textContent = t.regeln.join( '' );
				el.insertBefore( st, el.firstChild );
			}
			interaktion( el.querySelector( '.ps' ) );
		}
		var inline = el.querySelector( 'script[type="application/json"]' ), src = el.getAttribute( 'data-src' );
		if ( inline ) { zeichne( JSON.parse( inline.textContent ) ); }
		else if ( src ) {
			fetch( src ).then( function ( r ) { if ( ! r.ok ) { throw new Error( r.status + ' ' + src ); } return r.json(); } ).then( zeichne ).catch( function ( e ) { el.textContent = ''; console.error( 'Projektschau: Daten nicht geladen.', e ); } );
		}
	}

	window.Projektschau = { render: render, init: init };
	document.querySelectorAll( '[data-projektschau]' ).forEach( init );
} )();
