# Research Engine End-to-End Test Guide

## Overview
This guide walks you through testing the Research Engine with full debug logging to verify that indicators are returning real values (not fallback values).

## Prerequisites
- Backend server must be running
- Node.js installed
- Valid Firebase authentication token (optional, but recommended)

## STEP 1 — Start Backend in Full Debug Mode

### Option A: Development Mode (Recommended for Testing)
```bash
cd c:\Users\yash\dlxtrade\dlxtrade-ws
npm run dev
```

### Option B: Production Mode
```bash
cd c:\Users\yash\dlxtrade\dlxtrade-ws
npm run build
npm start
```

### Verify Startup Logs
When the server starts, you should see:
- `🔍 [RESEARCH_ENGINE] ResearchEngine Module Loading`
- `🔍 [RESEARCH_ENGINE] File Path: ...`
- Server listening on port 4000

**Keep this terminal open** - all debug logs will appear here.

## STEP 2 — Run Live Test Request

### Option A: Using the Test Script (Recommended)
```bash
# Without authentication (will fail with 401, but shows structure)
node scripts/test-research-engine-e2e.js

# With authentication token
node scripts/test-research-engine-e2e.js YOUR_FIREBASE_TOKEN
```

### Option B: Using curl
```bash
curl -X POST http://localhost:4000/api/research/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"symbol": "BTCUSDT", "timeframe": "5m"}'
```

### Option C: Using Postman/Insomnia
- **Method**: POST
- **URL**: `http://localhost:4000/api/research/run`
- **Headers**: 
  - `Content-Type: application/json`
  - `Authorization: Bearer YOUR_FIREBASE_TOKEN`
- **Body**:
```json
{
  "symbol": "BTCUSDT",
  "timeframe": "5m"
}
```

