import { describe, it, expect } from "vitest";
import { auditAdjustment, fidelity } from "../src/index.js";

describe("adjustment audit", () => {
  it("passes a correctly sized reinvested dividend", () => {
    // $0.25 dividend, 30% withheld, $175 reference: ×(1 + 0.175/175) = ×1.001
    const r = auditAdjustment({ oldMultiplier: 1.0, newMultiplier: 1.001, dividend: 0.25, refPrice: 175 });
    expect(r.kind).toBe("dividend");
    expect(r.verdict).toBe("ok");
    expect(Math.abs(r.errorBps!)).toBeLessThan(1);
  });
  it("flags a dividend applied without withholding", () => {
    const r = auditAdjustment({ oldMultiplier: 1.0, newMultiplier: 1 + 0.25 / 175, dividend: 0.25, refPrice: 175 });
    expect(r.verdict).toBe("off");
    expect(r.errorBps!).toBeGreaterThan(4);
  });
  it("recognises splits and reverse splits", () => {
    expect(auditAdjustment({ oldMultiplier: 1.002, newMultiplier: 10.02 }).note).toMatch(/10-for-1/);
    const rev = auditAdjustment({ oldMultiplier: 1, newMultiplier: 0.1 });
    expect(rev.kind).toBe("reverse_split");
    expect(rev.note).toMatch(/1-for-10/);
  });
  it("marks a dividend-like change unverifiable without a declared dividend", () => {
    expect(auditAdjustment({ oldMultiplier: 1, newMultiplier: 1.003 }).verdict).toBe("unverifiable");
  });
  it("ranks issuers by fidelity", () => {
    const f = fidelity([
      { issuer: "bstocks", r: auditAdjustment({ oldMultiplier: 1, newMultiplier: 1.001, dividend: 0.25, refPrice: 175 }) },
      { issuer: "ondo", r: auditAdjustment({ oldMultiplier: 1, newMultiplier: 1.0014, dividend: 0.25, refPrice: 175 }) },
    ]);
    expect(f.get("bstocks")!.meanAbsErrorBps).toBeLessThan(f.get("ondo")!.meanAbsErrorBps);
    expect(f.get("ondo")!.offEvents).toBe(1);
  });
});
