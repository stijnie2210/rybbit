import { FastifyReply, FastifyRequest } from "fastify";
import type { FilterParams } from "@rybbit/shared";
import SqlString from "sqlstring";
import { z } from "zod";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { buildGoalCondition } from "../analytics/goals/goalConditions.js";
import { buildFilteredSessionsCTE } from "../analytics/utils/sessionFilters.js";
import { processResults } from "../analytics/utils/utils.js";
import { getTimeStatement } from "../analytics/utils/timeWindow.js";
import type { ExperimentResultRow } from "./types.js";
import {
  buildExperimentResults,
  getExperimentVariantKeys,
  getExperimentWithRelations,
  parseExperimentId,
  parseSiteId,
  serializeExperiment,
} from "./utils.js";

// Visitors from the script's stable visitor id; events sent before it existed
// (or from clients that omit it) fall back to one unit per session.
export const EXPERIMENT_UNIT = "if(visitor_id != '', visitor_id, session_id)";

type BuildExperimentResultQueriesParams = {
  query: FilterParams;
  siteId: number;
  flagKey: string;
  goalCondition: string;
};

export function buildExperimentResultQueries({
  query,
  siteId,
  flagKey,
  goalCondition,
}: BuildExperimentResultQueriesParams) {
  const timeStatement = getTimeStatement(query);
  const filteredSessionsCte = buildFilteredSessionsCTE(query.filters, siteId, timeStatement);
  const filteredSessionsJoin = filteredSessionsCte ? "INNER JOIN FilteredSessions USING (session_id)" : "";
  const filteredSessionsPrefix = filteredSessionsCte ? `${filteredSessionsCte},` : "";
  const escapedSiteId = SqlString.escape(siteId);
  const escapedFlagKey = SqlString.escape(flagKey);

  // A session qualifies once, independently of which event carried the filter
  // value. Goal, exposure, and assignment rows are then scoped to that cohort,
  // and grouped by analysis unit so a later-session conversion still counts.
  const goalUnitsCte = `
      goal_units AS (
        SELECT
          ${EXPERIMENT_UNIT} AS unit,
          max(timestamp) AS last_goal_at
        FROM events
        ${filteredSessionsJoin}
        WHERE site_id = ${escapedSiteId}
          AND (${goalCondition})
          ${timeStatement}
        GROUP BY unit
      )`;

  // The first observed exposure fixes the experiment arm for the unit. A
  // later flag refresh must not count one unit in multiple variants.
  const exposureQuery = `
      WITH
        ${filteredSessionsPrefix}
        exposure_units AS (
          SELECT
            ${EXPERIMENT_UNIT} AS unit,
            argMin(JSONExtractString(toString(props), 'value'), timestamp) AS variant,
            min(timestamp) AS exposed_at,
            groupUniqArray(session_id) AS session_ids,
            count() AS exposures
          FROM events
          ${filteredSessionsJoin}
          WHERE site_id = ${escapedSiteId}
            AND type = 'custom_event'
            AND event_name = 'feature_flag_exposure'
            AND JSONExtractString(toString(props), 'key') = ${escapedFlagKey}
            AND JSONExtractString(toString(props), 'value') != ''
            ${timeStatement}
          GROUP BY unit
        ),
        ${goalUnitsCte}
      SELECT
        e.variant AS variant,
        uniqExact(e.unit) AS units,
        uniqExactArray(e.session_ids) AS sessions,
        sum(e.exposures) AS exposures,
        uniqExactIf(e.unit, g.last_goal_at >= e.exposed_at) AS conversions
      FROM exposure_units e
      LEFT JOIN goal_units g ON g.unit = e.unit
      GROUP BY e.variant
      ORDER BY e.variant ASC
    `;

  // Assignment fallback follows the same one-arm-per-unit rule, using the
  // first event that carried an assignment for the flag.
  const assignmentQuery = `
      WITH
        ${filteredSessionsPrefix}
        assignment_units AS (
          SELECT
            ${EXPERIMENT_UNIT} AS unit,
            argMin(feature_flags[${escapedFlagKey}], timestamp) AS variant,
            min(timestamp) AS assigned_at,
            groupUniqArray(session_id) AS session_ids
          FROM events
          ${filteredSessionsJoin}
          WHERE site_id = ${escapedSiteId}
            AND feature_flags[${escapedFlagKey}] != ''
            ${timeStatement}
          GROUP BY unit
        ),
        ${goalUnitsCte}
      SELECT
        a.variant AS variant,
        uniqExact(a.unit) AS units,
        uniqExactArray(a.session_ids) AS sessions,
        uniqExact(a.unit) AS exposures,
        uniqExactIf(a.unit, g.last_goal_at >= a.assigned_at) AS conversions
      FROM assignment_units a
      LEFT JOIN goal_units g ON g.unit = a.unit
      GROUP BY a.variant
      ORDER BY a.variant ASC
    `;

  return { assignmentQuery, exposureQuery };
}

export async function getExperimentResults(
  request: FastifyRequest<{
    Params: { siteId: string; experimentId: string };
    Querystring: FilterParams;
  }>,
  reply: FastifyReply
) {
  try {
    const siteId = parseSiteId(request.params.siteId, reply);
    if (!siteId) return;

    const experimentId = parseExperimentId(request.params.experimentId, reply);
    if (!experimentId) return;

    const record = await getExperimentWithRelations(siteId, experimentId);
    if (!record) {
      return reply.status(404).send({ error: "Experiment not found" });
    }

    const variants = getExperimentVariantKeys(record.featureFlag);
    const goalCondition = record.primaryGoal ? buildGoalCondition(record.primaryGoal) : null;

    if (!record.primaryGoal || !goalCondition) {
      return reply.send({
        data: {
          experiment: serializeExperiment(record),
          variants: buildExperimentResults(variants, []),
          totalUnits: 0,
          totalExposureSessions: 0,
          totalConversions: 0,
          hasGoal: false,
          measurement: "exposure",
        },
      });
    }

    const { assignmentQuery, exposureQuery } = buildExperimentResultQueries({
      query: request.query,
      siteId,
      flagKey: record.featureFlag.key,
      goalCondition,
    });

    const exposureResult = await clickhouse.query({ query: exposureQuery, format: "JSONEachRow" });
    let rows = await processResults<ExperimentResultRow>(exposureResult);
    let measurement: "exposure" | "assignment" = "exposure";

    // Fallback: if no exposures were recorded (the app never calls rybbit.flag
    // for this key), count sessions that were assigned the variant via the
    // feature_flags map attached to every event. Looser, but avoids a confusing
    // empty result when the flag is clearly assigning traffic.
    const hasExposures = rows.some(row => Number(row.units) > 0);
    if (!hasExposures) {
      const assignmentResult = await clickhouse.query({ query: assignmentQuery, format: "JSONEachRow" });
      const assignmentRows = await processResults<ExperimentResultRow>(assignmentResult);
      if (assignmentRows.some(row => Number(row.units) > 0)) {
        rows = assignmentRows;
        measurement = "assignment";
      }
    }

    const variantResults = buildExperimentResults(variants, rows);

    return reply.send({
      data: {
        experiment: serializeExperiment(record),
        variants: variantResults,
        totalUnits: variantResults.reduce((sum, variant) => sum + variant.units, 0),
        totalExposureSessions: variantResults.reduce((sum, variant) => sum + variant.sessions, 0),
        totalConversions: variantResults.reduce((sum, variant) => sum + variant.conversions, 0),
        hasGoal: true,
        measurement,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Validation error", details: error.errors });
    }
    return reply.status(500).send({ error: "Failed to get experiment results" });
  }
}
