# Crowd Consensus - Quick Test Guide

## 🚀 How to Test the Fix

### Prerequisites
1. Backend server running
2. User logged in
3. Exchange connected in Settings (Bitget recommended)
4. Crowd Consensus agent approved for user

### Test Steps

#### 1. Enable Auto-Trade
```
1. Go to: http://localhost:5173/agents/crowd-consensus
2. Click: "Start Auto Trade" button
3. Verify: Button changes to "Stop Auto Trade"
4. Verify: Status shows "ACTIVE"
```

#### 2. Wait for Scheduler Tick (5 Minutes)
The scheduler runs every 5 minutes. While waiting:
- Check "Scheduler" section shows "RUNNING"
- Note the "Next scan" timestamp

#### 3. Check Server Logs
Look for these logs in your terminal:

```bash
# Scheduler tick
🔄 [CROWD_CONSENSUS_SCHEDULER] Tick - starting execution cycle

# Test mode active
🧪 [CROWD_CONSENSUS] TEST MODE - Generating deterministic consensus positions

# Consensus detected
✅ [CROWD_CONSENSUS] LONG consensus detected

# Execution logs
[CONSENSUS FINAL] { signalCount: 1, signals: [...] }
[EXECUTION BLOCK HIT] { pair: 'BTCUSDT', direction: 'LONG' }
[PLACING ORDER] { exchange: 'bitget', symbol: 'BTCUSDT', side: 'BUY', ... }

# Success
✅ Consensus trade executed successfully
```

#### 4. Check UI - Exchange Consensus Analysis
Scroll to "Exchange Consensus Analysis" section:

**Execution Status Banner:**
- Should show: "✅ Consensus Reached: LONG" (or SHORT)
- Green background
- Shows number of exchanges agreeing

**Exchange Grid:**
- 10 exchanges displayed (Binance, Bybit, OKX, etc.)
- Green boxes = Contributed to consensus (should be 2-10)
- Each shows:
  - Signal (LONG/SHORT/NONE)
  - Confidence %
  - Position count

#### 5. Check Live Trade History
Scroll to "Live Trade History" section:
- New trade should appear
- Shows: Pair, Direction, Entry, SL, TP, RR, Status
- Status should be "OPEN"

#### 6. Check Diagnostics
Click the info icon (ℹ️) next to "Diagnostics":
- All items should show green checkmarks (✅ DONE)
- If any yellow (⏳ PENDING), check the tooltip for reason

---

## 🔍 What to Look For

### ✅ Success Indicators

**Backend Logs:**
- ✅ Scheduler ticking every 5 minutes
- ✅ Test mode generating positions
- ✅ Consensus detected
- ✅ Order placed
- ✅ Trade executed

**Frontend UI:**
- ✅ Execution status banner shows consensus
- ✅ Exchange grid shows contributing exchanges
- ✅ Trade appears in history
- ✅ All diagnostics green

### ⚠️ Common Issues

**Issue 1: No Consensus**
- **Symptom**: Banner shows "⏳ Waiting for Consensus"
- **Cause**: Test mode disabled or not working
- **Fix**: Check `CROWD_CONSENSUS_TEST_MODE` env variable

**Issue 2: Trade Skipped**
- **Symptom**: Consensus reached but no trade in history
- **Cause**: Validation failed
- **Check**: Skipped trades table for reason
- **Common reasons**:
  - RR_TOO_LOW
  - ENTRY_LATE
  - SR_BLOCKED

**Issue 3: Exchange Not Connected**
- **Symptom**: Yellow banner "Exchange not connected"
- **Fix**: Go to Settings → Connect exchange

**Issue 4: Scheduler Not Running**
- **Symptom**: Scheduler shows "NOT RUNNING"
- **Fix**: Restart backend server

---

## 🎯 Expected Results

### Every 5 Minutes (Test Mode):
1. Scheduler ticks
2. Generates consensus (LONG or SHORT)
3. 2-10 exchanges agree
4. Trade executes (if validation passes)
5. UI updates with new trade

### UI Shows:
- ✅ Clear execution status
- ✅ Which exchanges contributed
- ✅ Trade details
- ✅ Skip reason (if validation failed)

---

## 🛠️ Troubleshooting

### Backend Not Logging
```bash
# Check if server is running
ps aux | grep node

# Restart server
cd dlxtrade-ws
npm run dev
```

### Frontend Not Updating
```bash
# Hard refresh browser
Ctrl + Shift + R (Windows/Linux)
Cmd + Shift + R (Mac)

# Check browser console for errors
F12 → Console tab
```

### Test Mode Not Working
```bash
# Check environment variable
echo $CROWD_CONSENSUS_TEST_MODE

# Should be empty or "true"
# If "false", unset it:
unset CROWD_CONSENSUS_TEST_MODE

# Restart server
```

---

## 📊 Test Checklist

- [ ] Auto-trade enabled
- [ ] Scheduler running
- [ ] Waited 5+ minutes
- [ ] Checked server logs
- [ ] Saw consensus in logs
- [ ] Saw execution logs
- [ ] UI shows execution banner
- [ ] UI shows exchange grid
- [ ] Trade in history table
- [ ] All diagnostics green

---

## 🎉 Success!

If you see:
- ✅ Consensus banner showing LONG/SHORT
- ✅ Green exchange boxes
- ✅ Trade in history
- ✅ Server logs showing execution

**The fix is working perfectly!**

---

## 📝 Notes

- Test mode is **enabled by default**
- Consensus is **guaranteed** in test mode
- Trades execute **every 5 minutes** (if validation passes)
- To disable test mode: `export CROWD_CONSENSUS_TEST_MODE=false`
- To see random behavior: Disable test mode and restart server

---

## 🚨 If Nothing Happens

1. Check auto-trade is enabled
2. Check scheduler is running
3. Check server logs for errors
4. Check exchange is connected
5. Wait full 5 minutes
6. Refresh page
7. Check browser console for errors

If still not working, check:
- Backend server is running
- No errors in server logs
- User has agent access
- Exchange credentials are valid
