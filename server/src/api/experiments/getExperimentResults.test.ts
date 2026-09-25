import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/clickhouse/clickhouse.js", () => ({
  clickhouse: { query: vi.fn() },
}));
vi.mock("../../db/postgres/postgres.js", () => ({
  db: {},
}));

import { buildExperimentResultQueries, EXPERIMENT_UNIT } from "./getExperimentResults.js";
import { buildExperimentResults } from "./utils.js";

const CAMPAIGN_FILTER = JSON.stringify([{ parameter: "utm_campaign", type: "equals", value: ["recipe_book_2026"] }]);

const query = {
  filters: CAMPAIGN_FILTER,
  start_date: "",
  end_date: "",
  time_zone: "UTC",
};

const buildQueries = () =>
  buildExperimentResultQueries({
    query,
    siteId: 1,
    flagKey: "recipe_book_test",
    goalCondition: "type = 'form_submit' AND JSONExtractString(toString(props), 'formId') = 'gform_115'",
  });

describe("experiment result queries", () => {
  it("qualifies the session by its landing campaign before selecting later exposure and goal events", () => {
    const { exposureQuery } = buildQueries();

    expect(exposureQuery).toContain("FilteredSessions AS");
    expect(exposureQuery).toContain("argMinIf(url_parameters['utm_campaign'], timestamp, url_parameters['utm_campaign'] != '') AS utm_campaign");
    expect(exposureQuery).toContain("WHERE 1 = 1 AND utm_campaign = 'recipe_book_2026'");
    expect(exposureQuery.match(/INNER JOIN FilteredSessions USING \(session_id\)/g)).toHaveLength(2);
    expect(exposureQuery).toContain("event_name = 'feature_flag_exposure'");
    expect(exposureQuery).toContain("type = 'form_submit'");

    // The campaign condition belongs only to FilteredSessions, not separately
    // to the exposure and goal event rows.
    expect(exposureQuery.match(/utm_campaign = 'recipe_book_2026'/g)).toHaveLength(1);
  });

  it("uses the same campaign-qualified sessions for assignment fallback and goal events", () => {
    const { assignmentQuery } = buildQueries();

    expect(assignmentQuery).toContain("FilteredSessions AS");
    expect(assignmentQuery).toContain("WHERE 1 = 1 AND utm_campaign = 'recipe_book_2026'");
    expect(assignmentQuery.match(/INNER JOIN FilteredSessions USING \(session_id\)/g)).toHaveLength(2);
    expect(assignmentQuery).toContain("feature_flags['recipe_book_test'] != ''");
    expect(assignmentQuery).toContain("type = 'form_submit'");
    expect(assignmentQuery.match(/utm_campaign = 'recipe_book_2026'/g)).toHaveLength(1);
  });

  it("attributes a session to its first exposure variant instead of grouping it into every observed variant", () => {
    const { exposureQuery } = buildQueries();

    expect(exposureQuery).toContain("argMin(JSONExtractString(toString(props), 'value'), timestamp) AS variant");
    expect(exposureQuery).not.toContain("GROUP BY session_id, variant");
  });

  it("attributes assignment fallback to the first assigned variant per session", () => {
    const { assignmentQuery } = buildQueries();

    expect(assignmentQuery).toContain("argMin(feature_flags['recipe_book_test'], timestamp) AS variant");
    expect(assignmentQuery).not.toContain("GROUP BY session_id, variant");
  });

  it("groups exposures and goals by visitor, falling back to the session", () => {
    const { exposureQuery, assignmentQuery } = buildQueries();

    expect(EXPERIMENT_UNIT).toBe("if(visitor_id != '', visitor_id, session_id)");
    for (const sql of [exposureQuery, assignmentQuery]) {
      expect(sql.match(/if\(visitor_id != '', visitor_id, session_id\) AS unit/g)).toHaveLength(2);
      expect(sql.match(/GROUP BY unit/g)).toHaveLength(2);
      // Visitors behind one IP + UA share a session; count it once per variant.
      expect(sql).toMatch(/uniqExactArray\([ea]\.session_ids\) AS sessions/);
    }
  });

  it("counts a conversion from a later session against the unit's first exposure", () => {
    const { exposureQuery, assignmentQuery } = buildQueries();

    expect(exposureQuery).toContain("LEFT JOIN goal_units g ON g.unit = e.unit");
    expect(exposureQuery).toContain("uniqExactIf(e.unit, g.last_goal_at >= e.exposed_at) AS conversions");
    expect(exposureQuery).toContain("uniqExact(e.unit) AS units");
    expect(assignmentQuery).toContain("LEFT JOIN goal_units g ON g.unit = a.unit");
    expect(assignmentQuery).toContain("uniqExactIf(a.unit, g.last_goal_at >= a.assigned_at) AS conversions");
  });
});

describe("buildExperimentResults", () => {
  it("uses units, not sessions, as the conversion-rate denominator", () => {
    const results = buildExperimentResults(
      ["control", "test"],
      [
        { variant: "control", units: 10, sessions: 25, exposures: 40, conversions: 5 },
        { variant: "test", units: 10, sessions: 12, exposures: 15, conversions: 6 },
      ]
    );

    expect(results[0]).toMatchObject({ variant: "control", units: 10, sessions: 25, conversionRate: 0.5, isControl: true });
    expect(results[1].conversionRate).toBe(0.6);
    expect(results[1].lift).toBeCloseTo(0.2);
  });

  it("coerces ClickHouse UInt64 strings to numbers", () => {
    const [control] = buildExperimentResults(["control"], [
      { variant: "control", units: "4", sessions: "6", exposures: "8", conversions: "1" } as never,
    ]);

    expect(control).toMatchObject({ units: 4, sessions: 6, exposures: 8, conversions: 1, conversionRate: 0.25 });
  });
});
