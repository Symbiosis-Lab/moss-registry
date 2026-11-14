/**
 * An article handed to a network that has an editor and no posting API: the
 * action panel shows the article with one button, which copies it as
 * formatted text and opens the network's own editor in the same panel. The
 * author pastes, checks and publishes there.
 *
 * Shared by the channel plugins in this repository, so it takes moss-api's
 * calls as an argument (this file has no node_modules of its own). It moves
 * into moss-api when moss fills the editor itself or a plugin outside this
 * repository needs it.
 */

export interface Article {
  title: string;
  html: string;
}

/** The answer for a copy that waits in an editor: moss records where, and nothing to paste by hand. */
export interface HandoffResult {
  success: boolean;
  message?: string;
  copy: { handoff?: { text: string; open_url: string }; refused?: { cause: "content"; message: string } };
}

export const handoffResult = (url: string): HandoffResult => ({ success: true, copy: { handoff: { text: "", open_url: url } } });

/** A copy the author listed by its address under `syndicated:`: moss keeps the address as its id, and no API takes one. */
export const listedByAddress = (previous: { id: string; url: string }) => previous.id === previous.url;

/** A refusal said before anything is sent. */
export const refusedContent = (message: string): HandoffResult => ({ success: false, message, copy: { refused: { cause: "content", message } } });

export interface Editor {
  /** The network's name, as the button says it. */
  name: string;
  /** The page where the author writes a new article. */
  url: string;
}

export interface PanelApi {
  openBrowser(url: string): Promise<{ closed: Promise<unknown> }>;
  openBrowserWithHtml(html: string): Promise<void>;
  onEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void>;
  startTask(
    label: string,
    options: { hook: "syndicate"; trigger: "manual_one"; hasProgress: false; cancellable: false },
  ): Promise<{ awaiting(directive: string, venue: string): Promise<void>; succeeded(): Promise<void> }>;
}

/**
 * Waits while the author works in the panel. moss stops a hook that has said
 * nothing for a minute, unless it has said it is waiting for a person.
 */
async function whileAuthor(api: Pick<PanelApi, "startTask">, does: string, network: string, work: () => Promise<unknown>): Promise<void> {
  const task = await api.startTask(`Publish on ${network}`, { hook: "syndicate", trigger: "manual_one", hasProgress: false, cancellable: false });
  try {
    await task.awaiting(does, network);
    await work();
  } finally {
    await task.succeeded();
  }
}

/** The page tells the plugin the article is on the clipboard. */
export const COPIED = "article-handoff:copied";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The hand-off page. This page can call moss, so the article never becomes
 * part of it: its HTML travels as a JSON string, is parsed by `DOMParser`
 * (which runs no script and loads nothing) and is shown in a frame whose
 * sandbox allows nothing.
 */
export function handoffPage(article: Article, editor: Editor): string {
  const data = JSON.stringify({ title: article.title, html: article.html, event: COPIED }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(editor.name)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; display: flex; flex-direction: column; height: 100vh; font: 15px/1.5 system-ui, sans-serif; }
  header { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  h1 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid currentColor; background: none; color: inherit; cursor: pointer; white-space: nowrap; }
  button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
  iframe { flex: 1; border: 0; width: 100%; background: Canvas; }
</style>
</head>
<body>
<header><h1>${escape(article.title)}</h1><button id="copy" type="button">Copy and open ${escape(editor.name)}</button></header>
<iframe id="article" sandbox="" title="${escape(article.title)}"></iframe>
<script>
(function () {
  var data = ${data};
  var body = new DOMParser().parseFromString(data.html, "text/html").body;
  // Nothing an article needs, and each can send the frame elsewhere.
  body.querySelectorAll("meta, base, link").forEach(function (e) { e.remove(); });
  // The editor has its own title field.
  var first = body.firstElementChild;
  if (first && first.tagName === "H1" && first.textContent.trim() === data.title.trim()) first.remove();
  var html = body.innerHTML;
  // For an editor that takes only plain text: one paragraph per block.
  var text = Array.from(body.children, function (e) { return e.textContent.trim(); }).filter(Boolean).join("\\n\\n");
  // The frame is for reading: its links go nowhere, and its look is not copied.
  document.getElementById("article").srcdoc = "<meta http-equiv=\\"Content-Security-Policy\\" content=\\"default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'\\"><style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:40em;margin:16px auto;padding:0 16px}img,video{max-width:100%;height:auto}a{pointer-events:none}</style>" + html;
  var button = document.getElementById("copy");
  button.addEventListener("click", function () {
    document.addEventListener("copy", function (e) {
      e.clipboardData.setData("text/html", html);
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    }, { once: true });
    // WebKit copies only with something selected.
    var selection = getSelection();
    var range = document.createRange();
    range.selectNodeContents(button);
    selection.removeAllRanges();
    selection.addRange(range);
    var copied = document.execCommand("copy");
    selection.removeAllRanges();
    if (copied) window.mossApi.emit(data.event);
    else button.textContent = "Could not copy";
  });
})();
</script>
</body>
</html>`;
}

/**
 * Show the article, and once the author has copied it, open the editor.
 * Resolves when the panel closes, whichever page it was on.
 */
export async function handOffArticle(api: PanelApi, article: Article, editor: Editor): Promise<void> {
  let settle = (_copied: boolean) => {};
  const copied = new Promise<boolean>((resolve) => (settle = resolve));
  // A close heard before this page is up is the panel before it.
  let shown = false;
  const stops: (() => void)[] = [];
  try {
    stops.push(await api.onEvent(COPIED, () => settle(true)));
    stops.push(await api.onEvent("browser-closed", () => shown && settle(false)));
    await api.openBrowserWithHtml(handoffPage(article, editor));
    shown = true;
    await whileAuthor(api, "paste and publish the article", editor.name, async () => (await copied) && (await api.openBrowser(editor.url)).closed);
  } finally {
    for (const stop of stops) stop();
  }
}

/**
 * A channel's answer to an article: handed to the editor, the copy waits
 * there. A job that says article and carries none is refused, so it never
 * reaches the channel's way of sending a post.
 */
export async function writeArticle(api: PanelApi, article: Article | null | undefined, editor: Editor): Promise<HandoffResult> {
  if (!article) return refusedContent("the copy has no article");
  await ifPanel(editor.name, handOffArticle(api, article, editor));
  return handoffResult(editor.url);
}

/**
 * One panel at a time: the next copy waits for this one to close. The panel
 * opens first, so a run without the app starts no task.
 */
export async function openAndWait(api: Pick<PanelApi, "openBrowser" | "startTask">, does: string, network: string, url: string): Promise<void> {
  const { closed } = await api.openBrowser(url);
  await whileAuthor(api, does, network, () => closed);
}

/**
 * Without the app there is no panel, and the address is the hand-off.
 * moss-api cannot tell that from a panel failing in the app, so log it.
 */
export async function ifPanel(network: string, shown: Promise<void>): Promise<void> {
  await shown.catch((e) => console.warn(`${network}: not shown in the panel: ${e instanceof Error ? e.message : e}`));
}
