import { FastifyRequest, FastifyReply } from 'fastify';
import { AgentApprovalService } from '../services/agentApprovalService';
import { logger } from '../utils/logger';

/**
 * Middleware to validate agent access based on PostgreSQL approval system
 * Ensures user has been granted access to the specific agent before allowing access
 */
export async function agentAccessValidationMiddleware(
  request: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  const user = (request as any).user;
  const { agentId } = request.params;

  if (!user?.uid) {
    logger.warn({ agentId }, 'Agent access middleware: missing user UID');
    return reply.code(401).send({ error: 'Authentication required' });
  }

  try {
    // Check if user has access to this agent
    const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, agentId);

    if (!hasAccess) {
      logger.warn({
        userId: user.uid,
        agentId,
        path: request.url
      }, 'Agent access denied: user does not have approved access');

      return reply.code(403).send({
        error: 'Agent access not granted yet',
        message: 'You need admin approval to access this agent. Please request access from the Agents page.'
      });
    }

    // User has access, continue to route handler
    logger.info({
      userId: user.uid,
      agentId,
      path: request.url
    }, 'Agent access granted');

  } catch (error) {
    logger.error({
      error,
      userId: user.uid,
      agentId
    }, 'Error validating agent access');

    // On error, deny access for security
    return reply.code(500).send({ error: 'Access validation failed' });
  }
}

/**
 * Factory function to create agent-specific access middleware
 */
export function createAgentAccessMiddleware(requiredAgentId: string) {
  return async function agentSpecificAccessMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const user = (request as any).user;

    if (!user?.uid) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, requiredAgentId);

      if (!hasAccess) {
        return reply.code(403).send({
          error: 'Agent access not granted yet',
          message: `You need admin approval to access the ${requiredAgentId} agent.`
        });
      }

    } catch (error) {
      logger.error({ error, userId: user.uid, requiredAgentId }, 'Error validating agent access');
      return reply.code(500).send({ error: 'Access validation failed' });
    }
  };
}