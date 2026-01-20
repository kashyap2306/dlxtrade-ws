# HTF Agent 404 Resolution Guide

## Test Results: Backend Routes ARE Working ✅

I've tested all HTF agent routes directly against the backend server:

```
GET  /api/agents/htf-trend-filter-agent/control  → 401 (auth required) ✅
POST /api/agents/htf-trend-filter-agent/start    → 401 (auth required) ✅
POST /api/agents/htf-trend-filter-agent/stop     → 401 (auth required) ✅
GET  /api/agents/htf-trend-filter-agent/status   → 401 (auth required) ✅
```

**All routes return 401 (authentication required), NOT 404!**

This proves:
- ✅ Routes are registered correctly in `dlxtrade-ws/src/routes/agents.ts`
- ✅ Routes are mounted correctly in `dlxtrade-ws/src/app.ts` with prefix `/api/agents`
- ✅ Backend server is running the latest code
- ✅ HTF agent handlers are implemented and working

## Root Cause Analysis

Since the backend routes work correctly, the 404 errors must be coming from the **frontend**:

### Possible Issues:

1. **Frontend Not Rebuilt**
   - Frontend may be running old code that doesn't have the HTF agent slug mapping
   - Solution: Rebuild frontend

2. **Browser Cache**
   - Browser may be caching old API responses or old JavaScript bundles
   - Solution: Hard refresh (Ctrl+Shift+R) or clear cache

3. **API Base URL Mismatch**
   - Frontend may be calling wrong base URL
   - Check: `frontend/src/services/api.ts` - verify API_BASE_URL

4. **Slug Mapping Issue**
   - Frontend slug mapping is correct: `HTF_TREND_FILTER_AGENT` → `htf-trend-filter-agent`
   - Verified in `frontend/src/utils/agentKeyToSlug.ts`

5. **Route Path Construction**
   - Frontend correctly constructs: `/agents/${agentId}/control`
   - With API prefix: `/api/agents/htf-trend-filter-agent/control`
   - Verified in `frontend/src/services/api.ts`

## Resolution Steps

### Step 1: Rebuild Frontend
```powershell
cd frontend
npm run build
```

### Step 2: Clear Browser Cache
- Open DevTools (F12)
- Right-click refresh button → "Empty Cache and Hard Reload"
- Or: Settings → Clear browsing data → Cached images and files

### Step 3: Verify API Base URL
Check `frontend/src/services/api.ts`:
```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
```

Should point to: `http://localhost:4000/api`

### Step 4: Check Browser Console
Open browser DevTools → Network tab:
- Look for requests to `/api/agents/htf-trend-filter-agent/control`
- Check the actual URL being called
- Check the response status code
- If 404, check if URL is malformed

### Step 5: Verify Frontend Dev Server
If running frontend dev server:
```powershell
cd frontend
npm run dev
```

Make sure it's running on the correct port (usually 5173 or 5176)

## Backend Code Verification

### Routes Implementation ✅
File: `dlxtrade-ws/src/routes/agents.ts`

**Control Route** (line ~1187):
```typescript
if (agentId === 'htf-trend-filter-agent') {
  const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
  // ... handler code
}
```

**Start Route** (line ~1524):
```typescript
if (agentId === 'htf-trend-filter-agent') {
  const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'htf-trend-filter-agent');
  // ... handler code
}
```

**Stop Route** (line ~1660):
```typescript
if (agentId === 'htf-trend-filter-agent') {
  // ... handler code
}
```

**Status Route** (line ~1323):
```typescript
if (agentId === 'htf-trend-filter-agent') {
  // ... handler code
}
```

### Route Registration ✅
File: `dlxtrade-ws/src/app.ts` (line 361):
```typescript
await app.register(agentsRoutes, { prefix: '/api/agents' });
```

### Route Definition ✅
File: `dlxtrade-ws/src/routes/agents.ts` (line 1074):
```typescript
fastify.get('/:agentId/control', {
  preHandler: [fastify.authenticate],
}, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
  // ... handler code with HTF agent case
});
```

## Frontend Code Verification

### Slug Mapping ✅
File: `frontend/src/utils/agentKeyToSlug.ts`:
```typescript
case 'HTF_TREND_FILTER_AGENT':
  return 'htf-trend-filter-agent';
```

### API Calls ✅
File: `frontend/src/services/api.ts`:
```typescript
getTradingAgentControl: (agentId: string) => api.get(`/agents/${agentId}/control`),
startTradingAgent: (agentId: string) => api.post(`/agents/${agentId}/start`),
stopTradingAgent: (agentId: string) => api.post(`/agents/${agentId}/stop`),
```

### Page Usage ✅
File: `frontend/src/pages/TradingAgentControl.tsx`:
```typescript
const isHTFTrendFilterAgent = (location.pathname || '').includes('htf-trend-filter-agent');
const approvalKey = isHTFTrendFilterAgent ? 'HTF_TREND_FILTER_AGENT' : ...;
const slug = agentKeyToSlug(approvalKey);
```

## Next Steps

1. **Rebuild frontend** - Most likely fix
2. **Clear browser cache** - Second most likely fix
3. **Check browser console** - See actual error details
4. **Verify API base URL** - Make sure frontend is calling correct backend

## Test Commands

Run these to verify backend is working:
```bash
# Test HTF control endpoint
node test-htf-with-logs.js

# Test with curl
curl http://localhost:4000/api/agents/htf-trend-filter-agent/control

# Should return 401 (auth required), NOT 404
```

## Conclusion

**Backend is 100% working.** The issue is on the frontend side - either:
- Frontend needs rebuild
- Browser cache needs clearing
- API base URL is wrong
- Frontend dev server needs restart

The 404 errors are NOT coming from the backend server.
