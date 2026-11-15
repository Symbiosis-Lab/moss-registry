export interface Part {
  text: string;
  links: string[];
}

export interface CopyJob {
  op: "publish" | "update" | "delete" | "find";
  channel: string;
  idempotency_key: string;
  post: { url: string; source_path: string; title: string; lang?: string | null; date?: string | null };
  form?: "short" | "thread" | "teaser";
  parts?: Part[];
  teaser?: { title: string; description: string; url: string; cover?: string | null } | null;
  previous?: { id: string; url: string; parts?: { id: string; url: string }[] } | null;
  config: Record<string, unknown>;
}

export type Cause = "auth" | "content" | "rate" | "network" | "unknown";

export interface CopyResult {
  success: boolean;
  message?: string;
  copy?: {
    id?: string;
    url?: string;
    parts?: { id: string; url: string }[];
    /** `copy_account`: the signed-in account's Threads user id. */
    account?: string;
    refused?: { cause: Cause; message?: string };
  } | null;
}
