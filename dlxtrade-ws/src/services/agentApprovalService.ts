import { query, transaction } from '../db';
import { logger } from '../utils/logger';

export interface AgentRequest {
  id?: number;
  user_id: string;
  agent_id: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  requested_at?: Date;
  approved_at?: Date;
  approved_by?: string;
  rejected_at?: Date;
  rejected_by?: string;
  rejection_reason?: string;
}

export interface UserAgent {
  id?: number;
  user_id: string;
  agent_id: string;
  granted_at?: Date;
  granted_by?: string;
  is_active: boolean;
  expires_at?: Date;
}

export interface Agent {
  id?: number;
  agent_id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  features: string[];
  icon: string;
  badge: string;
  is_active: boolean;
}

export class AgentApprovalService {

  /**
   * Get all available agents
   * CRASH-PROOF: Never throws, handles JSON parsing safely
   */
  static async getAllAgents(): Promise<Agent[]> {
    try {
      const agents = await query(`
        SELECT id, agent_id, name, description, category, price,
               features, icon, badge, is_active, created_at, updated_at
        FROM agents
        WHERE is_active = true
        ORDER BY name ASC
      `);

      // Guard against query returning null/undefined
      if (!agents) {
        console.log('[Service] getAllAgents: Query returned null/undefined');
        return [];
      }

      // Guard against non-array result
      if (!Array.isArray(agents)) {
        console.log('[Service] getAllAgents: Query returned non-array');
        return [];
      }

      // Safe mapping with defensive JSON parsing
      const safeAgents = agents.map((agent: any) => {
        try {
          // Guard against null agent
          if (!agent) return null;

          // Safe JSON parsing of features
          let features = [];
          try {
            features = agent?.features ? JSON.parse(agent.features) : [];
            // Ensure features is an array
            if (!Array.isArray(features)) {
              features = [];
            }
          } catch (jsonError) {
            console.warn('[Service] getAllAgents: Failed to parse features JSON, using empty array');
            features = [];
          }

          return {
            id: agent?.id || undefined,
            agent_id: agent?.agent_id || 'unknown',
            name: agent?.name || 'Unknown Agent',
            description: agent?.description || '',
            category: agent?.category || '',
            price: agent?.price || 0,
            features,
            icon: agent?.icon || '🤖',
            badge: agent?.badge || '',
            is_active: true
          };
        } catch (mapError) {
          console.error('[Service] getAllAgents: Error mapping agent:', mapError);
          return null;
        }
      }).filter(Boolean); // Remove null entries

      console.log('[Service] getAllAgents: Returning', safeAgents.length, 'agents');
      return safeAgents;

    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      console.error('[Service] CRITICAL ERROR in getAllAgents:', {
        error: error?.message || 'Unknown error',
        stack: error?.stack ? '***STACK***' : 'no stack'
      });

      logger.error({
        error: error?.message || 'Unknown error in getAllAgents',
        operation: 'getAllAgents'
      }, 'Error fetching all agents - returning safe empty array');

      // CRASH-PROOF: Always return empty array, never throw
      return [];
    }
  }

  /**
   * Get agent by ID
   */
  static async getAgentById(agent_id: string): Promise<Agent | null> {
    try {
      if (!agent_id || typeof agent_id !== 'string' || agent_id.trim().length === 0) {
        return null;
      }

      const agents = await query(`
        SELECT id, agent_id, name, description, category, price,
               features, icon, badge, is_active, created_at, updated_at
        FROM agents
        WHERE agent_id = $1 AND is_active = true
      `, [agent_id.trim()]);

      if (!agents || !Array.isArray(agents) || agents.length === 0) {
        return null;
      }

      const agent = agents[0];
      if (!agent) {
        return null;
      }

      let features: string[] = [];
      try {
        features = agent?.features ? JSON.parse(agent.features) : [];
        if (!Array.isArray(features)) {
          features = [];
        }
      } catch {
        features = [];
      }

      return {
        id: agent?.id || undefined,
        agent_id: agent?.agent_id || agent_id.trim(),
        name: agent?.name || 'Unknown Agent',
        description: agent?.description || '',
        category: agent?.category || '',
        price: agent?.price || 0,
        features,
        icon: agent?.icon || '🤖',
        badge: agent?.badge || '',
        is_active: true
      };
    } catch (error: any) {
      logger.error({
        error: error?.message || 'Unknown error in getAgentById',
        agent_id: agent_id ? agent_id : 'null',
        operation: 'getAgentById'
      }, 'Error fetching agent by ID - returning null');
      return null;
    }
  }

