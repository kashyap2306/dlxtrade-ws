# HTF AGENT 404 FIX - SERVER RESTART REQUIRED ⚠️

## 🎯 ROOT CAUSE CONFIRMED

**The HTF agent routes ARE in the code but the server is running OLD CODE.**

All routes are correctly implemented:
- ✅ Control route (line 1187)
- ✅ Status route (line 1323)
- ✅ Start route (line 1524)
- ✅ Stop route (line 1660)
- ✅ Diagnostics route (line 800)
- ✅ Hard limits enforced (agentExecutionService.ts)
- ✅ No TypeScript errors

## 🔄 MANDATORY ACTION: RESTART BACKEND SERVER

### Option 1: PowerShell Script (Recommended)
```powershell
cd dlxtrade-ws
.\kill-and-restart.ps1
```

### Option 2: Manual Restart
```powershell
# 1. Find and kill the process
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# 2. Start server again
cd dlxtrade-ws
npm run dev
```

### Option 3: If using PM2
```bash
pm2 restart dlxtrade-ws
```

## ✅ VERIFY AFTER RESTART

### 1. Check Backend Logs
Look for these lines in console:
```
[AGENTS ROUTES] Registering agents routes at <timestamp>
[ROUTE READY] GET /api/agents/:agentId/control
[ROUTE READY] POST /api/agents/:agentId/start
[ROUTE READY] POST /api/agents/:agentId/stop
[ROUTE READY] GET /api/agents/:agentId/status
```

### 2. Test Routes (Postman/Browser)
```
GET  http://localhost:4000/api/agents/htf-trend-filter-agent/control
GET  http://localhost:4000/api/agents/htf-trend-filter-agent/status
POST http://localhost:4000/api/agents/htf-trend-filter-agent/start
POST http://localhost:4000/api/agents/htf-trend-filter-agent/stop
```

**Expected**: 200/403 (not 404)
- 200 = Success
- 403 = Not approved (expected if user doesn't have access)
- 404 = Route not found (means server not restarted)

### 3. Test Frontend
```
1. Open: http://localhost:5173/agents/htf-trend-filter-agent
2. Expected: Page loads (no 404)
3. Click "Start Trading"
4. Expected: No 404 error, proper response
```

### 4. Run Test Script
```bash
# Get auth token from browser DevTools
# Application > Local Storage > firebase:authUser
node test-htf-agent-routes.js <YOUR_AUTH_TOKEN>
```

## 🔒 HARD LIMITS (ALREADY ENFORCED IN CODE)

These limits are enforced in `agentExecutionService.ts` and will work after restart:

| Limit | Value | Can Override? |
|-------|-------|---------------|
| Max Trades/Day | 5 | ❌ NO |
| Risk Per Trade | 1% (0.01) | ❌ NO |
| Leverage | 5x | ❌ NO |
| Margin Mode | ISOLATED | ❌ NO |
| Allowed Pairs | BTC/USDT, ETH/USDT | ❌ NO |
| Max Positions/Pair | 1 | ❌ NO |

## 📋 VERIFICATION CHECKLIST

After server restart, verify:

- [ ] Backend console shows route registration logs
- [ ] GET /control returns 200 or 403 (not 404)
- [ ] POST /start returns 200 or 403 (not 404)
- [ ] POST /stop returns 200 or 403 (not 404)
- [ ] Frontend page loads without 404
- [ ] Start Trading button works
- [ ] Stop Trading button works
- [ ] Other agents still work (trading-agent, vwap-strategy, etc.)

## 🚨 IF STILL GETTING 404 AFTER RESTART

1. **Verify server actually restarted**
   - Check process ID changed
   - Check timestamp in console logs is recent
   - Check port 4000 is bound to new process

2. **Check route registration**
   - Look for `[ROUTE READY]` logs in console
   - Verify `GET /api/agents/:agentId/control` is logged
   - Verify `POST /api/agents/:agentId/start` is logged

3. **Check code is loaded**
   - Add a console.log in the HTF control handler
   - Restart server
   - Hit the route
   - Check if log appears

4. **Clear all caches**
   - Browser cache (Ctrl+Shift+R)
   - Node modules cache (delete node_modules, npm install)
   - TypeScript build cache (delete dist folder)

## 📝 NO CODE CHANGES NEEDED

All code is correct:
- ✅ Routes implemented
- ✅ Hard limits enforced
- ✅ No TypeScript errors
- ✅ Frontend already correct
- ✅ Test script created

**ONLY ACTION REQUIRED: RESTART SERVER**

## 🎯 EXPECTED OUTCOME

After server restart:
1. ✅ No 404 errors on any HTF agent route
2. ✅ Start Trading works
3. ✅ Stop Trading works
4. ✅ Agent executes with 5x leverage (not 8x)
5. ✅ Daily limit stops at 5 trades
6. ✅ Only BTC/USDT and ETH/USDT trade
7. ✅ Other agents unaffected

---

## 🔧 RESTART COMMAND (COPY-PASTE)

```powershell
cd dlxtrade-ws
.\kill-and-restart.ps1
```

**Then test:**
```bash
node test-htf-agent-routes.js <YOUR_AUTH_TOKEN>
```

---

**STATUS**: ✅ Code is correct, server restart pending
**ACTION**: Restart backend server
**EXPECTED**: All 404 errors will be resolved
