import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/clickhouse/clickhouse.js", () => ({
  clickhouse: { query: vi.fn() },
}));
vi.mock("../../db/postgres/postgres.js", () => ({
  db: {},
}));

import { getTimeStatement } from "../analytics/utils/timeWindow.js";
import { buildExperimentResultQueries, EXPERIMENT_UNIT, resolveExperimentWindow } from "./getExperimentResults.js";
import { buildCumulativeSeries } from "./getExperimentTimeseries.js";
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
      expect(sql).toContain("GROUP BY unit");
      // Visitors behind one IP + UA share a session; count it once per variant.
      expect(sql).toContain("uniqExactArray(u.session_ids) AS sessions");
    }
  });

  it("counts a conversion from a later session against the unit's first exposure", () => {
    const { exposureQuery, assignmentQuery } = buildQueries();

    for (const sql of [exposureQuery, assignmentQuery]) {
      expect(sql).toContain("LEFT JOIN goal_units g ON g.unit = u.unit");
      expect(sql).toContain("uniqExactIf(u.unit, g.last_goal_at >= u.exposed_at) AS conversions");
      expect(sql).toContain("uniqExact(u.unit) AS units");
    }
  });

  it("dates a unit's conversion by its first goal at or after exposure, in the site time zone", () => {
    const { exposureTimeseriesQuery, assignmentTimeseriesQuery } = buildQueries();

    for (const sql of [exposureTimeseriesQuery, assignmentTimeseriesQuery]) {
      expect(sql).toContain("minIf(g.timestamp, g.timestamp >= u.exposed_at) AS converted_at");
      expect(sql).toContain("toDate(exposed_at, 'UTC') AS day");
      expect(sql).toContain("WHERE converted_at > toDateTime(0)");
      expect(sql).toContain("GROUP BY variant, day");
    }
    expect(exposureTimeseriesQuery).toContain("event_name = 'feature_flag_exposure'");
    expect(assignmentTimeseriesQuery).toContain("feature_flags['recipe_book_test'] != ''");
  });
});

describe("resolveExperimentWindow", () => {
  const rangeQuery = { filters: "", start_date: "2026-09-01", end_date: "2026-09-26", time_zone: "Europe/Amsterdam" };
  const now = new Date("2026-09-26T10:00:00.400Z");

  it("measures a running experiment from its start until now", () => {
    const { query, window } = resolveExperimentWindow(rangeQuery, { startedAt: "2026-09-25 21:29:05.93", endedAt: null }, now);

    expect(query).toMatchObject({ start_date: "", end_date: "", start_datetime: "2026-09-25 21:29:05" });
    expect(query.end_datetime).toBe("2026-09-26 10:00:02");
    expect(window).toEqual({ mode: "experiment", start: "2026-09-25 21:29:05", end: null });
    expect(getTimeStatement(query)).toContain("timestamp >= toDateTime('2026-09-25 21:29:05', 'UTC')");
  });

  it("stops a completed experiment at its end", () => {
    const { query, window } = resolveExperimentWindow(
      rangeQuery,
      { startedAt: "2026-09-25 21:29:05.93", endedAt: "2026-09-25 21:37:36.163" },
      now
    );

    expect(query.end_datetime).toBe("2026-09-25 21:37:37");
    expect(window).toEqual({ mode: "experiment", start: "2026-09-25 21:29:05", end: "2026-09-25 21:37:37" });
  });

  it("uses the page date range when asked, or before the experiment starts", () => {
    const started = { startedAt: "2026-09-25 21:29:05.93", endedAt: null };
    expect(resolveExperimentWindow({ ...rangeQuery, window: "range" as const }, started, now).query).toMatchObject(rangeQuery);
    expect(resolveExperimentWindow(rangeQuery, { startedAt: null, endedAt: null }, now).window).toEqual({
      mode: "range",
      start: "2026-09-01",
      end: "2026-09-26",
    });
  });
});

describe("buildCumulativeSeries", () => {
  it("fills every day of the window and accumulates units and conversions", () => {
    const series = buildCumulativeSeries(
      ["control", "test"],
      [
        { variant: "control", day: "2026-09-24", units: "4", conversions: "1" },
        { variant: "test", day: "2026-09-24", units: "5", conversions: "0" },
        { variant: "test", day: "2026-09-26", units: "5", conversions: "3" },
      ],
      { mode: "experiment", start: "2026-09-23 23:30:00", end: null },
      "Europe/Amsterdam",
      "2026-09-26"
    );

    // 23:30 UTC on the 23rd is already the 24th in Amsterdam.
    expect(series.map(s => s.points.map(p => p.date))).toEqual([
      ["2026-09-24", "2026-09-25", "2026-09-26"],
      ["2026-09-24", "2026-09-25", "2026-09-26"],
    ]);
    expect(series[0].points.map(p => [p.units, p.conversions])).toEqual([[4, 1], [4, 1], [4, 1]]);
    expect(series[1].points[2]).toEqual({ date: "2026-09-26", units: 10, conversions: 3, conversionRate: 0.3 });
  });

  it("uses the data's own days for an all-time range", () => {
    const series = buildCumulativeSeries(
      ["control"],
      [{ variant: "control", day: "2026-09-20", units: 2, conversions: 1 }, { variant: "control", day: "2026-09-21", units: 2, conversions: 0 }],
      { mode: "range", start: null, end: null },
      "UTC"
    );

    expect(series[0].points.map(p => p.date)).toEqual(["2026-09-20", "2026-09-21"]);
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
