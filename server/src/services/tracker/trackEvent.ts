import { FastifyReply, FastifyRequest } from "fastify";
import { isbot } from "isbot";
import { z, ZodError } from "zod";
import { isIPExcluded } from "../../lib/ipUtils.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { sessionsService } from "../sessions/sessionsService.js";
import { checkApiKeyRateLimit, validateApiKey, validateOrigin } from "../shared/requestValidation.js";
import { usageService } from "../usageService.js";
import { pageviewQueue } from "./pageviewQueue.js";
import { createBasePayload } from "./utils.js";

// Define Zod schema for validation
export const trackingPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("pageview"),
      site_id: z.string().min(1),
      hostname: z.string().max(253).optional(),
      pathname: z.string().max(2048).optional(),
      querystring: z.string().max(2048).optional(),
      screenWidth: z.number().int().positive().optional(),
      screenHeight: z.number().int().positive().optional(),
      language: z.string().max(35).optional(),
      page_title: z.string().max(512).optional(),
      referrer: z.string().max(2048).optional(),
      event_name: z.string().max(256).optional(),
      properties: z.string().max(2048).optional(),
      user_id: z.string().max(255).optional(),
      api_key: z.string().max(35).optional(), // rb_ prefix + 32 hex chars
      ip_address: z.string().ip().optional(), // Custom IP for geolocation
      user_agent: z.string().max(512).optional(), // Custom user agent
    })
    .strict(),
  z
    .object({
      type: z.literal("custom_event"),
      site_id: z.string().min(1),
      hostname: z.string().max(253).optional(),
      pathname: z.string().max(2048).optional(),
      querystring: z.string().max(2048).optional(),
      screenWidth: z.number().int().positive().optional(),
      screenHeight: z.number().int().positive().optional(),
      language: z.string().max(35).optional(),
      page_title: z.string().max(512).optional(),
      referrer: z.string().max(2048).optional(),
      event_name: z.string().min(1).max(256),
      properties: z
        .string()
        .max(2048)
        .refine(
          (val) => {
            try {
              JSON.parse(val);
              return true;
            } catch (e) {
              return false;
            }
          },
          { message: "Properties must be a valid JSON string" },
        )
        .optional(), // Optional but must be valid JSON if present
      user_id: z.string().max(255).optional(),
      api_key: z.string().max(35).optional(), // rb_ prefix + 32 hex chars
      ip_address: z.string().ip().optional(), // Custom IP for geolocation
      user_agent: z.string().max(512).optional(), // Custom user agent
    })
    .strict(),
  z
    .object({
      type: z.literal("performance"),
      site_id: z.string().min(1),
      hostname: z.string().max(253).optional(),
      pathname: z.string().max(2048).optional(),
      querystring: z.string().max(2048).optional(),
      screenWidth: z.number().int().positive().optional(),
      screenHeight: z.number().int().positive().optional(),
      language: z.string().max(35).optional(),
      page_title: z.string().max(512).optional(),
      referrer: z.string().max(2048).optional(),
      event_name: z.string().max(256).optional(),
      properties: z.string().max(2048).optional(),
      user_id: z.string().max(255).optional(),
      api_key: z.string().max(35).optional(), // rb_ prefix + 32 hex chars
      ip_address: z.string().ip().optional(), // Custom IP for geolocation
      user_agent: z.string().max(512).optional(), // Custom user agent
      // Performance metrics (can be null if not collected)
      lcp: z.number().min(0).nullable().optional(),
      cls: z.number().min(0).nullable().optional(),
      inp: z.number().min(0).nullable().optional(),
      fcp: z.number().min(0).nullable().optional(),
      ttfb: z.number().min(0).nullable().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      site_id: z.string().min(1),
      hostname: z.string().max(253).optional(),
      pathname: z.string().max(2048).optional(),
      querystring: z.string().max(2048).optional(),
      screenWidth: z.number().int().positive().optional(),
      screenHeight: z.number().int().positive().optional(),
      language: z.string().max(35).optional(),
      page_title: z.string().max(512).optional(),
      referrer: z.string().max(2048).optional(),
      event_name: z.string().min(1).max(256), // Error type (TypeError, ReferenceError, etc.)
      properties: z
        .string()
        .max(4096) // Larger limit for error details
        .refine(
          (val) => {
            try {
              const parsed = JSON.parse(val);
              // Validate error-specific properties
              if (typeof parsed.message !== "string") return false;
              if (parsed.stack && typeof parsed.stack !== "string") return false;

              // Support both camelCase and lowercase for backwards compatibility
              if (parsed.fileName && typeof parsed.fileName !== "string") return false;

              if (parsed.lineNumber && typeof parsed.lineNumber !== "number") return false;

              if (parsed.columnNumber && typeof parsed.columnNumber !== "number") return false;

              // Apply truncation limits
              if (parsed.message && parsed.message.length > 500) {
                parsed.message = parsed.message.substring(0, 500);
              }
              if (parsed.stack && parsed.stack.length > 2000) {
                parsed.stack = parsed.stack.substring(0, 2000);
              }

              return true;
            } catch (e) {
              return false;
            }
          },
          {
            message:
              "Properties must be valid JSON with error fields (message, stack, fileName, lineNumber, columnNumber)",
          },
        ),
      user_id: z.string().max(255).optional(),
      api_key: z.string().max(35).optional(), // rb_ prefix + 32 hex chars
      ip_address: z.string().ip().optional(), // Custom IP for geolocation
      user_agent: z.string().max(512).optional(), // Custom user agent
    })
    .strict(),
]);

