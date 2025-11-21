# Extracted Logs Instructions

## Overview
The Research Engine has been updated to output logs in the exact format you requested. When you run a BTCUSDT 5m research request, the server console will show ONLY these sections:

## Log Format

### 1) getKlines Candle Count
```
═══════════════════════════════════════════════════════════
📊 [EXTRACTED LOGS] 1) getKlines CANDLE COUNT
═══════════════════════════════════════════════════════════
Candle Count: 100
```

### 2) First 3 & Last 3 Candles
```
═══════════════════════════════════════════════════════════
📊 [EXTRACTED LOGS] 2) FIRST 3 & LAST 3 CANDLES
═══════════════════════════════════════════════════════════
First 3 candles:
[...]

Last 3 candles:
[...]
```

### 3) Parsed Arrays Lengths
```
═══════════════════════════════════════════════════════════
📊 [EXTRACTED LOGS] 3) PARSED ARRAYS LENGTHS
═══════════════════════════════════════════════════════════
close[] length: 100
high[] length: 100
low[] length: 100
volume[] length: 100
```

### 4) Indicator Candle Counts
```
═══════════════════════════════════════════════════════════
📊 [EXTRACTED LOGS] 4) INDICATOR CANDLE COUNTS
═══════════════════════════════════════════════════════════
RSI Candle Count: 100
MACD Candle Count: 100
ATR Candle Count: 100
Trend Strength Candle Count: 100
```

### 5) Orderbook Top 5 Bids/Asks
```
═══════════════════════════════════════════════════════════
📊 [EXTRACTED LOGS] 5) ORDERBOOK TOP 5 BIDS/ASKS
═══════════════════════════════════════════════════════════
Top 5 bids:
[...]

Top 5 asks:
[...]
```

### 6) Final Indicators
```
═══════════════════════════════════════════════════════════
📊 [EXTRACTED LOGS] 6) FINAL INDICATORS
═══════════════════════════════════════════════════════════
RSI: 65.5 ✅
MACD: signal=0.5, histogram=0.2, trend=BULLISH ✅
Volume: 1234567.89 ✅
Trend Strength: {"ema20":65000,"ema50":64500,"trend":"BULLISH"} ✅
Volatility: 500 ✅
Orderbook: 11.2% ✅
═══════════════════════════════════════════════════════════
```

## How to Run the Test

1. **Make sure server is running:**
   ```bash
   npm run dev
   ```

2. **Get Firebase token:**
   - Open frontend: http://localhost:5173
   - Login
   - Browser console (F12): `localStorage.getItem("firebaseToken")`
   - Copy the token

3. **Make the request:**
   ```bash
   # Option 1: Using PowerShell script
   .\scripts\extract-research-logs.ps1 -Token YOUR_TOKEN
   
   # Option 2: Using Node.js script
   node scripts/test-research-engine-e2e.js YOUR_TOKEN
   
   # Option 3: Using curl
   curl -X POST http://localhost:4000/api/research/run \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d "{\"symbol\":\"BTCUSDT\",\"timeframe\":\"5m\"}"
   ```

4. **Check server console** (where `npm run dev` is running) for the extracted logs

## Fallback Value Detection

The logs will automatically show:
- ✅ for real values
- ❌ FALLBACK! for fallback values
- ⚠️ (verify if real) for potentially suspicious values

If any fallback values are detected, the code will also log:
```
❌ [ERROR] RSI has fallback value 50 - this should not happen!
❌ [ERROR] MACD has fallback values 0/0 - this should not happen!
❌ [ERROR] Volume has fallback value "Stable" - this should not happen!
```

## Expected Results

**✅ SUCCESS:**
- Candle Count: ≥ 50 (ideally 100)
- All arrays have data
- All indicators show real values or null
- No fallback values detected

**❌ FAILURE:**
- Candle Count: 0
- Any indicator shows fallback value
- Arrays are empty when candles were received