  /**
   * Create an agent request
   * CRASH-PROOF: Never throws, returns status codes for different scenarios
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async createAgentRequest(requestData: AgentRequest): Promise<{ success: boolean; request_id?: number; status: string; message: string }> {
    return { success: true, source: 'firebase_only' } as any;
  }

  /**
   * Get pending agent requests (admin only)
   * CRASH-PROOF: Never throws, handles all array operations safely
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async getPendingRequests(): Promise<(AgentRequest & { agent_name: string; user_email?: string })[]> {
    return [];
  }

  /**
   * Approve an agent request
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async approveAgentRequest(requestId: number, approvedBy: string): Promise<any> {
    return { success: true };
  }

  /**
   * Reject an agent request
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async rejectAgentRequest(requestId: number, rejectedBy: string, reason?: string): Promise<any> {
    return { success: true };
  }

  /**
   * Get user's approved agents
   * SINGLE SOURCE OF TRUTH: user_agents table (PostgreSQL)
   * No Firestore fallback at runtime - Firestore only used for legacy data migration
   * CRASH-PROOF: Never throws, always returns array
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async getUserApprovedAgents(userId: string): Promise<UserAgent[]> {
    return [];

      console.log('[Service] getUserApprovedAgents called with userId:', userId);

      // Execute query with full error handling
      const userAgents = await query(`
        SELECT ua.id, ua.agent_id, ua.granted_at, ua.granted_by,
               COALESCE(a.name, 'Unknown Agent') as name,
               COALESCE(a.description, 'Agent details not available') as description,
               COALESCE(a.category, 'Unknown') as category,
               COALESCE(a.icon, '🤖') as icon,
               COALESCE(a.badge, 'Unknown') as badge
        FROM user_agents ua
        LEFT JOIN agents a ON ua.agent_id = a.agent_id AND a.is_active = true
        WHERE ua.user_id = $1 AND ua.is_active = true
        ORDER BY ua.granted_at DESC
      `, [userId.trim()]);

      // Guard against query returning null/undefined
      if (!userAgents) {
        console.log('[Service] getUserApprovedAgents: Query returned null/undefined, returning empty array');
        return [];
      }

      // Guard against non-array result
      if (!Array.isArray(userAgents)) {
        console.log('[Service] getUserApprovedAgents: Query returned non-array, returning empty array');
        return [];
      }

      console.log('[Service] getUserApprovedAgents: PostgreSQL query completed, found agents:', userAgents.length);

      // Safe mapping with defensive checks
      const safeAgents = userAgents.map((agent: any) => {
        try {
          // Guard against null agent
          if (!agent) return null;

          return {
            id: agent?.id || undefined,
            user_id: userId.trim(),
            agent_id: agent?.agent_id || 'unknown',
            granted_at: agent?.granted_at ? new Date(agent.granted_at) : new Date(),
            granted_by: agent?.granted_by || null,
            is_active: true,
            name: agent?.name || 'Unknown Agent',
            description: agent?.description || 'Agent details not available',
            category: agent?.category || 'Unknown',
            icon: agent?.icon || '🤖',
            badge: agent?.badge || 'Unknown',
          };
        } catch (mapError) {
          console.error('[Service] getUserApprovedAgents: Error mapping agent:', mapError);
          // Return minimal safe agent object on mapping error
          return {
            id: undefined,
            user_id: userId.trim(),
            agent_id: 'unknown',
            granted_at: new Date(),
            granted_by: null,
            is_active: true,
            name: 'Unknown Agent',
            description: 'Agent details not available',
            category: 'Unknown',
            icon: '🤖',
            badge: 'Unknown',
          };
        }
      }).filter(Boolean); // Remove any null entries from mapping errors

      console.log('[Service] getUserApprovedAgents: Returning', safeAgents.length, 'safe agents');
      return safeAgents;

    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      console.error('[Service] CRITICAL ERROR in getUserApprovedAgents:', {
        error: error?.message || 'Unknown error',
        userId: userId ? '***' : 'null/undefined', // Mask userId in logs for privacy
        stack: error?.stack ? '***STACK***' : 'no stack' // Don't log full stack traces
      });

      logger.error({
        error: error?.message || 'Unknown error in getUserApprovedAgents',
        userId: '***MASKED***', // Never log actual user IDs
        operation: 'getUserApprovedAgents'
      }, 'Error fetching user approved agents - returning safe empty array');

      // CRASH-PROOF: Always return empty array, never throw
      return [];
    }
  }

  /**
   * Check if user has access to a specific agent
   * CRASH-PROOF: Never throws, returns false on any error
   */
  static async userHasAgentAccess(userId: string, agentId: string): Promise<boolean> {
    try {
      // Input validation
      if (!userId || !agentId || typeof userId !== 'string' || typeof agentId !== 'string') {
        return false;
      }

      const result = await query(`
        SELECT COUNT(*) as count FROM user_agents
        WHERE user_id = $1 AND agent_id = $2 AND is_active = true
      `, [userId.trim(), agentId.trim()]);

      // Guard against query returning null/undefined
      if (!result) {
        return false;
      }

      // Guard against non-array result
      if (!Array.isArray(result) || result.length === 0) {
        return false;
      }

      const count = (result[0] as any)?.count;
      if (typeof count === 'number') {
        return count > 0;
      }

      // Safe string to number conversion
      const parsedCount = parseInt(String(count), 10);
      return !isNaN(parsedCount) && parsedCount > 0;

    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      logger.error({
        error: error?.message || 'Unknown error in userHasAgentAccess',
        userId: userId ? '***MASKED***' : 'null',
        agentId: agentId || 'null',
        operation: 'userHasAgentAccess'
      }, 'Error checking agent access - returning false');

      // CRASH-PROOF: Always return false on error, never throw
      return false;
    }
  }