// Unified handler for all events (pageviews and custom events)
export async function trackEvent(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Validate request body using Zod
    const validationResult = trackingPayloadSchema.safeParse(request.body);

    if (!validationResult.success) {
      return reply.status(400).send({
        success: false,
        error: "Invalid payload",
        details: validationResult.error.flatten(),
      });
    }

    // Use validated data
    const validatedPayload = validationResult.data;

    // First check if API key is provided and valid
    const apiKeyValidation = await validateApiKey(validatedPayload.site_id, validatedPayload.api_key);

    // If API key validation failed with an error, reject the request
    if (apiKeyValidation.error) {
      console.warn(`[Tracking] Request rejected for site ${validatedPayload.site_id}: ${apiKeyValidation.error}`);
      return reply.status(403).send({
        success: false,
        error: apiKeyValidation.error,
      });
    }

    // Check rate limit for API key authenticated requests
    if (apiKeyValidation.success && validatedPayload.api_key) {
      if (!checkApiKeyRateLimit(validatedPayload.api_key)) {
        console.warn(
          `[Tracking] Rate limit exceeded for API key ${validatedPayload.api_key} on site ${validatedPayload.site_id}`,
        );
        return reply.status(429).send({
          success: false,
          error: "Rate limit exceeded. Maximum 20 requests per second per API key.",
        });
      }
    }

    // If no valid API key, validate origin
    if (!apiKeyValidation.success) {
      const originValidation = await validateOrigin(validatedPayload.site_id, request.headers.origin as string);

      if (!originValidation.success) {
        console.warn(`[Tracking] Request rejected for site ${validatedPayload.site_id}: ${originValidation.error}`);
        return reply.status(403).send({
          success: false,
          error: originValidation.error,
        });
      }
    }

    // Make sure the site config is loaded
    await siteConfig.ensureInitialized();

    // Check if bot blocking is enabled for this site and if the request is from a bot
    // Skip bot check for API key authenticated requests
    if (!validatedPayload.api_key && siteConfig.shouldBlockBots(validatedPayload.site_id)) {
      // Use custom user agent if provided, otherwise fall back to header
      const userAgent = validatedPayload.user_agent || (request.headers["user-agent"] as string);
      if (userAgent && isbot(userAgent)) {
        console.log(
          `[Tracking] Bot request filtered for site ${validatedPayload.site_id} from User-Agent: ${userAgent}`,
        );
        return reply.status(200).send({
          success: true,
          message: "Event not tracked - bot detected",
        });
      }
    }

    // Check if the site has exceeded its monthly limit
    if (usageService.isSiteOverLimit(Number(validatedPayload.site_id))) {
      console.log(`[Tracking] Skipping event for site ${validatedPayload.site_id} - over monthly limit`);
      return reply.status(200).send("Site over monthly limit, event not tracked");
    }

    // Check if the IP should be excluded from tracking
    // Use custom IP if provided in payload, otherwise get from request
    const requestIP = validatedPayload.ip_address || request.ip || "";
    const excludedIPs = siteConfig.getExcludedIPs(validatedPayload.site_id);
    
    if (isIPExcluded(requestIP, excludedIPs)) {
      console.log(`[Tracking] IP ${requestIP} excluded from tracking for site ${validatedPayload.site_id}`);
      return reply.status(200).send({
        success: true,
        message: "Event not tracked - IP excluded",
      });
    }

    // Create base payload for the event using validated data
    const payload = createBasePayload(
      request, // Pass request for IP/UA
      validatedPayload.type,
      validatedPayload, // Add validated payload back
    );
    // Update session
    const { sessionId } = await sessionsService.updateSession({
      userId: payload.userId,
      site_id: payload.site_id,
    });

    // Add to queue for processing
    await pageviewQueue.add({ ...payload, sessionId });

    return reply.status(200).send({
      success: true,
    });
  } catch (error) {
    console.error("Error tracking event:", error);
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: "Invalid payload format",
        details: error.flatten(),
      });
    }
    return reply.status(500).send({
      success: false,
      error: "Failed to track event",
    });
  }
}
