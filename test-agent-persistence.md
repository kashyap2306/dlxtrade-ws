# Agent Persistence Testing Guide

## Quick Test Commands

### 1. Start Backend (Watch Logs)
```bash
cd dlxtrade-ws
npm run dev
```

**Look for these logs on startup:**
```
[VWAP_PERSISTENCE] Loading persisted VWAP agent states...
[VWAP_PERSISTENCE] ✅ VWAP state restoration completed
[VWAP_PERSISTENCE]    - Restored X running agents
```

### 2. Start Frontend (Separate Terminal)
```bash
cd frontend
npm run dev
```

### 3. Open Browser Console
- Open DevTools (F12)
- Go to Console tab
- Filter for: `VWAP`, `CrowdConsensus`, `TradingAgentControl`

---

## Test Scenarios

### Scenario 1: VWAP Strategy Persistence

#### Step 1: Start Agent
1. Navigate to `/agents/vwap-strategy`
2. Click "Turn ON" button
3. **Check Console:**
   ```
   [VWAP] Status loaded from backend: RUNNING
   ```
4. **Check Backend Logs:**
   ```
   Agent start request received { uid: '...', agentId: 'vwap-strategy' }
   VWAP Strategy runtime started and persisted
   ```

#### Step 2: Verify Persistence
1. Restart backend server (Ctrl+C, then `npm run dev`)
2. **Check Backend Logs:**
   ```
   [VWAP_PERSISTENCE] Loading persisted VWAP agent states...
   Restored VWAP agent state from Firestore
   [VWAP_PERSISTENCE] ✅ VWAP state restoration completed
   [VWAP_PERSISTENCE]    - Restored 1 running agents
   ```

#### Step 3: Verify Frontend Shows Correct Status
1. Refresh browser
2. Navigate to `/agents/vwap-strategy`
3. **Check Console:**
   ```
   [VWAP] Status loaded from backend: RUNNING
   ```
4. **Verify UI:** Status should show "RUNNING" and button should say "Turn OFF"

#### Step 4: Stop Agent
1. Click "Turn OFF" button
2. **Check Console:**
   ```
   [VWAP] Status loaded from backend: STOPPED
   ```
3. **Check Backend Logs:**
   ```
   Agent stop request received { uid: '...', agentId: 'vwap-strategy' }
   VWAP Strategy runtime stopped and persisted
   ```

---

### Scenario 2: Crowd Consensus Button Test

#### Step 1: Navigate to Page
1. Go to `/agents/crowd-consensus`
2. Ensure exchange is connected (check "Exchange Connection" card)

#### Step 2: Click Start Button
1. Click "Start Auto Trade" button
2. **Check Console (CRITICAL):**
   ```
   [CrowdConsensus] Toggle auto trade clicked {
     currentStatus: false,
     exchangeConnected: true,
     togglingAutoTrade: false
   }
   [CrowdConsensus] Calling start API...
   [CrowdConsensus] Start API succeeded
   ```

#### Step 3: Verify Status Changed
1. **Check UI:** Button should now say "Stop Auto Trade"
2. **Check Console:**
   ```
   Auto trade status updated to: ACTIVE
   ```

#### Step 4: Click Stop Button
1. Click "Stop Auto Trade" button
2. **Check Console:**
   ```
   [CrowdConsensus] Toggle auto trade clicked {
     currentStatus: true,
     exchangeConnected: true,
     togglingAutoTrade: false
   }
   [CrowdConsensus] Calling stop API...
   [CrowdConsensus] Stop API succeeded
   ```

#### Step 5: Verify Persistence
1. Restart backend
2. Refresh browser
3. Navigate to `/agents/crowd-consensus`
4. **Verify:** Status should match last known state (ACTIVE or INACTIVE)

---

### Scenario 3: Liquidity Sniper 400 Error Fix

#### Step 1: Navigate to Page
1. Go to `/agents/liquidity_sniper_arbitrage`
2. Ensure exchange is connected

#### Step 2: Click Start Trading
1. Click "Start Trading" button
2. **Check Console (CRITICAL):**
   ```
   [TradingAgentControl] Toggle auto trade {
     slug: 'liquidity_sniper_arbitrage',
     nextEnabled: true,
     hasAgentAccess: true,
     resolvedAgentId: 'liquidity_sniper_arbitrage',
     exchangeConnected: true
   }
   [TradingAgentControl] Calling start API with slug: liquidity_sniper_arbitrage
   [TradingAgentControl] Start API succeeded
   ```
3. **Check Backend Logs:**
   ```
   Agent start request received { uid: '...', agentId: 'liquidity_sniper_arbitrage' }
   Liquidity Sweep Agent started in manual mode - ARMED and waiting for signals
   ```

