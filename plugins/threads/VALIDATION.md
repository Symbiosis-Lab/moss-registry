# T1 validation receipt

Prepared on 2026-11-11 in the host-owned `codex-worker-0f3bd3176c844bf29ec605ba3794db8e` worktree, branch `codex-job/codex-worker-0f3bd3176c844bf29ec605ba3794db8e`, pinned base `e1633eaa36c9d7af364bf57b77ffa8e9aca2323e`. No base switch, source checkout edits, delegation, external writes or real Threads requests. State: partial; the host redirect boundary and the complete registry test gate remain unresolved.

All Node commands use Node 24.22.0 first on PATH. `TMPDIR` is the host-supplied `.codex-worker-tmp-za5x2ptz` inside this worktree; `npm_config_cache` is its `npm-cache` child. The existing npm content cache was copied there before `npm ci --offline --ignore-scripts --no-audit --no-fund --prefix plugins/threads`, which exited 0. No online dependency install occurred. Threads needs no harness dependencies.

## Commands and results

Commands below run from the worktree root unless a directory is stated.

| Command | Result |
|---|---|
| `npm test --prefix plugins/threads` | Exit 0, 60 tests. Includes actual loopback redirect tests as well as stubbed API lifecycle tests. |
| `npm run build --prefix plugins/threads` | Exit 0, readable IIFE and manifest produced in `plugins/threads/dist/`. |
| `node .github/scripts/validate-plugin.mjs plugins/threads` | Exit 0, `threads: OK`. |
| `plugins/threads/node_modules/.bin/tsc --project plugins/threads/tsconfig.json --noEmit` | Exit 0. |
| `git diff --cached --check` | Exit 0. |
| In `harness/syndication`: `node run.mjs --moss /Users/guoliu/repos/Symbiosis-Lab/moss/.worktrees/_cf-cli/target/release/moss-cli --only threads` | Exit 0, `all passed`; no failed check lines. Real moss planned and posted short/thread/teaser, preserved all text, chained replies, attached teaser URLs, wrote syndicated URLs, posted nothing on repeat/edit/recovery, and asked about the edited uncertain copy. |
| `node --test .github/scripts/build-index.test.mjs .github/scripts/pack-native-plugin.test.mjs .github/scripts/publish-workflow.test.mjs .github/scripts/registry-rules.test.mjs .github/scripts/validate-revocations.test.mjs .github/scripts/verify-published.test.mjs` | Exit 1; 105 passed, one failed. Build-index tests passed. Exact failure below. |

The registry failure was `with a signing key both documents are signed`, at `.github/scripts/publish-workflow.test.mjs:86`, with `AssertionError [ERR_ASSERTION]: mktemp: mkstemp failed on /var/folders/kf/f0g8y5gn3r1gycy9dxp9n4t40000gp/T/tmp.l4bohWjnw1: Operation not permitted` and `1 !== 0`. This permission denial was not retried by any route. The full output remains in the supplied scratch directory's `registry-tests.log`.

The exact full gate `node --test .github/scripts/*.test.mjs` was omitted: `validate-plugin.test.mjs:213–217` creates a Git repository, commits, and tags, which this worker's policy disallows. The other test files were run as the explicit subset above. No Cargo command ran: no host Cargo lease was available. No Rust rebuild or live API tests were attempted.

## Guard ablations

The reproducible runner is [scripts/ablate.mjs](scripts/ablate.mjs). It edits one guard, runs `npm test -- -t "<test-name pattern>"` from `plugins/threads`, restores the original source bytes by writing them back, and reruns the focused test. Every completed mutation exited 1 with an assertion failure; every restored run exited 0. The exact focused commands and output are retained in the scratch directory's `threads-ablations.log`.

Executed invocations:

```sh
node plugins/threads/scripts/ablate.mjs
node plugins/threads/scripts/ablate.mjs id deletion-confirmation readiness bounded-wait unknown-status failed-status length rollback-order rollback publish-uncertainty later-transport unique-recovery reply-chain extra-replies permalink
node plugins/threads/scripts/ablate.mjs rollback-failure bounded-absence lookup-uncertainty
```

The first invocation demonstrated origin-before-secret, missing token, redirects and error redaction, then stopped because the missing-id test matched `id` inside `did` in a later error. That surviving mutation exposed a weak assertion; the test now requires `did not return a valid id`. Sources were restored before the correction. The second invocation demonstrated the corrected id guard and the next fourteen guards. The third demonstrated failed-rollback uncertainty, bounded-list absence uncertainty, and post-publication lookup uncertainty. In total, 22 distinct guard mutations failed as intended and passed after restoration. No listed mutation remains unrun. Native moss redirect enforcement could not be ablated or repaired in this copy.

## Evidence and handoff limits

The API evidence is the supplied Meta research dated 2026-11-11, linked with its uncertainties in [README](README.md). It was not independently re-fetched here. Read-only moss contract evidence came from `origin/develop` at `29b3b79c8f2830c568972f4b9fc8603066232f95`: `syndication/channel.rs`, `shape.rs`, `job.rs`, `send.rs` and `docs/proposals/syndication/README.md`. Notably, code shapes a backlink on the final thread part; the plugin preserves all parts rather than reconstructing them.

Host evidence: `engine/fetch_shim.rs:85` reads only method/body/headers; `plugins/runtime/download.rs:483` constructs the regular proxy agent; `system/proxy.rs:32–35` enables five redirects. Thus Node redirect tests prove the plugin requests redirect refusal, not that the native host honors it. Host changes require the owning moss flow; this worker did not edit that repository.

Thermo self-review: the production modules separate transport/refusal policy, copy operations, and shared job types. No existing production flow gained a Threads-specific branch. The release-derived catalog needs no second list of plugin identities; only source documentation and the auto-discovered provider were added. The two publish-stage catch blocks deliberately distinguish unpublished containers from possibly-published posts; merging them behind a mutable stage flag would hide the retry boundary. Independent review is still required.

All build/test processes were joined. The harness awaited its provider's `server.close` and removed its scratch site; redirect tests awaited each owned server handle. No `target/` was created. The supplied `CARGO_TARGET_DIR` is `.codex-worker-target` in this copy; it was never created or used and is absent, so no build target needed removal. Required `plugins/threads/dist/` deliverables are retained. The copied npm cache was removed after testing; evidence logs remain in the host-supplied scratch directory. No shared build directory was deleted.

Owner action: review/integrate the job branch, address native redirect enforcement, run the complete registry gate with its required access, and arrange a live test account run for provisional statuses/cadence, reply fields, Unicode/URL counting and developer/tester setup. The preview is not certified for live unattended use by these local checks.
