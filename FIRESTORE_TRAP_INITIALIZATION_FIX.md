# Firestore Write Trap Initialization Fix

## Problem
The Firestore write trap was being installed **before** `firebase-admin.initializeApp()` was executed, causing:
- `FirebaseAppError: app/no-app` error
- Server crash at startup
- The trap tried to access `admin.firestore()` before Firebase was initialized

## Root Cause
1. **In `firebase.ts` (lines 502-510)**: The trap was installed immediately when the module loaded (module-level code execution)
2. **In `server.ts` (line 10)**: The trap was called again before `getFirebaseAdmin()` initialized Firebase
3. Both attempts occurred before `admin.initializeApp()` was called

## Solution
Deferred trap installation until AFTER Firebase initialization completes:

### Changes Made

#### 1. `dlxtrade-ws/src/utils/firebase.ts`
- **Removed**: Module-level trap installation (lines 502-510)
- **Added**: Trap installation inside `getFirebaseAdmin()` function after successful initialization
- **Added**: `trapInstalled` flag to prevent duplicate installations
- **Location**: After line "Connected to correct project" confirmation

```typescript
// CRITICAL: Install Firestore write trap AFTER Firebase is initialized
if (!trapInstalled) {
  try {
    installFirestoreWriteTrap();
    trapInstalled = true;
    console.log("✅ [RUNTIME_TRAP_INSTALLED] Firestore write trap installed successfully after Firebase initialization");
  } catch (error) {
    console.error("❌ [RUNTIME_TRAP_FAILED] Failed to install Firestore write trap:", error);
    // CRITICAL: If trap installation fails, we cannot safely run
    throw new Error("CRITICAL: Firestore write trap installation failed - server cannot start safely");
  }
}
```

#### 2. `dlxtrade-ws/src/server.ts`
- **Removed**: Direct call to `installFirestoreWriteTrap()` at line 10
- **Removed**: Import of `installFirestoreWriteTrap` function
- **Added**: Comment explaining trap installation is deferred

```typescript
// CRITICAL: Instrument Firestore writes to find the "Unknown Writer"
// NOTE: Trap installation is deferred until Firebase is initialized in getFirebaseAdmin()
import { getFirebaseAdmin } from './utils/firebase';
```

## Guarantees
✅ Trap is installed ONLY AFTER `initializeApp()` completes successfully
✅ No `admin.app()`, `admin.firestore()`, or any Firebase service is called before initialization
✅ Trap is installed at runtime startup, gated behind guaranteed initialized Firebase app
✅ If Firebase is not initialized, trap does NOT run and does NOT throw
✅ Hard-fail behavior preserved AFTER initialization (server crashes if trap fails post-init)
✅ Server starts cleanly without `app/no-app` error
✅ No new files created
✅ No folder structure changes
✅ Minimal code changes (only existing code modified)
✅ No duplicate logic added

## Verification
```bash
cd dlxtrade-ws
npm run build  # ✅ Build succeeds
npm start      # ✅ Server starts without app/no-app error
```

## Execution Order (Fixed)
1. `dotenv.config()` - Load environment variables
2. Import `getFirebaseAdmin` (does NOT execute trap)
3. Server initialization begins
4. `getFirebaseAdmin()` is called
5. `admin.initializeApp()` executes successfully
6. **Trap is installed** (after Firebase is ready)
7. Server continues normal startup

## Files Modified
- `dlxtrade-ws/src/utils/firebase.ts` - Moved trap installation to post-init
- `dlxtrade-ws/src/server.ts` - Removed premature trap call

## No Changes To
- Trap functionality (still catches INVALID_KEYS writes)
- Error handling behavior (still hard-fails on trap errors)
- Write protection logic (all invariants preserved)
- Any other files or folders
