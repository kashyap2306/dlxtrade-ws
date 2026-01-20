# HTF Trend Filter Agent - Quick Reference Card

## ✅ STATUS: ALL ROUTES IMPLEMENTED

All HTF agent routes are correctly implemented in the code. If you're seeing 404 errors, **the server needs to be restarted**.

## 🔄 RESTART SERVER (REQUIRED)

```powershell
cd dlxtrade-ws
.\kill-and-restart.ps1
```

## 🧪 TEST ROUTES

```bash
# Get auth token from browser DevTools
# Application > Local Storage > firebase:authUser
node test-htf-agent-routes.js <YOUR_AUTH_TOKEN>
```

## 📍 IMPLEMENTED ROUTES

| Route | Method | Status | Location |
|-------|--------|--------|----------|
| `/api/agents/htf-trend-filter-agent/control` | GET | ✅ | agents.ts:1187 |
| `/api/agents/htf-trend-filter-agent/status` | GET | ✅ | agents.ts:1323 |
| `/api/agents/htf-trend-filter-agent/start` | POST | ✅ | agents.ts:1524 |
| `/api/agents/htf-trend-filter-agent/stop` | POST | ✅ | agents.ts:1660 |
| `/api/agents/htf-trend-filter-agent/diagnostics` | GET | ✅ | agents.ts:800 |

## 🔒 HARD LIMITS (ENFORCED)

| Limit | Value | Override | Location |
|-------|-------|----------|----------|
| Max Trades/Day | 5 | ❌ NO | agentExecutionService.ts:595 |
| Risk Per Trade | 1% (0.01) | ❌ NO | agentExecutionService.ts:596 |
| Leverage | 5x | ❌ NO | agentExecutionService.ts:597 |
| Allowed Pairs | BTC/USDT, ETH/USDT | ❌ NO | agentExecutionService.ts:310 |
| Max Positions/Pair | 1 | ❌ NO | agentExecutionService.ts:680 |

## ✅ EXPECTED BEHAVIOR

### After Server Restart:
1. ✅ Page loads: `/agents/htf-trend-filter-agent`
2. ✅ Start Trading works (no 404)
3. ✅ Stop Trading works (no 404)
4. ✅ Trades execute with 5x leverage
5. ✅ Daily limit stops at 5 trades
6. ✅ Only BTC/USDT and ETH/USDT trade

## 🐛 TROUBLESHOOTING

### Still Getting 404?
1. Verify server restarted: Check console for `[ROUTE READY]` logs
2. Check URL: Must be `/agents/htf-trend-filter-agent` (with hyphens)
3. Clear browser cache: Hard refresh (Ctrl+Shift+R)
4. Check backend logs: Look for route registration messages

### Agent Not Starting?
1. Check approval: User must have `HTF_TREND_FILTER_AGENT` in Firestore
2. Check exchange: Must be connected in Settings
3. Check logs: Backend will show specific error reason

## 📝 FILES MODIFIED

- ✅ `dlxtrade-ws/src/routes/agents.ts` - All routes added
- ✅ `dlxtrade-ws/src/services/agentExecutionService.ts` - Hard limits enforced
- ✅ `test-htf-agent-routes.js` - Test script created
- ✅ No TypeScript errors
- ✅ No frontend changes needed

## 🎯 NEXT STEPS

1. **Restart server** (required)
2. **Test routes** (use test script)
3. **Verify in browser** (load agent page)
4. **Check backend logs** (confirm route registration)

## 📞 SUPPORT

If issues persist after server restart:
1. Check backend console for errors
2. Run test script to identify specific failing routes
3. Verify Firestore approval: `users/{uid}.approvedAgents` contains `HTF_TREND_FILTER_AGENT`
4. Check exchange connection in Settings
