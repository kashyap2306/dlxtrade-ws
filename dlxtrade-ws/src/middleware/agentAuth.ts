import { FastifyRequest, FastifyReply } from 'fastify';
import { AgentApprovalService } from '../services/agentApprovalService';
import { logger } from '../utils/logger';

export async function agentAccessMiddleware(
  request: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
): Promise<void> {
  const user = (request as any).user;
  const { agentId } = request.params;

  if (!user?.uid) {
    logger.warn({ agentId }, 'Agent access denied: no user authenticated');
    reply.code(401).send({ error: 'Authentication required' });
    return;
  }

  try {
    const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, agentId);

    if (!hasAccess) {
      logger.warn({ uid: user.uid, agentId }, 'Agent access denied: user does not have access to this agent');
      reply.code(403).send({ error: 'Access denied: You do not have permission to access this agent' });
      return;
    }

    logger.debug({ uid: user.uid, agentId }, 'Agent access granted');
  } catch (error: any) {
    logger.error({ error, uid: user.uid, agentId }, 'Error checking agent access');
    reply.code(500).send({ error: 'Internal server error' });
    return;
  }
}