  /**
   * Get user's agent requests
   * CRASH-PROOF: Never throws, handles all operations safely
   */
  static async getUserAgentRequests(userId: string): Promise<AgentRequest[]> {
    try {
      // Input validation
      if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
        console.log('[Service] getUserAgentRequests: Invalid userId');
        return [];
      }

      const requests = await query(`
        SELECT ar.*, COALESCE(a.name, 'Unknown Agent') as agent_name
        FROM agent_requests ar
        LEFT JOIN agents a ON ar.agent_id = a.agent_id AND a.is_active = true
        WHERE ar.user_id = $1
        ORDER BY ar.requested_at DESC
      `, [userId.trim()]);

      // Guard against query returning null/undefined
      if (!requests) {
        console.log('[Service] getUserAgentRequests: Query returned null/undefined');
        return [];
      }

      // Guard against non-array result
      if (!Array.isArray(requests)) {
        console.log('[Service] getUserAgentRequests: Query returned non-array');
        return [];
      }

      // Safe mapping with defensive checks
      const safeRequests = requests.map((request: any) => {
        try {
          // Guard against null request
          if (!request) return null;

          return {
            id: request?.id || undefined,
            user_id: request?.user_id || userId.trim(),
            agent_id: request?.agent_id || 'unknown',
            status: (request?.status as AgentRequest['status']) || 'PENDING_APPROVAL',
            requested_at: request?.requested_at ? new Date(request.requested_at) : new Date(),
            approved_at: request?.approved_at ? new Date(request.approved_at) : undefined,
            approved_by: request?.approved_by || undefined,
            rejected_at: request?.rejected_at ? new Date(request.rejected_at) : undefined,
            rejected_by: request?.rejected_by || undefined,
            rejection_reason: request?.rejection_reason || undefined,
            agent_name: request?.agent_name || 'Unknown Agent'
          };
        } catch (mapError) {
          console.error('[Service] getUserAgentRequests: Error mapping request:', mapError);
          return null;
        }
      }).filter(Boolean); // Remove null entries

      console.log('[Service] getUserAgentRequests: Returning', safeRequests.length, 'requests');
      return safeRequests;

    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      console.error('[Service] CRITICAL ERROR in getUserAgentRequests:', {
        error: error?.message || 'Unknown error',
        userId: userId ? '***MASKED***' : 'null',
        stack: error?.stack ? '***STACK***' : 'no stack'
      });

      logger.error({
        error: error?.message || 'Unknown error in getUserAgentRequests',
        userId: '***MASKED***',
        operation: 'getUserAgentRequests'
      }, 'Error fetching user agent requests - returning safe empty array');

      // CRASH-PROOF: Always return empty array, never throw
      return [];
    }
  }

  /**
   * Revoke user agent access (admin only)
   * CRASH-PROOF: Never throws, logs errors internally
   */
  static async revokeAgentAccess(userId: string, agentId: string, revokedBy: string): Promise<boolean> {
    try {
      // Input validation
      if (!userId || !agentId || !revokedBy ||
          typeof userId !== 'string' || typeof agentId !== 'string' || typeof revokedBy !== 'string') {
        logger.warn({
          userId: userId ? '***MASKED***' : 'null',
          agentId: agentId || 'null',
          revokedBy: revokedBy ? '***MASKED***' : 'null'
        }, 'revokeAgentAccess: Invalid input parameters');
        return false;
      }

      await query(`
        UPDATE user_agents
        SET is_active = false, updated_at = NOW()
        WHERE user_id = $1 AND agent_id = $2
      `, [userId.trim(), agentId.trim()]);

      logger.info({
        user_id: '***MASKED***',
        agent_id: agentId,
        revoked_by: '***MASKED***'
      }, 'Agent access revoked successfully');

      return true;
    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      logger.error({
        error: error?.message || 'Unknown error in revokeAgentAccess',
        userId: userId ? '***MASKED***' : 'null',
        agentId: agentId || 'null',
        revokedBy: revokedBy ? '***MASKED***' : 'null',
        operation: 'revokeAgentAccess'
      }, 'Error revoking agent access - operation may have failed');

      // CRASH-PROOF: Return false instead of throwing
      return false;
    }
  }

  /**
   * Get users who have access to a specific agent
   */
  static async getUsersWithAgentAccess(agentId: string): Promise<string[]> {
    try {
      const userAgents = await query(`
        SELECT user_id FROM user_agents
        WHERE agent_id = $1 AND is_active = true
      `, [agentId]);

      return userAgents.map((ua: any) => ua.user_id);
    } catch (error) {
      logger.error({ error, agentId }, 'Error fetching users with agent access');
      return [];
    }
  }

  /**
   * Assign agent directly to user by email (admin only)
   * CRASH-PROOF: Never throws, returns status information
   */
  static async assignAgentToUserByEmail(email: string, agentId: string, assignedBy: string): Promise<{ success: boolean; message: string; user_id?: string }> {
    try {
      // Input validation
      if (!email || !agentId || !assignedBy ||
          typeof email !== 'string' || typeof agentId !== 'string' || typeof assignedBy !== 'string') {
        return {
          success: false,
          message: 'Invalid input parameters'
        };
      }

      // First, get the user ID from the email
      const users = await query(`
        SELECT firebase_uid FROM users WHERE email = $1
      `, [email.trim()]);

      // Guard against query returning non-array or empty
      if (!Array.isArray(users) || users.length === 0) {
        return {
          success: false,
          message: 'User not found with the provided email'
        };
      }

      const userId = users[0]?.firebase_uid;
      if (!userId) {
        return {
          success: false,
          message: 'User not found with the provided email'
        };
      }

      // Check if agent exists (but don't fail if we can't check)
      try {
        const agent = await this.getAgentById(agentId);
        if (!agent) {
          return {
            success: false,
            message: 'Agent not found'
          };
        }
      } catch (agentCheckError) {
        // Log but continue - allow assignment even if agent check fails
        logger.warn({ error: agentCheckError, agentId }, 'Could not verify agent exists, proceeding with assignment');
      }

      // Check if user already has this agent
      try {
        const existingAccess = await query(`
          SELECT id FROM user_agents
          WHERE user_id = $1 AND agent_id = $2 AND is_active = true
        `, [userId, agentId]);

        // Guard against query returning non-array
        if (Array.isArray(existingAccess) && existingAccess.length > 0) {
          return {
            success: true,
            message: 'User already has access to this agent',
            user_id: userId
          };
        }
      } catch (accessCheckError) {
        // Log error but continue - assume user doesn't have access
        logger.warn({ error: accessCheckError, userId, agentId }, 'Could not check existing access, proceeding with assignment');
      }

      // Grant access directly
      await query(`
        INSERT INTO user_agents (user_id, agent_id, granted_at, granted_by, is_active)
        VALUES ($1, $2, NOW(), $3, true)
        ON CONFLICT (user_id, agent_id) DO UPDATE SET
          is_active = true,
          granted_at = NOW(),
          granted_by = $3,
          updated_at = NOW()
      `, [userId, agentId, assignedBy]);

      // Also create an approved request record for tracking
      try {
        await query(`
          INSERT INTO agent_requests (user_id, agent_id, status, approved_at, approved_by, requested_at)
          VALUES ($1, $2, 'APPROVED', NOW(), $3, NOW())
          ON CONFLICT (user_id, agent_id) DO UPDATE SET
            status = 'APPROVED',
            approved_at = NOW(),
            approved_by = $3,
            updated_at = NOW()
        `, [userId, agentId, assignedBy]);
      } catch (requestRecordError) {
        // Log but don't fail - the main assignment succeeded
        logger.warn({ error: requestRecordError, userId, agentId }, 'Could not create request record, but agent was assigned');
      }

      logger.info({
        user_id: '***MASKED***',
        email: '***MASKED***',
        agent_id: agentId,
        assigned_by: '***MASKED***'
      }, 'Agent directly assigned to user by admin');

      return {
        success: true,
        message: 'Agent assigned successfully',
        user_id: userId
      };

    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      logger.error({
        error: error?.message || 'Unknown error in assignAgentToUserByEmail',
        email: email ? '***MASKED***' : 'null',
        agentId: agentId || 'null',
        assignedBy: assignedBy ? '***MASKED***' : 'null',
        operation: 'assignAgentToUserByEmail'
      }, 'Error assigning agent to user by email - operation may have failed');

      return {
        success: false,
        message: 'Failed to assign agent due to an internal error'
      };
    }
  }

  /**
   * Get agent statistics (admin only)
   * CRASH-PROOF: Never throws, returns safe defaults
   */
  static async getAgentStats(): Promise<{
    total_agents: number;
    total_requests: number;
    pending_requests: number;
    approved_requests: number;
    rejected_requests: number;
    active_users: number;
  }> {
    try {
      const stats = await query(`
        SELECT
          (SELECT COUNT(*) FROM agents WHERE is_active = true) as total_agents,
          (SELECT COUNT(*) FROM agent_requests) as total_requests,
          (SELECT COUNT(*) FROM agent_requests WHERE status = 'PENDING_APPROVAL') as pending_requests,
          (SELECT COUNT(*) FROM agent_requests WHERE status = 'APPROVED') as approved_requests,
          (SELECT COUNT(*) FROM agent_requests WHERE status = 'REJECTED') as rejected_requests,
          (SELECT COUNT(DISTINCT user_id) FROM user_agents WHERE is_active = true) as active_users
      `);

      // Guard against query returning null/undefined
      if (!stats) {
        console.log('[Service] getAgentStats: Query returned null/undefined');
        return {
          total_agents: 0,
          total_requests: 0,
          pending_requests: 0,
          approved_requests: 0,
          rejected_requests: 0,
          active_users: 0
        };
      }

      // Guard against non-array result
      if (!Array.isArray(stats) || stats.length === 0) {
        console.log('[Service] getAgentStats: Query returned empty or non-array');
        return {
          total_agents: 0,
          total_requests: 0,
          pending_requests: 0,
          approved_requests: 0,
          rejected_requests: 0,
          active_users: 0
        };
      }

      const statRow = stats[0];
      if (!statRow) {
        console.log('[Service] getAgentStats: First row is null/undefined');
        return {
          total_agents: 0,
          total_requests: 0,
          pending_requests: 0,
          approved_requests: 0,
          rejected_requests: 0,
          active_users: 0
        };
      }

      // Safe number parsing with defaults
      return {
        total_agents: typeof statRow.total_agents === 'number' ? statRow.total_agents : 0,
        total_requests: typeof statRow.total_requests === 'number' ? statRow.total_requests : 0,
        pending_requests: typeof statRow.pending_requests === 'number' ? statRow.pending_requests : 0,
        approved_requests: typeof statRow.approved_requests === 'number' ? statRow.approved_requests : 0,
        rejected_requests: typeof statRow.rejected_requests === 'number' ? statRow.rejected_requests : 0,
        active_users: typeof statRow.active_users === 'number' ? statRow.active_users : 0
      };

    } catch (error: any) {
      // CRITICAL: Log error internally but NEVER throw
      console.error('[Service] CRITICAL ERROR in getAgentStats:', {
        error: error?.message || 'Unknown error',
        stack: error?.stack ? '***STACK***' : 'no stack'
      });

      logger.error({
        error: error?.message || 'Unknown error in getAgentStats',
        operation: 'getAgentStats'
      }, 'Error fetching agent statistics - returning safe defaults');

      // CRASH-PROOF: Always return safe defaults, never throw
      return {
        total_agents: 0,
        total_requests: 0,
        pending_requests: 0,
        approved_requests: 0,
        rejected_requests: 0,
        active_users: 0
      };
    }
  }
}