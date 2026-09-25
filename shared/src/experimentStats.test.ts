import { describe, expect, it } from "vitest";
import {
  betaPosterior,
  compareToControl,
  expectedLoss,
  probabilityBBeatsA,
  relativeLift,
  RISK_THRESHOLD,
} from "./experimentStats";

const post = (conversions: number, units: number) => betaPosterior({ units, conversions });

describe("probabilityBBeatsA", () => {
  it("matches the analytic Beta(2,1) vs Beta(1,1) result of 2/3", () => {
    expect(probabilityBBeatsA({ alpha: 1, beta: 1 }, { alpha: 2, beta: 1 })).toBeCloseTo(2 / 3, 12);
  });

  it("is 0.5 for identical arms", () => {
    expect(probabilityBBeatsA(post(12, 80), post(12, 80))).toBeCloseTo(0.5, 10);
  });

  it("is complementary when the arms are swapped", () => {
    const a = post(3, 20);
    const b = post(8, 20);
    expect(probabilityBBeatsA(a, b) + probabilityBBeatsA(b, a)).toBeCloseTo(1, 10);
  });

  // Reference values from numerical integration of ∫ f_B(x) F_A(x) dx.
  it.each([
    [10, 100, 15, 100, 0.853284],
    [3, 20, 8, 20, 0.957253],
    [50, 1000, 65, 1000, 0.92448],
    [1000, 10000, 1100, 10000, 0.989457],
  ])("matches integration for %i/%i vs %i/%i", (ca, na, cb, nb, expected) => {
    expect(probabilityBBeatsA(post(ca, na), post(cb, nb))).toBeCloseTo(expected, 5);
  });

  it("uses a normal approximation that still matches integration for large counts", () => {
    expect(probabilityBBeatsA(post(6000, 60000), post(6200, 60000))).toBeCloseTo(0.971958, 3);
  });
});

describe("relativeLift", () => {
  it("centres on the posterior-mean lift and brackets it", () => {
    const { lift, interval } = relativeLift(post(100, 1000), post(120, 1000));
    expect(lift).toBeCloseTo(121 / 101 - 1, 10);
    expect(interval[0]).toBeLessThan(lift);
    expect(interval[1]).toBeGreaterThan(lift);
    expect(interval[0]).toBeLessThan(0);
  });

  it("narrows as the sample grows", () => {
    const small = relativeLift(post(10, 100), post(12, 100)).interval;
    const large = relativeLift(post(1000, 10000), post(1200, 10000)).interval;
    expect(large[1] - large[0]).toBeLessThan((small[1] - small[0]) / 5);
    expect(large[0]).toBeGreaterThan(0);
  });
});

describe("expectedLoss", () => {
  it("differs between the arms by exactly the difference in means", () => {
    const a = post(40, 400);
    const b = post(52, 400);
    const { chooseA, chooseB } = expectedLoss(a, b);
    const meanDiff = b.alpha / (b.alpha + b.beta) - a.alpha / (a.alpha + a.beta);
    expect(chooseA - chooseB).toBeCloseTo(meanDiff, 12);
    expect(chooseB).toBeLessThan(chooseA);
    expect(chooseB).toBeGreaterThan(0);
  });
});

describe("compareToControl", () => {
  it("returns null until both arms have units", () => {
    expect(compareToControl({ units: 0, conversions: 0 }, { units: 10, conversions: 1 })).toBeNull();
  });

  it("keeps running when the lead is likely but the risk is still high", () => {
    const stats = compareToControl({ units: 20, conversions: 3 }, { units: 20, conversions: 8 })!;
    expect(stats.chanceToBeatControl).toBeGreaterThan(0.95);
    expect(stats.riskVariant / (4 / 22)).toBeGreaterThan(RISK_THRESHOLD);
    expect(stats.decision).toBe("inconclusive");
  });

  it("declares a winner once it very likely beats control with low risk", () => {
    const stats = compareToControl({ units: 10000, conversions: 1000 }, { units: 10000, conversions: 1150 })!;
    expect(stats.chanceToBeatControl).toBeGreaterThan(0.999);
    expect(stats.decision).toBe("winning");
    expect(stats.liftInterval[0]).toBeGreaterThan(0);
  });

  it("marks a clearly worse variant as losing", () => {
    const stats = compareToControl({ units: 10000, conversions: 1150 }, { units: 10000, conversions: 1000 })!;
    expect(stats.chanceToBeatControl).toBeLessThan(0.001);
    expect(stats.decision).toBe("losing");
    expect(stats.liftInterval[1]).toBeLessThan(0);
  });

  it("is inconclusive for identical arms", () => {
    const stats = compareToControl({ units: 5000, conversions: 500 }, { units: 5000, conversions: 500 })!;
    expect(stats.chanceToBeatControl).toBeCloseTo(0.5, 6);
    expect(stats.decision).toBe("inconclusive");
  });
});
