/**
 * Parity: was each multiplier change the right size?
 *
 * Cash dividend reinvested through the multiplier:
 *   new / old = 1 + dividend × (1 − withholding) / reference price
 * where the reference price is the underlying's close before the ex-date.
 * Split N-for-M: new / old = N / M.
 */
export type AdjustmentKind = "dividend" | "split" | "reverse_split" | "unknown";

export interface AuditInput {
  oldMultiplier: number;
  newMultiplier: number;
  /** Cash dividend per share, if one was declared for this event. */
  dividend?: number;
  /** Close of the underlying before the ex-date. */
  refPrice?: number;
  /** Withholding applied before reinvestment. Issuers document 30% for non-treaty holders. */
  withholding?: number;
}

export interface AuditResult {
  kind: AdjustmentKind;
  actualRatio: number;
  expectedRatio?: number;
  /** Signed error in basis points of the multiplier: actual vs expected. */
  errorBps?: number;
  /** Signed error as a share of the adjustment itself (0.43 = the change was 43% too large). */
  errorOfAdjustment?: number;
  verdict: "ok" | "off" | "unverifiable";
  note: string;
}

const COMMON_SPLITS = [2, 3, 4, 5, 10, 20, 1.5].flatMap((r) => [r, 1 / r]);

function nearestSplit(ratio: number): number | undefined {
  return COMMON_SPLITS.find((s) => Math.abs(ratio / s - 1) < 0.001);
}

/**
 * Tolerance as a share of the adjustment: covers rounding, the exact reference close used, and fees.
 * A dividend applied without withholding is ~43% too large; one applied twice is 100% too large.
 */
export const AUDIT_TOLERANCE = 0.05;

export function auditAdjustment(a: AuditInput): AuditResult {
  const actual = a.newMultiplier / a.oldMultiplier;
  const split = nearestSplit(actual);
  if (split) {
    const kind = split > 1 ? "split" : "reverse_split";
    return { kind, actualRatio: actual, expectedRatio: split, errorBps: (actual / split - 1) * 10_000, verdict: "ok", note: `${kind} ${split > 1 ? `${split}-for-1` : `1-for-${Math.round(1 / split)}`}` };
  }
  if (actual > 1 && actual < 1.1) {
    if (a.dividend === undefined || !a.refPrice) {
      return { kind: "dividend", actualRatio: actual, verdict: "unverifiable", note: "looks like a reinvested dividend; no declared dividend or reference price to check against" };
    }
    const w = a.withholding ?? 0.3;
    const expected = 1 + (a.dividend * (1 - w)) / a.refPrice;
    const err = (actual / expected - 1) * 10_000;
    const ofAdj = (actual - 1) / (expected - 1) - 1;
    return {
      kind: "dividend", actualRatio: actual, expectedRatio: expected, errorBps: err, errorOfAdjustment: ofAdj,
      verdict: Math.abs(ofAdj) <= AUDIT_TOLERANCE ? "ok" : "off",
      note: `dividend ${a.dividend} at ${a.refPrice}, ${(w * 100).toFixed(0)}% withheld: expected ×${expected.toFixed(6)}, got ×${actual.toFixed(6)}`,
    };
  }
  return { kind: "unknown", actualRatio: actual, verdict: "unverifiable", note: `unexplained change ×${actual.toFixed(6)}` };
}

/** Per-issuer fidelity: mean absolute audit error across verifiable events. Lower is more faithful. */
export function fidelity(results: { issuer: string; r: AuditResult }[]): Map<string, { events: number; offEvents: number; meanAbsErrorBps: number }> {
  const out = new Map<string, { events: number; offEvents: number; meanAbsErrorBps: number }>();
  for (const { issuer, r } of results) {
    if (r.errorBps === undefined) continue;
    const cur = out.get(issuer) ?? { events: 0, offEvents: 0, meanAbsErrorBps: 0 };
    cur.meanAbsErrorBps = (cur.meanAbsErrorBps * cur.events + Math.abs(r.errorBps)) / (cur.events + 1);
    cur.events++; if (r.verdict === "off") cur.offEvents++;
    out.set(issuer, cur);
  }
  return out;
}
