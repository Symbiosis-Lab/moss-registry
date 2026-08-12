# OnionPress serving supervision — two linked defects found behind the GFW

*2026-08-08. Provenance for [ADR-050](../decisions/ADR-050-moss-owns-the-serving-outcome.md).*

## What happened

A publish from behind the GFW reported "Published, but not reachable on Tor
yet — the address should resolve within a minute." The address never resolved.
The site stayed down until the stack was restarted by hand.

The machine had slept. On wake, the Snowflake pluggable transport came back
wedged: `snowflake-client` was alive as a process, so Tor's managed-proxy
supervision was satisfied, but it brokered no new connections. Tor still
reported `bootstrap 100%` — a stale reading from before the sleep — so nothing
in the stack considered itself unhealthy. Circuits could not be built and the
hidden-service descriptor could not be republished.

Ruled out during diagnosis:

- **Not VM networking.** The containers had connectivity throughout; the
  receiver answered `/status` the whole time.
- **Not STUN.** Snowflake's rendezvous succeeded on a manual re-run.
- **Not steady-state churn.** The outage began at wake and did not self-clear
  over hours of uptime.
- **Not something obfs4 would have avoided.** The wedge is in the managed-proxy
  lifecycle, not in the transport's protocol; Tor does not relaunch a dead or
  wedged managed proxy either way.

## The two defects

**1. The stack could not tell it had stopped serving.** Its watchdog watched
bootstrap state, which was stale and said 100%. Serving state — can a circuit
be built, and has the descriptor been republished since the last recovery — is
a different question, and it was the one nobody was asking.

**2. moss knew nothing at all.** It learned the state only when the user
pressed Publish, and then predicted a recovery it had no basis for. The
prediction is what made it worse than silence: a message that is reassuring and
wrong sends the user away to wait for something that will never happen.

## What was built

**OnionPress — an escalation ladder in `tor-watchdog.py`.** Rebased on a
`serving` predicate (bootstrapped AND a circuit established AND, if services
are published, a descriptor upload since the last recovery) instead of the
bootstrap percentage that the sleep had frozen. Rungs, with the reasoning for
each timing:

| At | Rung | Why there |
|---|---|---|
| 180 s un-served | restart the pluggable transport (kill the PT pids, `SIGNAL RELOAD`) | 120 s circuit wait + a 60 s descriptor window — past any healthy recovery, and this is the cheap rung |
| 420 s | restart Tor | after the PT rung plus its 300 s cooldown has had a full cycle to work |
| 3 Tor restarts in 1 h | mark degraded, stop climbing | past this it is the network, not the process |

Two things that had to be fixed to make the ladder real, both found by tests
rather than by reading:

- **The ladder could climb back down.** Once Tor had been restarted during an
  outage, a later tick could still select the transport rung. It now refuses
  any rung below one already run in the same outage.
- **The degraded rung was unreachable.** `SIGNAL HALT` ends the container,
  which kills the watchdog — so an in-memory restart counter reset on exactly
  the event it was counting. Restart stamps now persist in the state file and
  are reloaded; the `degraded` flag deliberately does not persist, so a
  restarted watchdog re-earns that verdict rather than inheriting it.

**The vanity address survives every rung.** No rung mints a key. Beyond that,
`discover_services` now refuses to re-add a published service whose key it
cannot read (`key_unreadable`), rather than falling through to `NEW:BEST` —
which is the one path that could have handed a published site a new address.

**moss — one verdict, and a supervisor.** The publish surfaces stopped
predicting: live, not live, or still checking, with "still checking" never
dressed up as either answer, and an OnionHeaven takeover reading as not live
(what it serves is a Wayback snapshot, not the site just published). The
success screen keeps asking while it is open and upgrades in place.

The durable answer is not the modal's, though — it is
`system/stack_serving.rs`, a machine-scoped watch that runs for the life of the
process. Its policy, and why moss waits 15 minutes before touching anything, is
ADR-050.

## The correction that shaped it

The first design described moss as a fallback for a failing stack. The user
corrected it, and the correction is load-bearing:

> "moss plugin is the manager, but it respect the agency and boundary whenever
> onion press can; but moss plugin's job is to deliver the ultimate simplified
> user experience to the user."

Subsidiarity, not failover: responsibility never transfers, only the work does.
That is what makes awareness unconditional (moss watches while everything is
healthy) while intervention stays conditional (OnionPress's ladder runs first,
every time).
