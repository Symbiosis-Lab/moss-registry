/**
 * OAuth 1.0a request signing (HMAC-SHA1), written out because moss's plugin
 * runtime has no Web Crypto. X issues these four credentials for the
 * developer's own account and they do not expire, which is what a site that
 * posts from a headless run needs; its OAuth 2 user tokens last two hours.
 */

export interface Credentials {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/** RFC 3986 percent-encoding, which OAuth requires and encodeURIComponent stops short of. */
export const percent = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function sha1(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array(((length + 8) >> 6) * 64 + 64);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // The bit length's high word stays zero: no post approaches 512 MB.
  view.setUint32(padded.length - 4, (length * 8) >>> 0);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30) >>> 0, a, t];
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha1(key) : key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 20);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha1(inner), 64);
  return sha1(outer);
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * The `Authorization` header for one request. Query parameters are signed;
 * a JSON body is not, as OAuth signs only form-encoded bodies.
 */
export function authorization(method: string, url: string, c: Credentials, nonce: string, timestamp: number): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: c.token,
    oauth_version: "1.0",
  };
  // moss's URL has `search` but no `searchParams`.
  const query = u.search.slice(1).split("&").filter(Boolean).map((kv) => kv.split("=").map(decodeURIComponent) as [string, string]);
  const params = [...query, ...Object.entries(oauth)].map(([k, v]) => [percent(k), percent(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), percent(`${u.origin}${u.pathname}`), percent(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const key = `${percent(c.consumerSecret)}&${percent(c.tokenSecret)}`;
  const enc = new TextEncoder();
  const signature = base64(hmacSha1(enc.encode(key), enc.encode(base)));
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${percent(k)}="${percent(v)}"`).join(", ");
}
