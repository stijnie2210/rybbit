import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/postgres/postgres.js";
import { sites } from "../../db/postgres/schema.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { validateIPPattern } from "../../lib/ipUtils.js";
import { eq } from "drizzle-orm";

const updateExcludedIPsSchema = z.object({
  siteId: z.string().min(1),
  excludedIPs: z.array(z.string().trim().min(1)).max(100), // Limit to 100 IPs/ranges
});

export async function updateSiteExcludedIPs(request: FastifyRequest, reply: FastifyReply) {
  try {
    const validationResult = updateExcludedIPsSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Invalid request data",
        details: validationResult.error.flatten(),
      });
    }

    const { siteId, excludedIPs } = validationResult.data;
    const numericSiteId = Number(siteId);

    // Validate each IP pattern
    const validationErrors: string[] = [];
    for (const ip of excludedIPs) {
      const validation = validateIPPattern(ip);
      if (!validation.valid) {
        validationErrors.push(`${ip}: ${validation.error}`);
      }
    }

    if (validationErrors.length > 0) {
      return reply.status(400).send({
        success: false,
        error: "Invalid IP patterns",
        details: validationErrors,
      });
    }

    // Update the database
    await db
      .update(sites)
      .set({
        excludedIPs: excludedIPs,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sites.siteId, numericSiteId));

    // Update the cache
    siteConfig.updateSiteExcludedIPs(numericSiteId, excludedIPs);

    return reply.send({
      success: true,
      message: "Excluded IPs updated successfully",
      excludedIPs,
    });
  } catch (error) {
    console.error("Error updating excluded IPs:", error);
    return reply.status(500).send({
      success: false,
      error: "Failed to update excluded IPs",
    });
  }
}