/**
 * Weighted progress estimation for monotonic 0-100% progress reporting.
 *
 * Each phase has a weight proportional to its typical duration.
 * `overallProgress()` computes a single 0-100 value that increases
 * monotonically across phase boundaries, eliminating the oscillation
 * caused by per-phase (current/total) resets.
 *
 * Design decision: Weights are tuned from observed runtime characteristics.
 * downloading_media and fetching_social dominate because they involve
 * network I/O per article. Authentication and fetching are fast API calls.
 */

const PHASE_WEIGHTS = [
  { name: "authentication", weight: 5 },
  { name: "fetching_articles", weight: 5 },
  { name: "fetching_drafts", weight: 3 },
  { name: "fetching_collections", weight: 2 },
  { name: "fetching_profile", weight: 2 },
  { name: "syncing", weight: 13 },
  { name: "downloading_media", weight: 35 },
  { name: "rewriting_links", weight: 5 },
  { name: "fetching_social", weight: 25 },
  { name: "complete", weight: 2 },
] as const;

const TOTAL_WEIGHT = PHASE_WEIGHTS.reduce((s, p) => s + p.weight, 0);

/**
 * Map sub-phase names to their parent phase.
 * sync.ts reports granular sub-phases (syncing_homepage, syncing_collections,
 * syncing_articles, syncing_drafts) that all fall within the "syncing" weight band.
 */
const SUB_PHASE_MAP: Record<string, string> = {
  syncing_homepage: "syncing",
  syncing_collections: "syncing",
  syncing_articles: "syncing",
  syncing_drafts: "syncing",
};

/**
 * Sink for import sub-phase progress. Shaped to match the old `reportProgress`
 * call sites — `current`/`total` are an absolute 0-100 overall value (as
 * returned by {@link overallProgress}) over `total = 100`. The wired reporter
 * (in `main.ts`) converts that to the unified task's 0-1 fraction and forwards
 * it to `task.progress()`. Threaded into the long sub-phases (media download,
 * per-item sync) so the import hairline advances THROUGH them instead of
 * stalling — replacing the legacy SDK `reportProgress` path, which the progress
 * panel drops for the `process` hook.
 */
export type ProgressReporter = (
  phase: string,
  current: number,
  total: number,
  message?: string,
) => void;

/**
 * Compute overall progress (0-100) given current phase and progress within it.
 *
 * @param phase - Current phase name (must match a PHASE_WEIGHTS entry or SUB_PHASE_MAP key)
 * @param current - Current item within the phase
 * @param total - Total items in the phase
 * @returns Integer 0-100 representing overall progress
 */
export function overallProgress(phase: string, current: number, total: number): number {
  // Resolve sub-phases to their parent
  const resolvedPhase = SUB_PHASE_MAP[phase] ?? phase;

  let done = 0;
  let found = false;

  for (const p of PHASE_WEIGHTS) {
    if (p.name === resolvedPhase) {
      done += p.weight * (total > 0 ? Math.min(current / total, 1) : 0);
      found = true;
      break;
    }
    done += p.weight;
  }

  // Unknown phase: return 0 to stay safe (monotonicity preserved since
  // the caller should only use known phases)
  if (!found) {
    return 0;
  }

  return Math.round((done / TOTAL_WEIGHT) * 100);
}
