# Agent Request & Admin Approval System - Complete Workflow Documentation

## System Overview

The Agent Approval System is a secure, scalable, role-based access control system that manages premium agent access through a structured request-approval workflow. Users request access to agents, admins review and approve/reject requests, and approved users gain immediate access to agents in their sidebar.

## Database Schema

### Tables

#### `agents`
Core agent definitions with pricing and features.

```sql
CREATE TABLE agents (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(50) UNIQUE NOT NULL,           -- e.g., 'TRADING_AGENT'
  name VARCHAR(255) NOT NULL,                     -- Display name
  description TEXT,                               -- Agent description
  category VARCHAR(50),                           -- e.g., 'Trading Bot'
  price DECIMAL(10, 2),                          -- One-time price
  features JSONB,                                -- Array of feature strings
  icon VARCHAR(10),                              -- Emoji icon
  badge VARCHAR(50),                             -- e.g., 'Premium'
  is_active BOOLEAN DEFAULT true,                 -- Active status
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### `agent_requests`
User requests for agent access, pending admin approval.

```sql
CREATE TABLE agent_requests (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,                  -- Firebase UID
  agent_id VARCHAR(50) NOT NULL,                  -- Requested agent
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
  requested_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  approved_by VARCHAR(255),                       -- Admin Firebase UID
  rejected_at TIMESTAMP,
  rejected_by VARCHAR(255),
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, agent_id),
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
);
```

#### `user_agents`
Granted agent access after approval.

```sql
CREATE TABLE user_agents (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,                  -- Firebase UID
  agent_id VARCHAR(50) NOT NULL,                  -- Granted agent
  granted_at TIMESTAMP DEFAULT NOW(),
  granted_by VARCHAR(255),                        -- Admin Firebase UID
  is_active BOOLEAN DEFAULT true,                 -- Can revoke access
  expires_at TIMESTAMP,                           -- Optional expiration
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, agent_id),
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
);
```

### Indexes
```sql
CREATE INDEX idx_agent_requests_user_id ON agent_requests(user_id);
CREATE INDEX idx_agent_requests_status ON agent_requests(status);
CREATE INDEX idx_agent_requests_agent_id ON agent_requests(agent_id);
CREATE INDEX idx_user_agents_user_id ON user_agents(user_id);
CREATE INDEX idx_user_agents_agent_id ON user_agents(agent_id);
CREATE INDEX idx_user_agents_active ON user_agents(is_active);
```

## User Flow

### 1. Agent Discovery & Request
**Location**: `/agents` (Agents Marketplace page)

**User Actions**:
1. Browse available premium agents
2. Click "🎯 Request Agent" button
3. Confirm request submission

**System Actions**:
1. Validate user authentication
2. Check for existing pending/approved requests
3. Create `agent_requests` record with `PENDING_APPROVAL` status
4. Show success toast: "Request submitted! Awaiting admin approval"

### 2. Admin Review
**Location**: `/admin/unlock-requests` (Admin Unlock Requests page)

**Admin Actions**:
1. View pending requests with user details
2. Review agent type and user information
3. Click "✓ Approve" or "✗ Deny"

**System Actions (Approval)**:
1. Update `agent_requests` status to `APPROVED`
2. Set `approved_at` and `approved_by` timestamps
3. Create `user_agents` record for granted access
4. Log approval in audit logs

**System Actions (Rejection)**:
1. Update `agent_requests` status to `REJECTED`
2. Set `rejected_at`, `rejected_by`, and optional `rejection_reason`
3. Log rejection in audit logs

### 3. User Access Activation
**Automatic Process - No Manual Intervention Required**

**System Actions**:
1. Sidebar dynamically loads approved agents via `GET /api/agents/my-approved`
2. Agent links appear in sidebar navigation
3. Users can access agent pages immediately
4. Backend validates access on each agent route

## API Endpoints

### Agent Marketplace
```typescript
GET    /api/agents/available           // Get all available agents
POST   /api/agents/request             // Create agent request
GET    /api/agents/my-requests         // Get user's requests
GET    /api/agents/my-approved         // Get user's approved agents
```

### Admin Management
```typescript
GET    /api/admin/agents/requests      // Get pending requests
POST   /api/admin/agents/approve       // Approve request
POST   /api/admin/agents/reject        // Reject request
DELETE /api/admin/agents/revoke        // Revoke access
GET    /api/admin/agents/stats         // Get statistics
```

## Security Rules

### Access Control
- **No Sidebar Access**: Agents don't appear in sidebar without approval
- **Backend Validation**: All agent routes validate access via middleware
- **UI Checks Alone Insufficient**: Frontend checks are for UX only
- **Admin-Only Operations**: Approval/rejection requires admin role

### Validation Middleware
```typescript
// Applied to all agent-specific routes
function agentAccessValidationMiddleware(request, reply) {
  const user = request.user;
  const agentId = request.params.agentId;

  // Check user_agents table for active access
  const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, agentId);

  if (!hasAccess) {
    return reply.code(403).send({
      error: 'Agent access not granted yet',
      message: 'You need admin approval to access this agent...'
    });
  }
}
```

## Frontend Components

### AgentsMarketplace (`/agents`)
- Displays available agents with pricing
- "Request Agent" buttons create approval requests
- Shows request status and handles errors

### AdminUnlockRequests (`/admin/unlock-requests`)
- Lists pending requests with user/agent details
- Approve/Deny buttons with confirmation
- Real-time updates every 10 seconds

### AdminAgentsManager (`/admin/agents`)
- Statistics dashboard (total agents, requests, users)
- Quick actions for request management
- Agent details and system overview

### Sidebar (Global Navigation)
- Dynamically loads approved agents on login
- Queries `GET /api/agents/my-approved` for user's agents
- Updates agent menu items based on approval status

## Backend Services

### AgentApprovalService
Core business logic for agent approval workflow:

```typescript
class AgentApprovalService {
  // Agent management
  static async getAllAgents()
  static async getAgentById(agentId: string)

