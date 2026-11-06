/**
 * OAuth 1.0a request signing (HMAC-SHA1). X issues these four credentials for
 * the developer's own account and they do not expire, which is what a site
 * that posts from a headless run needs; its OAuth 2 user tokens last two hours.
 */

export interface Credentials {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/** RFC 3986 percent-encoding, which OAuth requires and encodeURIComponent stops short of. */
export const percent = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * The `Authorization` header for one request. Query parameters are signed;
 * a JSON body is not, as OAuth signs only form-encoded bodies.
 */
export async function authorization(method: string, url: string, c: Credentials, nonce: string, timestamp: number): Promise<string> {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: c.token,
    oauth_version: "1.0",
  };
  const params = [...u.searchParams, ...Object.entries(oauth)].map(([k, v]) => [percent(k), percent(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), percent(`${u.origin}${u.pathname}`), percent(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(`${percent(c.consumerSecret)}&${percent(c.tokenSecret)}`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(base)))));
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${percent(k)}="${percent(v)}"`).join(", ");
}
