# ADR-050: moss owns the serving outcome; OnionPress keeps the work

**Status:** Accepted
**Date:** 2026-08-08

## The decision in one sentence

moss is responsible for the user's site actually being live, end to end — and
it delegates the work of keeping it live to OnionPress wherever OnionPress is
capable, intervening only once the stack has demonstrably failed to recover
itself.

This is **subsidiarity, not failover**. The distinction is the whole ADR:
responsibility never transfers, only the work does. moss does not "take over
when OnionPress fails"; moss was accountable the entire time, and hands the
work back down the moment the lower level can do it.

## The failure that forced it

A user publishing from behind the GFW got "Published, but not reachable on Tor
yet — the address should resolve within a minute." It never resolved. Their
laptop had slept; the Snowflake pluggable transport came back wedged; Tor still
reported bootstrap 100% from before the sleep, so nothing in the stack thought
anything was wrong. The site was down for as long as the machine stayed awake.

Everything about that is a boundary failure, not a bug in any one component:

- The stack could not tell it had stopped serving, because it was watching
  bootstrap state rather than serving state.
- moss knew nothing at all. It learned the state only when the user pressed
  Publish, and then reported a prediction it had no basis for.
- The user was left holding the diagnosis. Their words: *"the user should only
  need to right click and preview and publish a folder, no need to care about
  Snowflake wakes or not."*

The first half was fixed inside OnionPress (the watchdog's escalation ladder,
which restarts a wedged transport, then Tor, and marks itself degraded rather
than looping). This ADR is about the second half.

## What was rejected

**"moss is a fallback."** The obvious reading — OnionPress is responsible, moss
steps in when it fails — was explicitly corrected by the user:

> "moss plugin is the manager, but it respect the agency and boundary whenever
> onion press can; but moss plugin's job is to deliver the ultimate simplified
> user experience to the user."

A fallback design learns the state only after something has gone wrong, which
means it can never distinguish "the stack is three minutes into recovering"
from "the stack gave up an hour ago". Those need opposite responses.

**"moss should reach into the stack."** Driving containers, editing torrc, or
reading Tor's control port directly would let moss fix more — and would make
moss a second, worse implementation of a supervisor that already exists inside
the container with better information. It also puts moss's hands next to the
onion keys, which is the one thing that must never happen.

## The rules

1. **Awareness is unconditional.** moss observes the serving state while
   everything is healthy, not only after a failure and not only during a
   publish. Continuous and coarse: one loopback `/status` GET every five
   minutes in the steady state, tightening to 20 s around a publish, a `stat`
   when no stack is installed. Nothing schedules a wake.
2. **Intervention is not.** Every rung of OnionPress's own escalation ladder
   runs to completion first. Its ladder tops out at a Tor restart 420 s into an
   outage with a 300 s cooldown behind it, so moss's first move lands no
   earlier than 15 minutes in. Two supervisors restarting the same Tor is worse
   than either alone.
3. **Respecting the boundary means preferring OnionPress's own mechanisms, not
   abstaining.** When moss's turn does arrive, it acts through the verbs the
   stack already exposes — `onionpress start`, then `onionpress quit` +
   `start` — the same ones the user's menu bar app runs.
4. **moss mints no onion keys, on any path.** The user has published a vanity
   address; a recovery that produced a new one would break every link to their
   site, irreversibly. The recovery surface is a pure function
   (`recovery_argv`) pinned by a test.
5. **Silent by default.** The user publishes; the stack heals. Observations and
   recoveries are log lines. The only user-visible consequence is the one they
   asked for.
6. **moss stops pulling the lever, never stops watching.** After three
   moss-driven recoveries in three hours the site is not failing at something a
   restart fixes — it is a censored network or a dead bridge. moss keeps
   reporting the truthful verdict and stops restarting.
7. **Never restart the stack while a publish is moving bytes through it.** The
   suppression is a lease, not a flag, so a publish that dies without saying so
   cannot disable recovery for the rest of the session.

## What did NOT change

The menu bar app still owns ordinary lifecycle for the user: Start, Stop,
Restart, the status icon, View Logs, Settings, Backup/Restore, Check for
Updates, and its own uninstall. There is still no `onionpress_stop` command in
moss, for the reasons recorded next to `onionpress_uninstall`. moss owns
installing the stack, publishing to it, removing its own staged copy — and now
the serving outcome.

## Consequences

- moss carries a machine-scoped watch for the life of the process
  (`system/stack_serving.rs`). It is policy only; the mechanism stays in
  `system/stack_install.rs`, under the same `install_lock` and
  `run_bounded_with_tick` discipline as every other subprocess there.
- Publishing pre-flights the connection: readiness is established before any
  bytes move, and if it is already moss's turn, that turn is taken then rather
  than on the next tick. The pre-flight is best-effort and can refuse nothing —
  the plugin's own error remains the failure surface for a publish that
  genuinely cannot proceed.
- The publish surfaces stop predicting. One verdict, three values — live, not
  live, still checking — and "still checking" is never dressed up as either.
- The thresholds in `stack_serving.rs` are coupled to the ladder in
  OnionPress's `tor-watchdog.py`. If that ladder's timings change, moss's grace
  window has to move with them or moss starts racing it.

## Provenance

- `plugins/onionpress/docs/2026-08-08-onionpress-serving-supervision.md` — the live
  testing session behind this, with the `pmset` and watchdog-log evidence.
- OnionPress `app/Resources/docker/tor/tor-watchdog.py` — the escalation ladder
  whose timings this ADR's grace window is derived from.