#### Step 3: Click Stop Trading (THE CRITICAL TEST)
1. Click "Stop Trading" button
2. **Check Console:**
   ```
   [TradingAgentControl] Toggle auto trade {
     slug: 'liquidity_sniper_arbitrage',
     nextEnabled: false,
     ...
   }
   [TradingAgentControl] Calling stop API with slug: liquidity_sniper_arbitrage
   [TradingAgentControl] Stop API succeeded
   ```
3. **Check Backend Logs:**
   ```
   Agent stop request received { uid: '...', agentId: 'liquidity_sniper_arbitrage' }
   ```
4. **VERIFY NO 400 ERROR:** Console should NOT show any red error messages

#### Step 4: Verify Status Updates
1. **Check UI:** Button should say "Start Trading" again
2. **Check Console:** No errors
3. **Check Backend Logs:** No validation errors

---

## Common Issues & Solutions

### Issue: "Agent not approved"
**Solution:** Check Firestore `users/{uid}.approvedAgents` array contains correct agent key:
- VWAP: `'VWAP_STRATEGY'`
- Crowd Consensus: `'COPY_TRADING_AGENT'`
- Liquidity Sniper: `'LIQUIDITY_SWEEP_AGENT'`

### Issue: "Exchange not connected"
**Solution:** Go to Settings → Exchange Connection and connect an exchange first

### Issue: Button does nothing (no console logs)
**Solution:** 
1. Hard refresh browser (Ctrl+Shift+R)
2. Clear browser cache
3. Check if button is disabled (hover to see tooltip)

### Issue: 400 Bad Request
**Check Backend Logs for:**
```
Agent start/stop request received { uid: '...', agentId: '...' }
```
- If agentId is wrong, check frontend slug mapping
- If validation fails, check agent access in Firestore

### Issue: VWAP doesn't auto-resume after restart
**Check Backend Logs for:**
```
[VWAP_PERSISTENCE] Loading persisted VWAP agent states...
```
- If not present, check if `loadPersistedStates()` is called in server.ts
- Check Firestore `users/{uid}/agents/vwap_strategy` document exists with `status: 'RUNNING'`

---

## Firestore Verification

### Check VWAP State
```javascript
// In Firestore Console
users/{uid}/agents/vwap_strategy

Expected fields:
{
  agentId: "vwap_{uid}",
  userId: "{uid}",
  status: "RUNNING" or "STOPPED",
  strategyType: "VWAP_MEAN_REVERSION",
  exchange: "binance",
  startedAt: Timestamp,
  lastHeartbeat: Timestamp,
  updatedAt: Timestamp
}
```

### Check Crowd Consensus State
```javascript
// In Firestore Console
users/{uid}/agents/crowd_consensus_copy_trade

Expected fields:
{
  autoTradeEnabled: true or false,
  lastUpdated: Date
}
```

### Check Liquidity Sniper State
```javascript
// In Firestore Console
tradingAgents/{agentId}

Expected fields:
{
  userId: "{uid}",
  name: "Liquidity Sweep" or similar,
  status: "ACTIVE" or "STOPPED",
  strategyType: "LIQUIDITY_SWEEP",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

---

## Success Criteria

### ✅ VWAP Strategy
- [ ] Start button works
- [ ] Stop button works
- [ ] Status persists across backend restart
- [ ] Frontend shows correct status on page load
- [ ] Console logs show `[VWAP] Status loaded from backend:`

### ✅ Crowd Consensus
- [ ] Start Auto Trade button works
- [ ] Stop Auto Trade button works
- [ ] Console logs show `[CrowdConsensus] Calling start/stop API...`
- [ ] Console logs show `[CrowdConsensus] Start/Stop API succeeded`
- [ ] No errors in console

### ✅ Liquidity Sniper
- [ ] Start Trading button works
- [ ] Stop Trading button works (NO 400 ERROR)
- [ ] Console logs show slug: `liquidity_sniper_arbitrage`
- [ ] Backend logs show agentId: `liquidity_sniper_arbitrage`
- [ ] No validation errors

---

## Quick Debug Commands

### Check Backend Logs
```bash
# In dlxtrade-ws directory
npm run dev | grep -E "(VWAP|Agent|liquidity|crowd)"
```

### Check Frontend Console
```javascript
// In browser console
localStorage.clear(); // Clear any cached state
location.reload(); // Hard reload
```

### Check Firestore
```bash
# Use Firebase Console or CLI
firebase firestore:get users/{uid}/agents/vwap_strategy
firebase firestore:get users/{uid}/agents/crowd_consensus_copy_trade
```

---

## Final Verification

After all tests pass:

1. **Restart both servers** (backend and frontend)
2. **Clear browser cache** (Ctrl+Shift+Delete)
3. **Test all three agents** in sequence
4. **Verify no console errors**
5. **Verify backend logs show correct persistence**

If all tests pass, the fix is complete! ✅
