# DLXTRADE Troubleshooting Guide

## Common Development Errors & Solutions

### 1. Browser Extension Errors

#### Symptoms
```
Uncaught (in promise) Error: Cannot find menu item with id translate-page
Uncaught (in promise) Error: Cannot find menu item with id save-page
```

#### Cause
Browser extensions (Chrome/Edge translation, page-saving extensions) trying to inject into the development environment.

#### Solution
✅ **Already Fixed** - The application now automatically suppresses these errors via:
- `frontend/src/utils/suppressExtensionErrors.ts` - Filters extension errors
- `frontend/index.html` - Meta tags prevent translation
- `frontend/src/main.tsx` - Auto-imports the suppression utility

#### Manual Fix (if needed)
1. Disable browser extensions during development
2. Use incognito/private browsing mode
3. Add extension IDs to browser's exception list

---

### 2. WebSocket Connection Errors

#### Symptoms
```
WebSocket connection to 'ws://localhost:8081/' failed
```

#### Cause
Vite's HMR (Hot Module Replacement) trying to connect to wrong port.

#### Solution
✅ **Already Fixed** - Updated `vite.config.ts` with proper HMR configuration:
```typescript
hmr: {
  protocol: "ws",
  host: "localhost",
  port: 5173,
  clientPort: 5173,
  overlay: true,
}
```

#### Verify Fix
1. Check dev server is running on port 5173
2. No WebSocket errors should appear
3. HMR should work correctly (file changes auto-refresh)

---

### 3. Exchange Not Connected (Auto-Trade Diagnostic)

#### Symptoms
- Auto-trade diagnostic shows "Exchange not connected"
- Firestore shows `exchangeStatus: "NOT_CONNECTED"`
- `hasSecretEncrypted = false` in logs

#### Cause
- Missing or incomplete credential storage (especially for Bitget)
- Stale exchangeStatus not being revalidated

#### Solution
✅ **Already Fixed** - Multiple improvements:

1. **Complete Credential Storage** (`exchange.ts`):
   - Both `secretEncrypted` AND `secretKeyEncrypted` are saved
   - `passphraseEncrypted` always saved (empty string if not provided)
   - `normalizedAt` timestamp added on successful validation

2. **Exchange Revalidation** (`exchangeRevalidator.ts`):
   - Lightweight ping to exchange for diagnostic contexts
   - Updates Firestore with CONNECTED status on success
   - Prevents false NOT_CONNECTED states

3. **Diagnostic Integration** (`autoTrade.diagnostic.ts`):
   - Automatically attempts revalidation during diagnostic check
   - If credentials exist but status is NOT_CONNECTED, pings exchange
   - Updates status if exchange is actually usable

#### Manual Testing
1. Connect exchange (Bitget, Binance, etc.)
2. Verify Firestore document has all fields:
   - `apiKeyEncrypted` ✓
   - `secretEncrypted` ✓
   - `secretKeyEncrypted` ✓
   - `passphraseEncrypted` ✓
   - `exchangeStatus: "CONNECTED"` ✓
   - `normalizedAt` timestamp ✓
3. Run auto-trade diagnostic - should pass

---

### 4. TypeScript Errors in firestoreAdapter.ts

#### Symptoms
```
error: This comparison appears to be unintentional because the types have no overlap
error: Cannot find name 'revalidateExchangeCredentials'
```

#### Remaining Fixes Needed

**Fix 1: Add context type** (Line ~354)
```typescript
context?:
  | "background_job"
  | "user_request"
  | "exchange_connect"
  | "exchange_validate"
  | "engine_check"
  | "auto_trade_diagnostic",  // <-- ADD THIS
```

**Fix 2: Import revalidation function** (Top of file)
```typescript
import { revalidateExchangeCredentials } from './exchangeRevalidator';
```

---

### 5. Firebase Authentication Issues

#### Symptoms
- "Firebase not initialized" errors
- Token retrieval fails
- Auth state not persisting

#### Debugging Steps
1. Check Firebase console logs in browser
2. Run `window.debugFirebase()` in dev console
3. Verify environment variables:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`

#### Solution
- Ensure `.env.local` file exists with correct Firebase config
- Clear browser cache and local storage
- Re-authenticate

---

### 6. API Connection Errors

#### Symptoms
- 401 Unauthorized errors
- "Network Error" on all API calls
- CORS errors

#### Debugging Steps
1. Check backend is running: `http://localhost:4000/health`
2. Verify API_URL in console: Check `[API URL CHECK]` log
3. Test authentication token: `localStorage.getItem('authToken')`

#### Common Solutions
- Backend not running → Start with `npm run dev` in `dlxtrade-ws`
- Wrong API URL → Update `VITE_API_URL` in `.env.local`
- Expired token → Re-authenticate
- CORS issues → Check backend CORS configuration

---

### 7. Auto-Trade Not Executing

#### Symptoms
- Auto-trade enabled but no trades executing
- Diagnostic shows "BLOCKED" or "STALLED"

