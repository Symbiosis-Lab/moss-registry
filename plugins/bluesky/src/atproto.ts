/**
 * The few AT Protocol calls a copy needs: a session from an app password,
 * and creating, reading and deleting `app.bsky.feed.post` records.
 */

export interface Session {
  service: string;
  did: string;
  handle: string;
  accessJwt: string;
}

export interface StrongRef {
  uri: string;
  cid: string;
}

/** An XRPC error, with the HTTP status that says what kind it was. */
export class XrpcError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function xrpc(service: string, method: string, init: { token?: string; body?: unknown; query?: Record<string, string> }): Promise<any> {
  const query = init.query ? "?" + Object.entries(init.query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
  const headers: Record<string, string> = {};
  if (init.token) headers["authorization"] = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const url = `${service.replace(/\/+$/, "")}/xrpc/${method}${query}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.body !== undefined ? "POST" : "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    // No answer at all (offline, refused, timed out): status 0, which a
    // refusal names as the network's fault.
    throw new XrpcError(0, "NetworkError", `could not reach ${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new XrpcError(response.status, data.error ?? "Error", data.message ?? `${method} answered ${response.status}`);
  }
  return data;
}

export async function createSession(service: string, identifier: string, password: string): Promise<Session> {
  const s = await xrpc(service, "com.atproto.server.createSession", { body: { identifier, password } });
  return { service, did: s.did, handle: s.handle, accessJwt: s.accessJwt };
}

const POST = "app.bsky.feed.post";

/** Create the record at `rkey`, or return the one already there. */
export async function putPost(session: Session, rkey: string, record: Record<string, unknown>): Promise<StrongRef> {
  try {
    const r = await xrpc(session.service, "com.atproto.repo.createRecord", {
      token: session.accessJwt,
      body: { repo: session.did, collection: POST, rkey, record },
    });
    return { uri: r.uri, cid: r.cid };
  } catch (e) {
    // A retry of a post that went out: the record key is taken by it.
    const existing = await getPost(session, rkey);
    if (existing) return existing;
    throw e;
  }
}

export async function getPost(session: Session, rkey: string): Promise<StrongRef | null> {
  try {
    const r = await xrpc(session.service, "com.atproto.repo.getRecord", {
      query: { repo: session.did, collection: POST, rkey },
    });
    return { uri: r.uri, cid: r.cid };
  } catch (e) {
    if (e instanceof XrpcError && (e.status === 400 || e.status === 404)) return null;
    throw e;
  }
}

export async function deletePost(session: Session, rkey: string): Promise<void> {
  await xrpc(session.service, "com.atproto.repo.deleteRecord", {
    token: session.accessJwt,
    body: { repo: session.did, collection: POST, rkey },
  });
}

const TID_CHARS = "234567abcdefghijklmnopqrstuvwxyz";

/**
 * A record key in the TID format posts use, the same for every send of one
 * part of one copy: derived from moss's idempotency key alone, which names
 * the post and channel and nothing an author can edit, so a retry lands on
 * the record the first send made. Its clock falls within 2024, a microsecond
 * apart per part, so every part of any thread has its own key.
 */
export function recordKey(idempotencyKey: string, part: number): string {
  const YEAR_MS = 366 * 86_400_000;
  const millis = Date.UTC(2024, 0, 1) + (parseInt(idempotencyKey.slice(0, 12), 16) % YEAR_MS);
  const micros = BigInt(millis) * 1000n + BigInt(parseInt(idempotencyKey.slice(12, 17), 16) % 1000) + BigInt(part);
  const clock = BigInt(parseInt(idempotencyKey.slice(17, 20), 16) % 1024);
  let value = (micros << 10n) | clock;
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = TID_CHARS[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

export function rkeyOf(uri: string): string {
  return uri.split("/").pop() ?? "";
}