### Getting Your Firebase Token
1. Open the frontend app (http://localhost:5173)
2. Login
3. Open browser console (F12)
4. Run: `localStorage.getItem("firebaseToken")`
5. Copy the token

## STEP 3 — Capture and Analyze Raw Backend Logs

Watch the **server console** for the following debug logs:

### 1. REQUEST RECEIVED (STEP 1)
Look for:
```
🔍 [DEBUG] [STEP 1] REQUEST RECEIVED
🔍 [DEBUG] [STEP 1] Original Symbol: BTCUSDT
🔍 [DEBUG] [STEP 1] Normalized Symbol: BTCUSDT
🔍 [DEBUG] [STEP 1] Timeframe: 5m
🔍 [DEBUG] [STEP 1] Adapter name: binance (or bitget, etc.)
🔍 [DEBUG] [STEP 1] Final timeframe string passed to adapter.getKlines(): 5m
🔍 [DEBUG] [STEP 1] Has adapter: true
🔍 [DEBUG] [STEP 1] Has getKlines function: true
```

**Verify:**
- ✅ Symbol is normalized (uppercase)
- ✅ Timeframe is correct
- ✅ Adapter is available
- ✅ getKlines function exists

### 2. KLINES FETCH (STEP 2 - Adapter Logs)
Look for:
```
🔍 [DEBUG] [ADAPTER] [BINANCE] getKlines() called
🔍 [DEBUG] [ADAPTER] [BINANCE] Final URL/endpoint: https://...
🔍 [DEBUG] [ADAPTER] [BINANCE] Symbol: BTCUSDT
🔍 [DEBUG] [ADAPTER] [BINANCE] Interval: 5m
🔍 [DEBUG] [ADAPTER] [BINANCE] Response status: SUCCESS
🔍 [DEBUG] [ADAPTER] [BINANCE] Candle array length: 100
🔍 [DEBUG] [ADAPTER] [BINANCE] First 3 candles: [...]
🔍 [DEBUG] [ADAPTER] [BINANCE] Last 3 candles: [...]
```

**Verify:**
- ✅ API endpoint is correct
- ✅ Interval parameter is correct (5m)
- ✅ Candle array length ≥ 50 (need at least 50 for all indicators)
- ✅ First and last candles contain valid data
- ❌ If length is 0 → API is returning empty data (check exchange credentials)

### 3. CALCULATE_FEATURES START (STEP 3)
Look for:
```
🔍 [DEBUG] [STEP 3] FEATURE ENGINE START
🔍 [DEBUG] [STEP 3] calculateFeatures() called
🔍 [DEBUG] [STEP 3]   symbol: BTCUSDT
🔍 [DEBUG] [STEP 3]   timeframe: 5m
🔍 [DEBUG] [STEP 3] Inside calculateFeatures() - RSI section
🔍 [DEBUG] [STEP 3] candles.length: 100
🔍 [DEBUG] [STEP 3] close[] length: 100, empty: false
🔍 [DEBUG] [STEP 3] close[] sample values (first 3): [65000, 65050, 65100]
🔍 [DEBUG] [STEP 3] high[] length: 100, empty: false
🔍 [DEBUG] [STEP 3] low[] length: 100, empty: false
🔍 [DEBUG] [STEP 3] volume[] length: 100, empty: false
```

**Verify:**
- ✅ Candles array has data (length > 0)
- ✅ close[], high[], low[], volume[] arrays are not empty
- ✅ Sample values are real numbers (not 0, not null)

### 4. INDICATOR BLOCKS (STEP 4-6)
Look for:

**RSI:**
```
🔍 [DEBUG] [STEP 4] RSI Candle Count: 100
🔍 [DEBUG] [RSI] Calculating RSI...
🔍 [DEBUG] [RSI] RSI calculation result: value=65.5, signal=Overbought
```

**MACD:**
```
🔍 [DEBUG] [STEP 5] MACD Candle Count: 100
🔍 [DEBUG] [MACD] Calculating MACD...
🔍 [DEBUG] [MACD] MACD calculation result: signal=0.5, histogram=0.2, trend=BULLISH
```

**ATR:**
```
🔍 [DEBUG] [STEP 6] ATR Candle Count: 100
🔍 [DEBUG] [ATR] Calculating ATR...
🔍 [DEBUG] [ATR] ATR calculation result: atr=500, volatilityValue=500, volatilityScore=Medium
```

**Orderbook:**
```
🔍 [DEBUG] [ORDERBOOK] Calculating Orderbook Imbalance...
🔍 [DEBUG] [ORDERBOOK] Top 5 bids: [...]
🔍 [DEBUG] [ORDERBOOK] Top 5 asks: [...]
🔍 [DEBUG] [ORDERBOOK] buyVolume: 1234.56, sellVolume: 987.65
🔍 [DEBUG] [ORDERBOOK] Orderbook imbalance calculation result: value=11.2, signal=Bullish
```

**Verify:**
- ✅ Each indicator has sufficient candles (RSI≥14, MACD≥26, ATR≥15, Trend≥50)
- ✅ Calculations complete without errors
- ✅ Results are real numbers (not fallback values)

### 5. FINAL RESULT LOG
Look for:
```
🔍 [DEBUG] [INDICATORS] FINAL INDICATOR VALUES SUMMARY
🔍 [DEBUG] [INDICATORS]   rsi14Value: 65.5 (REAL VALUE)
🔍 [DEBUG] [INDICATORS]   macdData: {signal: 0.5, histogram: 0.2, trend: 'BULLISH'} (REAL VALUE)
🔍 [DEBUG] [INDICATORS]   volumeIndicator: 1234567.89 (REAL VALUE)
🔍 [DEBUG] [INDICATORS]   trendStrengthIndicator: {ema20: 65000, ema50: 64500, trend: 'BULLISH'} (REAL VALUE)
🔍 [DEBUG] [INDICATORS]   volatilityIndicator: 500 (REAL VALUE)
🔍 [DEBUG] [INDICATORS]   orderbookIndicator: 11.2 (REAL VALUE)
```

**Verify:**
- ✅ All indicators show "(REAL VALUE)" not "(NULL - no fallback)"
- ✅ No errors about fallback values detected

## STEP 4 — Confirm Rules Are Working

### Check Response JSON
The API response should contain:

```json
{
  "success": true,
  "result": {
    "indicators": {
      "rsi": 65.5,  // ✅ NOT 50
      "macd": {
        "signal": 0.5,  // ✅ NOT 0
        "histogram": 0.2,  // ✅ NOT 0
        "trend": "BULLISH"
      },
      "volume": 1234567.89,  // ✅ NOT "Stable"
      "trendStrength": {
        "ema20": 65000,
        "ema50": 64500,
        "trend": "BULLISH"  // ✅ NOT "Weak"
      },
      "volatility": 500,  // ✅ NOT "Low" (should be number)
      "orderbook": 11.2  // ✅ NOT 0% (unless truly balanced)
    },
    "accuracy": 0.75,  // ✅ Real accuracy value
    "entrySignal": "LONG",  // ✅ If accuracy ≥ 60%
    "exitSignal": [...],
    "apisUsed": ["Binance", "CoinAPI"]  // ✅ List of APIs
  }
}
```

### Red Flags (Fallback Values - TEST FAILS)
- ❌ `rsi: 50` → Fallback value detected
- ❌ `macd: {signal: 0, histogram: 0}` → Fallback value detected
- ❌ `volume: "Stable"` → Fallback value detected
- ❌ `trendStrength: {trend: "Weak"}` without EMA values → Fallback value detected
- ❌ `volatility: "Low"` → Should be a number (ATR value)
- ❌ `orderbook: 0` → Might be real, but verify

### Acceptable Values
- ✅ `rsi: null` → No data available (acceptable)
- ✅ `macd: null` → No data available (acceptable)
- ✅ `volume: null` → No data available (acceptable)
- ✅ `trendStrength: null` → No data available (acceptable)
- ✅ `volatility: null` → No data available (acceptable)
- ✅ `orderbook: null` → No data available (acceptable)

**Key Rule:** If candles < 15, indicators should be `null`, NEVER fallback values.

## STEP 5 — Frontend Validation

1. Open the frontend app: http://localhost:5173
2. Navigate to Deep Research
3. Enter: `BTCUSDT` and select `5m` timeframe
4. Click "Run Research"

### Verify:
- ✅ Processing steps show correctly
- ✅ Final green tick only appears after backend finished
- ✅ All 6 indicators always visible
- ✅ If value is null → Shows "No Data" (NOT hidden)
- ✅ Signals hidden if accuracy < 60%
- ✅ Signals visible if accuracy ≥ 60%
- ✅ AUTO badge if accuracy ≥ 75%
- ✅ APIs Used list shows all APIs with logos

## STEP 6 — Final Confirmation

After the test completes, verify:

### Test Script Output
If using the test script, it will show:
```
[PASSED] Checks that passed:
  ✅ RSI: 65.5 (real value)
  ✅ MACD: signal=0.5, histogram=0.2 (real value)
  ✅ Volume: 1234567.89 (real value)
  ✅ TrendStrength: {...} (real value)
  ✅ Volatility: 500 (real value)
  ✅ Orderbook: 11.2% (real value)
  ✅ Accuracy: 75.0%
  ✅ Signals generated: entry=LONG, exit=yes
  ✅ APIs Used: Binance, CoinAPI

[RESULT] ✅ TEST PASSED - No fallback values detected!
```

### Manual Verification Checklist
- [ ] Candle count received: ≥ 50
- [ ] Orderbook received: Top 5 bids/asks visible
- [ ] RSI value: Real number (not 50)
- [ ] MACD value: Real numbers (not 0/0)
- [ ] Volume value: Real number (not "Stable")
- [ ] TrendStrength value: Real EMA values (not "Weak")
- [ ] Volatility value: Real ATR number (not "Low")
- [ ] Orderbook imbalance: Real percentage (not always 0%)
- [ ] Accuracy value: Real percentage (40-90%)
- [ ] Signals: Generated if accuracy ≥ 60%
- [ ] APIs called: List visible in response

## Troubleshooting

### Issue: All indicators are null
**Possible Causes:**
1. Exchange API returning empty data
   - Check exchange credentials
   - Verify symbol format (should be BTCUSDT, not BTC/USDT)
   - Check if exchange supports the timeframe

2. Adapter not initialized
   - Check if adapter.getKlines function exists
   - Verify adapter is connected to exchange

3. Network issues
   - Check internet connection
   - Verify exchange API is accessible

**Solution:** Check STEP 2 logs - if candle array length is 0, the API is not returning data.

### Issue: Indicators show fallback values
**Possible Causes:**
1. Code is using fallback values instead of null
   - Check if any fallback values are hardcoded
   - Verify error handling returns null, not fallback

2. Frontend is showing fallback values
   - Check frontend code for default values
   - Verify frontend handles null correctly

**Solution:** Check STEP 5 logs - should show "(REAL VALUE)" not fallback values.

### Issue: API errors in logs
**Possible Causes:**
1. Invalid timeframe format
   - Verify timeframe is normalized (5m, not 5M or 5 min)
   - Check if exchange supports the timeframe

2. Invalid symbol format
   - Verify symbol is uppercase (BTCUSDT, not btcusdt)
   - Check if symbol exists on exchange

3. Exchange API rate limits
   - Check if too many requests
   - Add delays between requests

**Solution:** Check STEP 2 logs - error messages will show the exact issue.

## Success Criteria

✅ **TEST PASSES IF:**
- All indicators return real values OR null (never fallback values)
- Candle count ≥ 50
- Orderbook data received
- Accuracy is calculated (40-90%)
- Signals generated if accuracy ≥ 60%
- APIs used list is populated
- No errors in console logs

❌ **TEST FAILS IF:**
- Any indicator shows fallback value (RSI=50, MACD=0/0, Volume="Stable", etc.)
- Candle count is 0
- All indicators are null AND candles were received
- Errors in console logs

## Next Steps

If the test passes:
- ✅ Research Engine is working correctly
- ✅ Indicators are using real data
- ✅ No fallback values are being used

If the test fails:
1. Review the debug logs (STEP 1-6)
2. Identify which step is failing
3. Fix the root cause
4. Re-run the test
5. Repeat until test passes

---

**Last Updated:** After implementing comprehensive debug logging and fixes