#### Diagnostic Checklist
Run `/api/auto-trade/diagnostic-check` to verify:

1. ✓ **Auto-trade enabled** - Toggle is ON
2. ✓ **Exchange connected** - Credentials are valid
3. ✓ **Scheduler running** - Background research active
4. ✓ **User job scheduled** - Your UID registered in scheduler
5. ✓ **Research keys configured** - API keys for market data
6. ✓ **Sufficient balance** - Minimum 10 USDT in futures wallet
7. ✓ **No safety blocks** - No daily loss limits exceeded

#### Common Blockers
- **Exchange not connected**: Re-connect exchange, run diagnostic
- **Scheduler not running**: Restart backend
- **No research keys**: Add CryptoCompare/Binance public API keys
- **Research stalled**: Check last research run timestamp
- **Accuracy too low**: Adjust accuracy threshold in settings

---

### 8. Bitget Exchange Issues

#### Symptoms
- "Passphrase required" error
- "Invalid signature" error
- Connection test fails for Bitget

#### Solution
Bitget requires **3 credentials**:
1. API Key
2. Secret Key
3. Passphrase

**Verify in Firestore:**
```javascript
users/{uid}/exchangeConfig/current:
{
  apiKeyEncrypted: "...",
  secretEncrypted: "...",
  secretKeyEncrypted: "...",  // Duplicate for compatibility
  passphraseEncrypted: "...",  // MUST exist for Bitget
  exchange: "bitget",
  exchangeStatus: "CONNECTED"
}
```

**If missing:**
1. Disconnect exchange
2. Reconnect with all 3 credentials
3. Verify test connection succeeds
4. Check Firestore document updated

---

## Development Tools

### Console Commands

```javascript
// Firebase debug info
window.debugFirebase()

// Check current user
firebase.auth().currentUser

// Get auth token
await firebase.auth().currentUser.getIdToken()

// Test API connection
fetch('http://localhost:4000/health')

// Check exchange status
fetch('/api/exchange/status', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### Useful Logs

Look for these logs in console:

```
[EXCHANGE_CONFIG_READ] - Exchange config loaded
[EXCHANGE_LIVE_VALIDATION_START] - Validation starting
[EXCHANGE_LIVE_VALIDATION_RESULT] - Validation result
[EXCHANGE_REVALIDATION] - Diagnostic revalidation
[AUTO_TRADE_DIAGNOSTIC] - Diagnostic check running
```

---

## Quick Fixes

### Clear All Cache
```bash
# Frontend
cd frontend
rm -rf node_modules/.vite
rm -rf dist

# Backend
cd dlxtrade-ws
rm -rf node_modules/.cache
```

### Reset Firebase State
```javascript
// In browser console
localStorage.clear()
sessionStorage.clear()
location.reload()
```

### Restart Everything
```bash
# Stop all
pkill -f node

# Start backend
cd dlxtrade-ws
npm run dev

# Start frontend (new terminal)
cd frontend
npm run dev
```

---

## Getting Help

### Logs to Collect

When reporting issues, include:

1. **Browser console logs** (full output)
2. **Network tab** (failed requests)
3. **Backend logs** (terminal output)
4. **Firestore state** (relevant documents)
5. **Environment** (Node version, OS, browser)

### Diagnostic Endpoint

Run full system diagnostic:
```
GET /api/auto-trade/diagnostic-check
```

Returns comprehensive status of:
- System configuration
- Exchange connectivity
- Wallet balances
- Research cycle
- Safety limits
- Blocking reasons

---

## Known Issues

### Extension Errors (Resolved)
- ✅ Browser extension errors now suppressed automatically
- No action needed

### WebSocket HMR (Resolved)
- ✅ Vite HMR configuration fixed
- Should reconnect automatically

### Exchange Revalidation (Resolved)
- ✅ Diagnostic now revalidates exchange credentials
- ✅ Updates Firestore status automatically
- ✅ No more false NOT_CONNECTED states

### Pending TypeScript Fixes
- ⚠️ Need to add 'auto_trade_diagnostic' context type
- ⚠️ Need to import revalidateExchangeCredentials
- See section 4 above for fixes

---

## Performance Optimization

### If App is Slow

1. **Check bundle size**: `npm run build -- --report`
2. **Clear browser cache**: Hard refresh (Ctrl+Shift+R)
3. **Reduce console logs**: Set `VITE_LOG_LEVEL=error`
4. **Disable extensions**: Test in incognito mode
5. **Check network**: Backend API response times

### If Diagnostic is Slow

1. Exchange balance check can be slow (5-10s)
2. Use cached values when available
3. Consider disabling live balance fetch
4. Diagnostic timeout is 200ms per check

---

## Contact

For issues not covered here:
- Check GitHub issues
- Review code comments
- Ask in team chat
- Contact senior engineer

**Last Updated**: 2024
**Version**: 1.0.0