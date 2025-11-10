import { eq } from "drizzle-orm";
import { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../../db/postgres/postgres.js";
import { funnels as funnelsTable } from "../../../db/postgres/schema.js";
import { validateApiKey } from "../../../services/shared/requestValidation.js";

export async function getFunnelsApi(
  request: FastifyRequest<{
    Params: {
      site: string;
    };
    Headers: {
      "x-api-key"?: string;
    };
  }>,
  reply: FastifyReply
) {
  const { site } = request.params;
  const apiKey = request.headers["x-api-key"] as string | undefined;

  console.log("getFunnelsApi - site:", site, "apiKey:", apiKey);

  // Validate API key
  const validation = await validateApiKey(site, apiKey);
  console.log("getFunnelsApi - validation result:", validation);

  if (!validation.success) {
    return reply.status(403).send({
      error: validation.error || "Invalid or missing API key",
    });
  }

  try {
    // Fetch all funnels for the site
    const funnelRecords = await db
      .select()
      .from(funnelsTable)
      .where(eq(funnelsTable.siteId, Number(site)))
      .orderBy(funnelsTable.createdAt);

    // Transform the records to a more API-friendly structure
    const funnels = funnelRecords.map(record => {
      const data = record.data as any;
      return {
        id: record.reportId,
        name: data.name || "Unnamed Funnel",
        steps: data.steps || [],
        configuration: data.configuration || {},
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        // Include any additional analytics data that might be stored
        conversionRate: data.lastResult?.conversionRate || null,
        totalVisitors: data.lastResult?.totalVisitors || null,
      };
    });

    return reply.send({ data: funnels });
  } catch (error) {
    console.error("Error fetching funnels:", error);
    return reply.status(500).send({ error: "Failed to fetch funnels" });
  }
}
