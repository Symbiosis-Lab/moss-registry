# Testing a real OnionPress publish (macOS)

You are checking one thing end to end: that a person with moss and nothing else
can turn on OnionPress, let moss download and start it, publish a folder, and
then open the resulting `.onion` address in Tor Browser and see their site.

Everything below happens inside moss. There is no repo to clone, no container
to poke at, no config file to hand-edit. moss downloads OnionPress, installs it
under your home directory, starts it, provisions it, and publishes to it. The
OnionPress menu bar app that appears afterwards is the vendor's own app — moss
launches it so its Start/Stop/Logs/Settings controls are reachable, and then
stays out of it.

What you should see, in order:

1. **Settings → Channels** lists an **OnionPress** tile (only with preview
   features on).
2. Adding it downloads ~167 MB, then spends several minutes on the first
   bring-up (Colima VM + container image pulls). Progress shows on the tile and
   in the window's progress hairline.
3. **Settings → Deployment** now offers OnionPress as the host for the open
   folder.
4. **Publish** opens a one-time wizard: pick an onion name (checked live against
   the OnionHeaven registry), then it deploys, then a success screen with the
   address and a **View on Tor** button.
5. That address opens in Tor Browser and shows your site.
6. Publishing again is silent — no wizard, same address.

This flow is the checklist in
[moss#918](https://github.com/Symbiosis-Lab/moss/issues/918) ("Full journey to
verify"). It cannot run in CI: it needs macOS, Docker/Colima, a real Tor
circuit, and a real Tor Browser.

## Before you start

- **macOS.** The whole stack path is macOS-only by construction — every other
  platform gets `OnionPress stack install is only supported on macOS`.
- **~600 MB free disk**, checked up front (`REQUIRED_DISK_BYTES` in
  `src-tauri/src/system/stack_install.rs`), plus room for container images.
- **No Docker Desktop needed.** OnionPress.app bundles its own `colima` and
  `limactl` and runs its containers in its own VM under `~/.onionpress/colima`.
  Docker Desktop being installed or not is irrelevant to it.
- **Tor Browser**, for step 5. moss opens `.onion` addresses with
  `/Applications/Tor Browser.app` or `~/Applications/Tor Browser.app` if either
  exists, and otherwise hands the URL to the OS opener rather than erroring —
  which is worth testing both ways (moss#917 item 1).
- **A folder that has been built once.** Publish packs `.moss/build/current`;
  preview or build the folder first.
- **Time.** A cold first bring-up pulls the container images and can take
  several minutes. moss allows an hour before it gives up.

Known environment issue, from #918: if the Mac slept while the stack was
running, the containers can lose internet egress entirely (the Docker
bridge/NAT state for `onionpress-network` doesn't recover), while the Colima VM
itself is fine. Restart Colima — or the whole stack — before blaming moss.
Reinstalling from scratch is safe: `onionpress_uninstall()` removes only moss's
staged app under `~/.moss/stacks/onionpress` and **never touches
`~/.onionpress`**, which holds the WordPress database, the uploads, and the Tor
hidden-service keys that own your `.onion` address. Those are unrecoverable if
deleted, and they survive an uninstall/reinstall, so the same address comes
back.

## 1. Turn on preview features

OnionPress is in `PREVIEW_PLUGINS` (`src-tauri/src/plugins/registry.rs`), so
its catalog tile is **hidden until you turn on preview features**. This is the
most common "where is it?" moment — everyone has the bytes (the plugin is
bundled in the binary), only the row is hidden.

**App Settings → Preview features → on.** Then open Settings → Channels; the
OnionPress tile is there.

An already-installed copy stays visible either way, so turning the switch back
off does not hide a stack you already added.

## 2. Add OnionPress from the Channels tab

Click the tile. Two things happen: the plugin itself installs instantly (it is
bundled), and because OnionPress is a stack channel, moss kicks off
`install_channel_stack` — the machine-scoped acquisition in
`src-tauri/src/system/stack_install.rs`:

1. Reads the pinned release from `plugins/onionpress/stack-manifest.json`
   (currently **v2.4.107-moss.7**) and downloads that DMG, resumably, verifying
   its **sha256** before using it. A hash mismatch means no install.
2. Mounts the image, copies `OnionPress.app` to a scratch sibling path, and
   renames it into `~/.moss/stacks/onionpress/OnionPress.app` — so the app path
   only ever holds a complete bundle.
3. Asserts the staged app carries no `com.apple.quarantine`.
4. Runs `OnionPress.app/Contents/MacOS/onionpress start` (the long one), then
   provisions: `setup` installs WordPress with credentials moss mints, and
   `provision-post-install --managed` installs the bundled mu-plugins including
   the moss receiver.
5. Judges success by **capability, not exit code** — the stack is ready when
   its receiver answers `GET /status` on one of ports 8080, 18080, 28080,
   38080, 48080. `onionpress start` legitimately exits 1 when Tor hasn't
   bootstrapped within its own 120 s wait, which is normal on a slow or
   censored link and does not stop a publish (publishing is loopback-only).
6. Opens the OnionPress menu bar app.

Progress is a machine-scoped detached task, so it survives closing the
Settings window and shows on the window hairline.

Re-launching moss re-discovers an installed stack from disk (the staged `.app`
exists) and probes `/status`; it never re-downloads or auto-restarts on launch.

To test against a DMG you built yourself, set `MOSS_ONIONPRESS_LOCAL_DMG` to
its path — moss then skips the download and the sha256 check entirely.

## 3. Choose OnionPress as the folder's host

**Settings → Deployment → the Host row.** The row is fed by
`get_deploy_targets` (moss hosting plus every installed deploy-capable plugin)
and choosing one calls `set_deploy_target`, which pins `[hooks] deploy` and
`deploy_method` for that folder.

Do **not** hand-edit `[hooks] deploy = "onionpress"` in `.moss/config.toml`.
That was the old prototype recipe; the Host row is the supported path and is
what the Publish button reads.

## 4. Publish

Click **Publish**. The first publish for an OnionPress folder — "OnionPress
selected, no onion `site_url` persisted yet" — opens `OnionPressPublishModal`
(`frontend/app/workflows/deploy/onionpress-publish-modal.ts`) instead of
deploying silently:

- **Probe.** "Looking for OnionPress…". If the receiver isn't answering, moss
  starts and provisions the stack itself ("Starting OnionPress…") rather than
  telling you to go do it. Only a stack that isn't installed at all produces
  the "Install OnionPress to publish" empty state.
- **Name.** "Choose your onion name" — 5–40 characters, letters/digits/`.`/`-`/`_`,
  not all digits, not starting or ending with punctuation. Typing checks
  availability against the OnionHeaven registry live (debounced), with a
  suggestion button. Two honest non-answers are distinguished here: "OnionPress
  is still connecting to Tor (N%)" and "Couldn't check this name right now —
  you can still claim it" (registry unreachable ≠ name taken). You can also
  **Publish without a name**, which deploys to the raw `.onion` address.
- The claimed name and URL are persisted **before** the deploy, so the rebuild
  bakes the onion URL into canonical/OG/RSS rather than localhost.
- **Deploying.** The plugin (`plugins/onionpress/src/main.ts`) discovers the
  receiver, tars `.moss/build/current`, `POST`s it to `/generation`, then
  `POST /commit` flips the generation symlink atomically and returns the onion
  URL. Wire details: the fork's `docs/static-publish-protocol.md`.
- **Confirming reachability.** Because the moss.7 receiver reports
  `receiver_version: "1.1"` and an `onion_reachable` tri-state, the plugin then
  polls `/status` for up to ~20 s (2 s interval) waiting for the receiver's own
  dual-probe Tor check to resolve before reporting the deploy complete. This is
  moss#917: `/commit` alone only proves the local containers flipped a symlink,
  and a visitor arriving before the hidden-service descriptor is published gets
  OnionHeaven's takeover/Wayback response instead of the site.
  - resolves `true` → "Published to your onion site."
  - resolves `false` → "Published, but not reachable on Tor yet — the address
    should resolve within a minute." Not a failure.
  - never resolves within the window → today's copy, with no claim either way.
- **Success screen** shows the name, the address, copy, and **View on Tor**.

## 5. Verify for real

The point of the pass is that moss's local health check is *not* the evidence.

1. Click **View on Tor** (or copy the address into Tor Browser yourself). A
   `.onion` only resolves over Tor.
2. Confirm the site is yours and that inner links work, not just the root.
3. View source: canonical/OG/RSS URLs should carry
   `http://<address>.onion/`, not `localhost`.
4. `wp-admin` / `wp-json` on the OnionPress side still work — the receiver
   serves the moss generation ahead of WordPress but excludes the `wp-*` paths.
5. Test the no-Tor-Browser fallback too: with Tor Browser not installed, moss
   should hand the address to the OS opener rather than erroring.

## 6. Publish again

Change something, Publish again. There should be **no wizard** — the folder has
a `site_url` now, so it is an ordinary plugin deploy: a silent re-push to the
same address, ending in the same toast. The address must not change.

## What v2.4.107-moss.7 actually contains

- **The 1.1 receiver ships and works.** It is a PHP mu-plugin injected into the
  WordPress container at provision time, so it needs no image rebuild. This is
  what gives you `receiver_version: "1.1"`, `onion_reachable` and
  `onion_http_code`.
- **Tor bridge / pluggable-transport support is live**, as of moss.7. See the
  next section. In moss.6 it was not: the fix's two halves are split across the
  app and the container image, and only the app half shipped.
- **The `tor.log` first-run permission fix is live** for the same reason — it is
  an entrypoint change, and moss.7 is the first release running the fork's own
  image.

## Publishing from a censored network

If Tor cannot reach the network directly — the case behind the GFW — the stack
never bootstraps and no amount of retrying in moss will help. Configure a
bridge instead.

Bridges are configured in `~/.onionpress/config`, which the **OnionPress app
owns**; moss does not read or write it. Set two keys:

```
TOR_CLIENT_TRANSPORT_PLUGIN=snowflake
TOR_BRIDGE_LINES=snowflake 192.0.2.3:80 2B280B23E1107BB62ABFC40DDCC8824814F80A72 fingerprint=… url=https://…/ fronts=… ice=stun:…
```

The file ships with Tor Browser's current snowflake bridges already written out
in full, commented — uncomment those two lines rather than typing them. Then
**restart the stack**: `/etc/tor/torrc` is regenerated from scratch on every
start, and Tor cannot pick up a new `ClientTransportPlugin` from a running
process, so a config edit does nothing until the container restarts.

Three things that cost time if you don't know them:

- **Everything after the fingerprint is load-bearing.** A snowflake line
  trimmed to address + fingerprint looks plausible and silently never
  bootstraps: `url=` is the broker it registers with, `fronts=` are the domains
  it hides that request behind, `ice=` are the STUN servers it needs to find a
  proxy.
- **These values rotate.** If a line that used to work stops, re-copy it from
  Tor Browser's `about:preferences#connection` before concluding the network
  changed.
- **For obfs4 instead of snowflake**, bridges are per-user and can't be shipped
  in the template. Get them from <https://bridges.torproject.org/>, or — when
  that is blocked too — by emailing `bridges@torproject.org` from a Gmail or
  Riseup address with `get transport obfs4` in the body.

To confirm the transport is actually in use rather than assumed:

OnionPress runs its containers in its own Colima VM, not in Docker Desktop, so
a bare `docker` will fail with `dial unix /var/run/docker.sock: no such file` —
it is talking to a daemon that isn't there. Use the bundled binary and point it
at OnionPress's own socket:

```bash
OP_DOCKER=/Applications/OnionPress.app/Contents/Resources/bin/docker
export DOCKER_HOST="unix://$HOME/.onionpress/colima/default/docker.sock"

"$OP_DOCKER" exec onionpress-tor grep -E "UseBridges|ClientTransportPlugin|^Bridge" /etc/tor/torrc
"$OP_DOCKER" exec onionpress-tor grep -i "bootstrapped" /var/log/tor/tor.log | tail -3
```

(moss stages its own copy under `~/.moss/stacks/`; use that path instead if you
installed through Channels rather than from a DMG.)

An empty first command means the settings never reached the container. Check
the spelling in `~/.onionpress/config` — unknown keys are ignored silently —
and confirm the launcher is new enough to read them at all: the bridge settings
were implemented in the Python start path first and were not read by the bash
launcher moss drives until the fix in `guoliu/onionpress#3`. Against an
older bundle the config is correct and simply never arrives.

## Troubleshooting

Messages below are the real ones the code emits.

**"Start OnionPress first, then Publish again."** (toast) / "No running
OnionPress found." — the plugin probed all five loopback ports and nothing
answered `/status`. Inside the publish wizard moss tries to recover on its own
first; this toast is what a plain Publish shows.

**"Install OnionPress to publish"** vs **"Couldn't start OnionPress"** — the
first means nothing is staged (add it from Channels). The second means moss
started an installed stack and the receiver still didn't come up; check the
OnionPress logs under `~/.onionpress`.

**"OnionPress start exited with … — <ERROR line>"** — moss appends the last
`ERROR` the OnionPress CLI logged *during this run* (the log is appended across
runs, so it is deliberately scoped). Common causes: image pulls blocked, or the
post-sleep egress break above.

**"OnionPress is running but its publish receiver is not answering"** — the
containers are up but provisioning didn't land the mu-plugin. Retrying the
install re-runs `setup` + `provision-post-install`, both idempotent.

**"OnionPress is running, but moss could not save the WordPress admin password
…"** — the one provisioning failure moss refuses to excuse even when the
receiver answers, because a healthy receiver hides it and the lockout is
permanent. Free disk space / fix permissions on `~/.moss/stacks` and start
again. The credentials live at `~/.moss/stacks/.credentials/`, outside the
stack dir so an uninstall can't take them.

**"staged app carries com.apple.quarantine (would trip Gatekeeper)"** — the DMG
did not come down moss's programmatic path. Expected only if you tampered with
the staged bundle.

**"hdiutil attach failed …"**, **"OnionPress.app not found in DMG at …"**,
**"hdiutil attached … without mounting a volume"** — image problems. moss
keeps the cached DMG on failure so a retry costs no network; delete
`~/.moss/stacks/.cache/onionpress-<version>.dmg` to force a re-download.

**"stack-manifest.json has a placeholder sha256 …"** — you are on a checkout
whose manifest isn't pinned to a real release. Use
`MOSS_ONIONPRESS_LOCAL_DMG`.

**"OnionPress quit (…) but its publish receiver is still answering"** — an
uninstall or bundle replacement refused to proceed rather than strand a running
stack with no binary to stop it. Stop it from the menu bar app, then retry.

**"Could not package the built site. Run a build first, then Publish again."**
— `.moss/build/current` is missing or unreadable. Preview or build the folder.

**"Upload to OnionPress failed …" / "OnionPress commit failed …"** — the
receiver rejected the generation. Its guards are path traversal in the tar and
top-level names colliding with WordPress reserved paths; see
the fork's `docs/static-publish-protocol.md`.

**"OnionPress is not installed (… missing) — install the stack first"** — the
onionname CLI commands (suggest/check/register) resolve the staged binary and
found nothing.

**Name step stuck on "Checking…" or claiming everything is taken** — Tor can't
reach the registry. moss re-expands that case ("unknown", not "taken") when the
CLI reports a transport failure, and shows the bootstrap percentage while Tor
is still connecting.

## Related documents

- Plugin **development** (sideloading a locally-built `dist/` into a vault by
  symlink, so the bundled-plugin updater leaves it alone) is a different task
  and still works exactly as described in
  [`plugins/onionpress/SIDELOAD.md`](../../../plugins/onionpress/SIDELOAD.md).
  Testers do not sideload; the plugin is bundled and `src-tauri/build.rs`
  rebuilds it from source whenever `dist/` is older than `src/`.
- Wire contract between plugin and receiver:
  the fork's `docs/static-publish-protocol.md`.
- Design history: [2026-07-21-onionpress-full-integration](../../archive/2026-07-21-onionpress-full-integration.md)
  (roadmap and locked decisions) and
  [2026-07-31-onionpress-reachability-verification-design](../../archive/2026-07-31-onionpress-reachability-verification-design.md)
  (why "Published" waits for a reachability answer).