  // Request management
  static async createAgentRequest(requestData)
  static async getPendingRequests()
  static async approveAgentRequest(requestId, approvedBy)
  static async rejectAgentRequest(requestId, rejectedBy, reason)

  // Access control
  static async getUserApprovedAgents(userId)
  static async userHasAgentAccess(userId, agentId)

  // Admin tools
  static async revokeAgentAccess(userId, agentId, revokedBy)
  static async getAgentStats()
}
```

### Agent Access Middleware
Validates agent access on protected routes:

```typescript
export async function agentAccessValidationMiddleware(request, reply) {
  // Validates user has approved access to specific agent
  // Returns 403 if access denied
  // Continues to route handler if access granted
}
```

## Error Handling

### User-Facing Errors
- **Request Creation**: "You already have a pending request" / "Access already granted"
- **Access Denied**: "Agent access not granted yet. Please request access from Agents page"
- **Network Errors**: "Failed to submit request. Please try again"

### Admin Errors
- **Invalid Request**: Request not found or already processed
- **Permission Denied**: Non-admin attempting admin operations
- **Database Errors**: Logged and returned as generic "Operation failed"

## Monitoring & Analytics

### Statistics Available
- Total agents in system
- Total/pending/approved/rejected requests
- Active users with agent access
- Approval/rejection rates
- Average users per agent

### Audit Logging
All approval actions are logged with:
- User ID performing action
- Agent affected
- Timestamp
- Action type (approve/reject/revoke)

## Production Readiness

### Scalability
- PostgreSQL indexes on frequently queried columns
- Efficient queries with proper JOINs
- Connection pooling via pg.Pool

### Security
- Role-based access control
- Input validation via Zod schemas
- SQL injection prevention via parameterized queries
- Firebase UID validation

### Reliability
- Transaction-wrapped critical operations
- Proper error handling and logging
- Graceful fallbacks for network issues
- Timeout handling for database operations

### Maintainability
- Clean separation of concerns
- Comprehensive TypeScript interfaces
- Clear API documentation
- Modular service architecture

## Testing Scenarios

### Happy Path
1. User requests agent → Request created successfully
2. Admin approves → User gains immediate sidebar access
3. User accesses agent → Full functionality available

### Edge Cases
1. **Duplicate Requests**: System prevents multiple pending requests
2. **Race Conditions**: Database constraints prevent conflicts
3. **Expired Sessions**: Proper authentication validation
4. **Network Failures**: Transaction rollbacks maintain consistency

### Security Testing
1. **Unauthorized Access**: Non-approved users blocked from agent routes
2. **Admin Privilege Escalation**: Non-admins cannot approve requests
3. **Data Leakage**: Users can only see their own requests/agents

## Deployment Checklist

### Database
- [ ] Run migration scripts for new tables
- [ ] Seed agent data
- [ ] Create indexes
- [ ] Verify foreign key constraints

### Backend
- [ ] Deploy new API routes
- [ ] Update middleware configuration
- [ ] Test service methods
- [ ] Verify authentication integration

### Frontend
- [ ] Update API service calls
- [ ] Test component integrations
- [ ] Verify error handling
- [ ] Test responsive design

### Security
- [ ] Audit database permissions
- [ ] Review API authentication
- [ ] Test access control middleware
- [ ] Validate input sanitization

This system provides a complete, production-ready agent approval workflow with proper security, scalability, and user experience considerations.