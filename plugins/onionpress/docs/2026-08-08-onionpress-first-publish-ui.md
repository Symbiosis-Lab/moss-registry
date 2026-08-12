# OnionPress first publish — UI defects found in live testing, and what to do about the two modals

Date: 2026-08-08. Found while testing a real first publish from a censored
network. Five defects fixed here; one design question left open for a decision.

## What was wrong

### 1. The publish modal was inescapable

Clicking outside did nothing and the screen kept getting darker.

There was no singleton guard on modal instances. `deploy-handler` clears
`isDeploying` — its only re-entrancy gate — immediately *before* constructing
the modal, so every subsequent Publish click built a **new** instance. Each
`BaseModal` creates its own backdrop and appends it to `document.body`, so the
instances stacked: `rgba(0,0,0,0.5)` compounding to 0.75, then 0.875. A
light-dismiss click closed only the topmost, which reads as "clicking outside
doesn't work".

The latch and the geometry were both fine and were not touched. The fix is one
instance per modal **class** in `BaseModal`, keyed by constructor so a
delete-confirm can still legitimately stack over settings. `FirstPublishModal`
had the identical clear-then-construct shape and is covered by the same guard.

One subtlety worth keeping: the guard defers to the incumbent only if its
backdrop `isConnected`. An instance whose DOM was torn out from under it still
reports `_isOpen`, and deferring to that zombie would make the modal
permanently unopenable.

### 2. The name field started empty

Now prefilled from the folder — specifically from the backend's
`derive_site_id_from_root` (via `get_hosting_environment`), **not** a
client-side basename split.

This is the caveat `first-publish-modal.ts:363` warns about, and it matters
because claiming a name is irreversible. Using the backend's own answer means
moss cannot propose one name here and a different one via `moss deploy` for the
same folder. It is also the same source seta uses at its priority 3.

`onionpressNameSuggest` was **not** the right source: it picks random words
from a bundled list (`onionnames_client.py`) and knows nothing about the
folder, so it cannot be a prefill.

The prefill is a draft, never a claim — it is validated locally first (a folder
like `ab` yields a legal site id but an illegal onion name) and the availability
check still has to come back free before Claim enables.

### 3. Claim and Skip were bare siblings

They now sit in a `first-publish-cta-cluster`, the pairing the success step and
seta's first-publish already use — not a third pattern.

### 4. Modal and toast collided on first publish

The toast source was **not** `deploy-handler.ts:815` (that block is in the
failure branch). It is the onionpress **plugin**, which toasts on every deploy.

Every toast the plugin's deploy raises now carries a shared `onionpress-deploy`
id, and the modal calls the existing `suppressFeedbackToast` seam while it is
open — the same mechanism the article-send card already uses. Steady-state
publishes, with no modal open, toast exactly as before.

### 5. The success copy was wrong, not just wordy

This is the finding worth remembering.

**OnionHeaven has nothing to do with onion names.** Per `onionheaven.py` it is
the failover system: when an instance's `.onion` goes offline it takes over the
address and serves 302s to the Wayback Machine. It does not resolve names.

**No browser extension resolves names either.** The OnionPress extension exists
(`extension/manifest.json`, native-messaging host `press.onion.onionpress`) but
it only SOCKS-routes `.onion` hosts through Tor. It contains no name lookup.

Names resolve **server-side**, in `onionpress-directory.php` on OnionHome: a
registered name is a single path segment — `onionpress.org/<name>` on clearnet,
and the same path on OnionHome's own `.onion`, which 302s to the site.

So the old caption — "Your name — opens in browsers with the OnionHeaven
extension" — was wrong on both counts, and wrong in the direction that costs the
user something: it implied the name was the *harder* identifier needing special
software, when it is in fact the **more** shareable one, openable in any
ordinary browser. "Full address" was wrong for the reason the brief identified:
it implies the name is a short form of the address. They are independent
identifiers with different resolution paths.

Both rows now show a copyable value and a caption carrying the only distinction
that matters to a user — who can open it:

```
onionpress.org/<name>     Your onion name — opens in any browser
<addr>.onion              Your onion address — needs Tor Browser
```

The redundant subline ("Reachable on the Tor network", which restated the
title) is gone; the not-yet-reachable warning (moss#917) remains, and is now
created and removed on demand rather than swapped in place.

The settings Address row shares these strings, so it was changed to match —
otherwise the new copy would have been false there.

On terminology: "onion address" and "onion service" are the Tor Project's
current terms ("hidden service" is deprecated), and "onion name" is established
usage for a human-readable alias. A registered name carries no suffix.

## The open question: consolidating the two modals

`onionpress-publish-modal.ts` (1005 lines) and `first-publish-modal.ts` (652)
are siblings by an explicit prior decision — the OnionPress modal's header calls
itself "a deliberate SIBLING of FirstPublishModal (not a generalization): the
moss seta path must stay untouched."

That decision should not be overturned silently, but the evidence has moved:
defect 1 was present in **both** files in the same shape. That is exactly the
duplication cost the decision was accepting, and it reached a user.

Note that defect 1 has now been fixed **without** consolidating anything — the
guard went into `BaseModal`, which both already extend. That is the shape of the
recommendation below.

### The divergences are real, not accidental

- **Dismissal policy.** seta: every phase dismissable, *including* `publishing`,
  with a documented rationale (a locked modal locks the whole shell behind an
  `inset: 0` scrim for minutes; the publish outlives the surface and routes its
  result to a toast). Onion: `deploying` and mid-claim are inert, because a
  claim burns a name in a global registry and the success screen was the only
  place the claimed name appeared. These are opposite answers, and **seta's is
  the better UX** — but the onion side's reason is not nothing.
- **Name minting.** Server-minted (seta) vs suggest-then-check against a global
  registry (onion). Genuinely different flows.
- **Email verify.** seta has a whole leg; onion has none.

### Options

1. **Full generalization** — one modal, parameterized. Rejected: the phase
   machines differ (`probe → empty → name → deploying → success` vs
   `resolving → email → verify → site → publishing → success`), and the seta
   side carries a live-morph form (`publish-form.ts`, 748 lines) with no onion
   equivalent. The parameterization would be larger than the duplication.

2. **Shared base with two thin subclasses.** Tempting and wrong for now: it
   forces a single answer to the dismissal question, which is the one place the
   two genuinely disagree — and forcing it is how a subclass acquires a flag
   whose two values are the two old classes.

3. **Extract only what is genuinely common — recommended.** Three things, in
   descending confidence:
   - **The instance guard.** Already done, in `BaseModal`. This alone closes the
     defect that motivated the question.
   - **The action-row / CTA-cluster layout.** Already shared via
     `first-publish-cta-cluster`; the onion name step now uses it too.
   - **The dismissal policy.** Worth converging — on seta's answer — but as its
     own change with its own reasoning, because it needs the onion side's
     "claim in flight" case answered first (probably: let it dismiss, and route
     the claim result to a toast, exactly as seta does). Not bundled here.

   What stays separate: the phase machines, the name-minting flows, the email
   leg. Those are the parts that differ because the products differ.

**Recommendation: option 3.** It has already removed the duplication that
actually bit, and it leaves the two flows free to differ where they genuinely
do. Revisit a shared base only if a *third* publish target appears — that is
when the second copy stops being duplication and starts being a pattern.
