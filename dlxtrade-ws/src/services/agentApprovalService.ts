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
    // Disabled
    return { success: true, source: 'firebase_only' } as any;
  }

  /**
   * Get pending agent requests (admin only)
   * CRASH-PROOF: Never throws, handles all array operations safely
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async getPendingRequests(): Promise<(AgentRequest & { agent_name: string; user_email?: string })[]> {
    // Disabled
    return [];
  }

  /**
   * Approve an agent request
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async approveAgentRequest(requestId: number, approvedBy: string): Promise<any> {
    // Disabled
    return { success: true };
  }

  /**
   * Reject an agent request
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async rejectAgentRequest(requestId: number, rejectedBy: string, reason?: string): Promise<any> {
    // Disabled
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
    // Disabled
    return [];
  }

  /**
   * Check if user has access to a specific agent
   * CRASH-PROOF: Never throws, returns false on any error
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async userHasAgentAccess(userId: string, agentId: string): Promise<boolean> {
    try {
      if (!userId || typeof userId !== 'string' || !agentId || typeof agentId !== 'string') {
        return false;
      }

      const normalizedApprovalKey = (() => {
        const a = agentId.trim();
        const lower = a.toLowerCase();
        switch (lower) {
          case 'trading-agent':
            return 'TRADING_AGENT';
          case 'vwap-strategy':
            return 'VWAP_STRATEGY';
          case 'crowd-consensus':
            return 'COPY_TRADING_AGENT';
          case 'bb-rsi-scalper':
            return 'BB_RSI_EMA200_SCALPER';
          case 'htf-trend-filter-agent':
            return 'HTF_TREND_FILTER_AGENT';
          default:
            return a;
        }
      })();

      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const userDoc = await db.collection('users').doc(userId.trim()).get();
      if (!userDoc.exists) {
        return false;
      }

      const approvedAgents: unknown = userDoc.data()?.approvedAgents;
      if (!Array.isArray(approvedAgents)) {
        return false;
      }

      return approvedAgents.includes(normalizedApprovalKey);
    } catch (error: any) {
      logger.warn(
        {
          uid: userId ? '***MASKED***' : 'null',
          agentId,
          error: error?.message || 'unknown',
        },
        'userHasAgentAccess: returning false due to error',
      );
      return false;
    }
  }

  /**
   * Get user's agent requests
   * CRASH-PROOF: Never throws, handles all operations safely
   */
  // Firebase-only flow — PostgreSQL disabled intentionally
  static async getUserAgentRequests(userId: string): Promise<AgentRequest[]> {
    // Disabled
    return [];
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