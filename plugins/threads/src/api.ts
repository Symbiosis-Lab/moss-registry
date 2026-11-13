import { getSecret } from "@symbiosis-lab/moss-api";
import type { Cause, CopyJob, CopyResult } from "./types";

export class Refusal extends Error {
  constructor(readonly cause: Cause, message: string) { super(message); }
}

export interface Account { api: string; token: string }
const API = "https://graph.threads.net";

export async function account(job: Pick<CopyJob, "config">): Promise<Account> {
  const api = String(job.config.api ?? API).replace(/\/+$/, "");
  // Compare the whole origin before asking the host for a secret.
  if (api !== API && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(api)) {
    throw new Refusal("auth", "Threads API must be https://graph.threads.net or an explicit 127.0.0.1 test server");
  }
  let token: string | null;
  try { token = await getSecret("access_token"); }
  catch { throw new Refusal("auth", "Threads access token could not be read"); }
  if (!token) throw new Refusal("auth", "Connect Threads with an access token first");
  return { api, token };
}

/** Only an explicit refusal makes a publish safe to retry. Never echo provider messages or transport errors containing credentials. */
export async function call(a: Account, method: string, path: string, body?: unknown): Promise<any> {
  let r: Response;
  try {
    r = await fetch(`${a.api}/v1.0${path}`, {
      method, redirect: "error",
      headers: { authorization: `Bearer ${a.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Threads request failed; its outcome may be uncertain"); }
  let data: any;
  try { data = JSON.parse(await r.text()); }
  catch { throw new Error("Threads returned an unreadable response"); }
  if (!r.ok) {
    const code = data?.error?.code;
    const message = `Threads API refused the request (HTTP ${r.status})`;
    if ([400, 401, 403, 422, 429].includes(r.status)) {
      const cause: Cause = r.status === 401 || r.status === 403 || code === 190 ? "auth"
        : r.status === 429 || [4, 17, 32, 613].includes(code) ? "rate" : "content";
      throw new Refusal(cause, message);
    }
    throw new Error(`Threads request did not confirm success (HTTP ${r.status})`);
  }
  if (data?.error) throw new Error("Threads returned an unexpected error envelope");
  return data;
}

export function refusal(e: unknown): CopyResult {
  const reason = e instanceof Refusal ? e : new Refusal("network", "Threads could not be reached before publication");
  return { success: false, message: reason.message, copy: { refused: { cause: reason.cause, message: reason.message } } };
}

export function id(data: any): string {
  if (typeof data?.id !== "string" || !/^\d+$/.test(data.id)) throw new Error("Threads did not return a valid id");
  return data.id;
}

export async function remove(a: Account, threadId: string): Promise<void> {
  const result = await call(a, "DELETE", `/${encodeURIComponent(threadId)}`);
  if (result?.success !== true) throw new Error("Threads did not confirm deletion");
}

/** Provisional cadence: publish only FINISHED; never guess what a new status means. */
export async function ready(a: Account, container: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await call(a, "GET", `/${container}?fields=status,error_message`);
    if (result?.status === "FINISHED") return;
    if (["ERROR", "EXPIRED"].includes(result?.status)) throw new Refusal("content", "Threads container failed or expired");
    if (result?.status !== "IN_PROGRESS") throw new Refusal("unknown", "Threads container readiness is unknown");
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Refusal("unknown", "Threads container was not ready within five checks");
}
