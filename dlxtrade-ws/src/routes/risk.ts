import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { validateTradeProposal, TradeValidationRequest } from "../services/tradeValidationController";
import { logger } from "../utils/logger";

/**
 * Risk Validation Routes
 * Optional risk validation system for trading agents
 */
export async function riskRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/risk/validate
   * Validates a trade proposal using the risk bot system
   */
  fastify.post(
    "/validate",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        if (!user?.uid) {
          return reply.code(401).send({ error: "Authentication required" });
        }

        const body = request.body as any;

        // Validate required fields
        if (!body.agentId || !body.trade) {
          return reply.code(400).send({
            error: "Missing required fields: agentId and trade"
          });
        }

        // Build validation request
        const validationRequest: TradeValidationRequest = {
          agentId: body.agentId,
          trade: body.trade
        };

        // Execute validation
        const result = await validateTradeProposal(validationRequest);

        // Return result
        return reply.send({
          success: true,
          approved: result.approved,
          confidence: result.confidence,
          reason: result.reason,
          bots_executed: result.bots_executed,
          failed_bot: result.failed_bot
        });

      } catch (error: any) {
        logger.error(
          {
            error: error.message,
            user: (request as any).user?.uid,
            body: request.body
          },
          "Risk validation API error"
        );

        return reply.code(500).send({
          error: "Internal server error during risk validation"
        });
      }
    }
  );
}