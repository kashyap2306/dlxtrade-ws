import * as admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

let privateKey = process.env.FIREBASE_PRIVATE_KEY;

console.log("[FIREBASE_DEBUG] ENV projectId:", projectId);
console.log("[FIREBASE_DEBUG] ENV clientEmail exists:", !!clientEmail);
console.log("[FIREBASE_DEBUG] ENV privateKey length:", privateKey?.length || 0);
console.log("[FIREBASE_DEBUG] GOOGLE_APPLICATION_CREDENTIALS:", serviceAccountPath || "not set");

// remove accidental surrounding quotes
if (privateKey?.startsWith('"') && privateKey?.endsWith('"')) {
  privateKey = privateKey.slice(1, -1);
}

// fallback to JSON service account
if ((!projectId || !clientEmail || !privateKey) && process.env.FIREBASE_SERVICE_ACCOUNT) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("[FIREBASE_DEBUG] Loaded FIREBASE_SERVICE_ACCOUNT JSON");
  privateKey = json.private_key;
}

export const firebaseConfig = {
  projectId,
  clientEmail,
  privateKey
};

/**
 * CRITICAL: Global trap to prevent ANY direct Firestore writes to exchangeConfig
 * This catches writes that bypass sanitizedSet/sanitizedUpdate
 */
let originalSet: Function;
let originalUpdate: Function;

function installGlobalFirestoreWriteTrap() {
  if (originalSet || originalUpdate) {
    return; // Already installed
  }

  const db = admin.firestore();
  originalSet = (admin.firestore.DocumentReference as any).prototype.set;
  originalUpdate = (admin.firestore.DocumentReference as any).prototype.update;

  // Override set method
  (admin.firestore.DocumentReference as any).prototype.set = function(data: any, options?: any) {
    if (this.path.includes('/exchangeConfig/')) {
      console.error('🚨 [GLOBAL_WRITE_TRAP] Direct set() to exchangeConfig detected:', {
        path: this.path,
        stack: new Error().stack,
        dataKeys: Object.keys(data)
      });
      
      // Check for forbidden content
      if (data.exchangeStatus === 'INVALID_KEYS') {
        const errorMsg = `🚨 [GLOBAL_INVALID_KEYS_TRAP] Direct set() attempted to write INVALID_KEYS to ${this.path}`;
        console.error(errorMsg);
        console.error('   Stack:', new Error().stack);
        throw new Error(errorMsg);
      }
    }
    
    return originalSet.call(this, data, options);
  };

  // Override update method  
  (admin.firestore.DocumentReference as any).prototype.update = function(data: any) {
    if (this.path.includes('/exchangeConfig/')) {
      console.error('🚨 [GLOBAL_WRITE_TRAP] Direct update() to exchangeConfig detected:', {
        path: this.path,
        stack: new Error().stack,
        dataKeys: Object.keys(data)
      });
      
      // Check for forbidden content
      if (data.exchangeStatus === 'INVALID_KEYS') {
        const errorMsg = `🚨 [GLOBAL_INVALID_KEYS_TRAP] Direct update() attempted to write INVALID_KEYS to ${this.path}`;
        console.error(errorMsg);
        console.error('   Stack:', new Error().stack);
        throw new Error(errorMsg);
      }
    }
    
    return originalUpdate.call(this, data);
  };

  console.log('🛡️ [GLOBAL_FIRESTORE_TRAP] Installed global Firestore write trap for exchangeConfig');
}

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin() {
  // AUDIT: Check for multiple Firebase apps before initialization
  if (admin.apps.length > 1) {
    console.warn("⚠️ [FIREBASE_MULTIPLE_APPS] Multiple Firebase apps detected!");
    admin.apps.forEach((app, index) => {
      console.warn(`   App ${index}: ${app.name} → ${app.options.projectId}`);
    });
  }

  if (firebaseApp) {
    console.log("🔄 [FIREBASE_APP_REUSE] Reusing existing Firebase app:", firebaseApp.name);
    return firebaseApp;
  }

  console.log("🆕 [FIREBASE_APP_CREATION] Creating new Firebase app");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
      const json = JSON.parse(raw);
      console.log("[FIREBASE_DEBUG] Using FIREBASE_SERVICE_ACCOUNT from env");
      privateKey = json.private_key;
    }
  }

  if (!projectId || !clientEmail || !privateKey) {
    console.error("FIREBASE ENV VARS MISSING – BACKEND CANNOT RUN");
    console.error("- FIREBASE_PROJECT_ID:", !!projectId);
    console.error("- FIREBASE_CLIENT_EMAIL:", !!clientEmail);
    console.error("- FIREBASE_PRIVATE_KEY:", !!privateKey);
    throw new Error("FIREBASE ENV VARS MISSING – BACKEND CANNOT RUN");
  }

  console.log("🔥 FIREBASE_PROJECT_ID =", projectId);
  console.log("🔥 FIREBASE_CLIENT_EMAIL =", clientEmail);
  console.log("🔥 FIREBASE_PRIVATE_KEY length =", privateKey.length);
  console.log(`🔥 Using REAL FIREBASE project: ${projectId}`);
  console.log("[FIREBASE_DEBUG] privateKey has literal \\n:", privateKey.includes("\\n"));

  // Check if there's already a default app
  try {
    const existingApp = admin.app();
    console.log("🔥 EXISTING FIREBASE APP FOUND, projectId =", existingApp.options.projectId);
    firebaseApp = existingApp;
    return firebaseApp;
  } catch (e) {
    console.log("🔥 NO EXISTING FIREBASE APP, creating new one");
  }

  const serviceAccount = {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  };

  if (!serviceAccount.project_id) {
    console.error("[FIREBASE_DEBUG] serviceAccount.project_id missing");
    throw new Error("FIREBASE serviceAccount.project_id missing");
  }
  console.log("[FIREBASE_DEBUG] serviceAccount.project_id:", serviceAccount.project_id);
  console.log("[FIREBASE_DEBUG] serviceAccount.client_email exists:", !!serviceAccount.client_email);
  console.log("[FIREBASE_DEBUG] serviceAccount.private_key length:", serviceAccount.private_key?.length || 0);

  // CRITICAL: Force connection to REAL Firestore, never emulator
  // Delete any emulator environment variables that might cause issues
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_EMULATOR;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;

  console.log("🔥 FIRESTORE_EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST || "NOT SET (GOOD)");
  console.log("🔥 Forcing REAL Firestore connection (not emulator)");

  // SINGLE APP GUARANTEE: Only initialize if no apps exist
  if (!admin.apps.length) {
    console.log("🚀 [FIREBASE_INITIALIZATION] No existing apps, initializing new app");
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as unknown as admin.ServiceAccount),
      projectId: serviceAccount.project_id,
    });
    console.log("✅ [FIREBASE_INITIALIZATION] New app created:", firebaseApp.name);
  } else {
    console.log("🔄 [FIREBASE_INITIALIZATION] Using existing app");
    firebaseApp = admin.app(); // Use the first/default app

    // AUDIT: Ensure existing app is for correct project
    if (firebaseApp.options.projectId !== serviceAccount.project_id) {
      console.error("🚨 [FIREBASE_PROJECT_CONFLICT] Existing app project mismatch!");
      console.error("   Existing app project:", firebaseApp.options.projectId);
      console.error("   Expected project:", serviceAccount.project_id);
      console.error("   This will cause writes to wrong project!");
      throw new Error(`FIREBASE_PROJECT_CONFLICT: Existing app uses wrong project ${firebaseApp.options.projectId}, expected ${serviceAccount.project_id}`);
    }
  }

  // Verify the app was initialized correctly
  console.log("🔥 FIREBASE ADMIN APP PROJECT ID =", firebaseApp.options.projectId);
  console.log("[FIREBASE_DEBUG] firebaseApp.options:", firebaseApp.options);

  // CRITICAL AUDIT: Log ALL project ID sources for verification
  console.log("🔍 [FIREBASE_PROJECT_AUDIT]");
  console.log("   - App options projectId:", firebaseApp.options.projectId);
  console.log("   - Service account project_id:", serviceAccount.project_id);
  console.log("   - Environment FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID);
  console.log("   - Environment GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT || "NOT SET");
  console.log("   - Expected Firebase Console project:", "dlx-trading");

  // TEMPORARY HARD ASSERT: Verify correct project ID
  const expectedProjectId = "dlx-trading";
  if (firebaseApp.options.projectId !== expectedProjectId) {
    const errorMsg = `🚨 FATAL: Firebase Admin SDK connected to WRONG PROJECT!
      Expected: ${expectedProjectId}
      Actual: ${firebaseApp.options.projectId}
      This explains why documents don't appear in Firebase Console!`;
    console.error(errorMsg);
    console.error("🔍 Project ID sources:");
    console.error("   - FIREBASE_PROJECT_ID env:", process.env.FIREBASE_PROJECT_ID);
    console.error("   - FIREBASE_SERVICE_ACCOUNT project_id:", serviceAccount.project_id);
    console.error("   - GOOGLE_CLOUD_PROJECT:", process.env.GOOGLE_CLOUD_PROJECT || "NOT SET");
    throw new Error(`FIREBASE_PROJECT_MISMATCH: ${errorMsg}`);
  }

  console.log("✅ [FIREBASE_PROJECT_VERIFIED] Connected to correct project:", firebaseApp.options.projectId);

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

  return firebaseApp;
}

// ============================================
// 🚨 CRITICAL RUNTIME TRAP FOR INVALID_KEYS BUG
// ============================================

/**
 * INVARIANT ASSERTION: Prevent exchangeStatus mutation except from disconnect handler
 */
function assertExchangeStatusInvariant(operation: string, path: string, stack: string) {
  // Extract function names from stack trace
  const stackLines = stack.split('\n');
  const callerFunctions = stackLines
    .slice(1, 10)
    .map(line => {
      const match = line.match(/at (.+?)\(/) || line.match(/at (.+?)$/);
      return match ? match[1].trim() : '';
    })
    .filter(func => func && !func.includes('anonymous') && !func.includes('<anonymous>'));

  // Check if this is from a disconnect handler
  const isFromDisconnect = callerFunctions.some(func =>
    func.includes('disconnect') ||
    func.includes('Disconnect') ||
    func.includes('DISCONNECT')
  );

  if (!isFromDisconnect) {
    const errorMsg = `🚨 [EXCHANGE_STATUS_INVARIANT_VIOLATION] exchangeStatus mutation attempted outside disconnect handler`;
        console.error(errorMsg);
    console.error(`   Operation: ${operation}`);
    console.error(`   Path: ${path}`);
    console.error(`   Caller functions: ${callerFunctions.slice(0, 5).join(', ')}`);
    console.error(`   Stack:`, stackLines.slice(0, 8));
    throw new Error(errorMsg);
  }

  console.log(`✅ [EXCHANGE_STATUS_INVARIANT_OK] Mutation allowed from disconnect handler`);
}

/**
 * TEMPORARY RUNTIME TRAP: Catch any attempt to write forbidden fields
 * This will identify the exact culprit writing INVALID_KEYS at runtime
 */
export function installFirestoreWriteTrap() {
  console.log("🚨 [RUNTIME_TRAP_INSTALLED] Installing Firestore write trap for INVALID_KEYS detection");

  const forbiddenFields = ['exchangeStatus', 'keysClearedAt', 'keysClearedReason'];
  const forbiddenValues = ['INVALID_KEYS'];

  const isAllowedExchangeConnectCaller = (stack: string): boolean => {
    // HARD RULE: Forbidden exchange state writes must only be possible inside exchange connect route.
    // We intentionally use a strict allowlist to avoid accidental permission from background jobs.
    const hasExchangeRoute =
      stack.includes('src\\routes\\exchange.ts') ||
      stack.includes('src/routes/exchange.ts') ||
      stack.includes('routes\\exchange.ts') ||
      stack.includes('routes/exchange.ts');
    const hasConnectPath = stack.includes('exchange/connect') || stack.includes('/exchange/connect');
    const hasConnectHandlerHint =
      stack.includes('exchangeRoutes') ||
      stack.includes('connect') ||
      stack.includes('EXCHANGE_CONNECT');
    // NOTE: Token no longer required since /exchange/connect doesn't write forbidden fields anymore
    return hasExchangeRoute && (hasConnectPath || hasConnectHandlerHint);
  };

  // Helper to check payload for forbidden content
  const checkForbiddenContent = (payload: any, operation: string, path: string) => {
    if (!payload || typeof payload !== 'object') return;

    // CRITICAL: Hard check for exchangeConfig paths - these MUST never contain forbidden fields
    const isExchangeConfigPath = path.includes('/exchangeConfig/') || path.includes('exchangeConfig/');
    if (isExchangeConfigPath) {
      const stack = new Error().stack || '';
      // PROOF REQUIREMENT: Log stack trace BEFORE every exchangeConfig write
      console.error("🚨 [EXCHANGE_CONFIG_WRITE_TRACE]", {
        operation,
        path,
        payloadKeys: Object.keys(payload),
        timestamp: new Date().toISOString(),
        stack,
      });

      console.log(`🔍 [EXCHANGE_CONFIG_WRITE_CHECK] Checking write to exchangeConfig path: ${path}`);

      // IRONCLAD INVARIANT: ExchangeConfig documents must NEVER contain these fields
      for (const field of forbiddenFields) {
        if (payload.hasOwnProperty(field)) {
          const allowlisted = isAllowedExchangeConnectCaller(stack);
          if (!allowlisted) {
            const errorMsg = `🚨 [EXCHANGE_CONFIG_WRITE_BARRIER] Forbidden field "${field}" attempted outside exchange connect route`;
            console.error(errorMsg);
            console.error("   Operation:", operation);
            console.error("   Path:", path);
            console.error("   Forbidden field:", field);
            console.error("   Value:", JSON.stringify(payload[field]));
            console.error("   Full payload:", JSON.stringify(payload, null, 2));
            console.error("   Stack trace:", stack.split('\n').slice(0, 20).join('\n'));
            throw new Error(errorMsg);
          }

          const errorMsg = `🚨 [EXCHANGE_CONFIG_INVARIANT_VIOLATION] CRITICAL: Attempted to write forbidden field "${field}" to exchangeConfig path ${path}`;
          console.error(errorMsg);
          console.error("   Operation:", operation);
          console.error("   Forbidden field:", field);
          console.error("   Value:", JSON.stringify(payload[field]));
          console.error("   Full payload:", JSON.stringify(payload, null, 2));

          // Log caller stack
          const lines = stack.split('\n').slice(0, 10);
          console.error("   Stack trace:", lines.join('\n   '));

          throw new Error(errorMsg);
        }
      }

      // Check for forbidden values
      for (const [key, value] of Object.entries(payload)) {
        if (forbiddenValues.includes(value as string)) {
          // HARD RULE: INVALID_KEYS must never be written anywhere (state deleted)
          const barrierMsg = `🚨 [EXCHANGE_CONFIG_WRITE_BARRIER] Forbidden value "${value}" attempted - INVALID_KEYS state is deleted and must never be persisted`;
          console.error(barrierMsg);
          console.error("   Operation:", operation);
          console.error("   Path:", path);
          console.error("   Field:", key);
          console.error("   Full payload:", JSON.stringify(payload, null, 2));
          console.error("   Stack trace:", stack.split('\n').slice(0, 20).join('\n'));
          throw new Error(barrierMsg);
        }
      }

      console.log(`✅ [EXCHANGE_CONFIG_WRITE_CHECK] Write to ${path} passed invariant checks`);
    }

    // Check for forbidden field names
    for (const field of forbiddenFields) {
      if (payload.hasOwnProperty(field)) {
        const value = payload[field];

        // SPECIAL HANDLING: exchangeStatus requires invariant check
        if (field === 'exchangeStatus') {
          try {
            assertExchangeStatusInvariant(operation, path, new Error().stack || '');
          } catch (invariantError) {
            console.error("🚨 [EXCHANGE_STATUS_INVARIANT_VIOLATION] Blocking exchangeStatus write!");
            throw invariantError;
          }
        }

        console.error("🚨 [RUNTIME_TRAP_TRIGGERED] FORBIDDEN FIELD DETECTED!");
        console.error("   Operation:", operation);
        console.error("   Path:", path);
        console.error("   Forbidden field:", field);
        console.error("   Value:", JSON.stringify(value));
        console.error("   Full payload:", JSON.stringify(payload, null, 2));

        // Log full stack trace
        console.error("   Stack trace:");
        const stack = new Error().stack;
        if (stack) {
          const lines = stack.split('\n');
          for (let i = 0; i < Math.min(20, lines.length); i++) {
            console.error(`     ${lines[i]}`);
          }
        }

        // Extract caller information
        const stackLines = (new Error().stack || '').split('\n');
        const callerInfo = [];
        for (let i = 1; i < Math.min(10, stackLines.length); i++) {
          const line = stackLines[i]?.trim() || '';
          if (line) {
            callerInfo.push(line.replace(process.cwd(), '[PROJECT_ROOT]'));
          }
        }

        console.error("   Caller chain:");
        callerInfo.forEach((line, index) => {
          console.error(`     ${index + 1}: ${line}`);
        });

        // Find file and function
        const callerLine = stackLines[2] || '';
        const fileMatch = callerLine.match(/at (.+?)\((.+?):(\d+):\d+\)/) ||
                         callerLine.match(/at (.+?):(\d+):\d+/);
        if (fileMatch) {
          const fileName = fileMatch[2] || fileMatch[1];
          const lineNumber = fileMatch[3] || 'unknown';
          console.error("   Source file:", fileName.replace(process.cwd(), '[PROJECT_ROOT]'));
          console.error("   Source line:", lineNumber);
        }

        throw new Error(`RUNTIME_TRAP: Attempted to write forbidden field "${field}" via ${operation} to ${path}`);
      }
    }

    // Check for forbidden values in any field
    for (const [key, value] of Object.entries(payload)) {
      if (forbiddenValues.includes(value as string)) {
        console.error("🚨 [RUNTIME_TRAP_TRIGGERED] FORBIDDEN VALUE DETECTED!");
        console.error("   Operation:", operation);
        console.error("   Path:", path);
        console.error("   Field:", key);
        console.error("   Forbidden value:", value);
        console.error("   Full payload:", JSON.stringify(payload, null, 2));

        // Log full stack trace
        console.error("   Stack trace:");
        const stack = new Error().stack;
        if (stack) {
          const lines = stack.split('\n');
          for (let i = 0; i < Math.min(20, lines.length); i++) {
            console.error(`     ${lines[i]}`);
          }
        }

        throw new Error(`RUNTIME_TRAP: Attempted to write forbidden value "${value}" via ${operation} to ${path}`);
      }
    }
  };

  // Monkey-patch DocumentReference.set
  const originalDocSet = admin.firestore.DocumentReference.prototype.set;
  admin.firestore.DocumentReference.prototype.set = function(data: any, options?: any) {
    checkForbiddenContent(data, 'DocumentReference.set', this.path);
    return originalDocSet.call(this, data, options);
  };

  // Monkey-patch DocumentReference.update
  const originalDocUpdate = admin.firestore.DocumentReference.prototype.update;
  admin.firestore.DocumentReference.prototype.update = function(data: any) {
    checkForbiddenContent(data, 'DocumentReference.update', this.path);
    return originalDocUpdate.call(this, data);
  };

  // Monkey-patch WriteBatch.set
  const originalBatchSet = admin.firestore.WriteBatch.prototype.set;
  admin.firestore.WriteBatch.prototype.set = function(docRef: admin.firestore.DocumentReference, data: any, options?: any) {
    checkForbiddenContent(data, 'WriteBatch.set', docRef.path);
    return originalBatchSet.call(this, docRef, data, options);
  };

  // Monkey-patch WriteBatch.update
  const originalBatchUpdate = admin.firestore.WriteBatch.prototype.update;
  admin.firestore.WriteBatch.prototype.update = function(docRef: admin.firestore.DocumentReference, data: any) {
    checkForbiddenContent(data, 'WriteBatch.update', docRef.path);
    return originalBatchUpdate.call(this, docRef, data);
  };

  // Monkey-patch Transaction.set
  const originalTxnSet = admin.firestore.Transaction.prototype.set;
  admin.firestore.Transaction.prototype.set = function(
    docRef: admin.firestore.DocumentReference,
    data: any,
    options?: any,
  ) {
    checkForbiddenContent(data, 'Transaction.set', docRef.path);
    return originalTxnSet.call(this, docRef, data, options);
  };

  // Monkey-patch Transaction.update
  const originalTxnUpdate = admin.firestore.Transaction.prototype.update;
  admin.firestore.Transaction.prototype.update = function(
    docRef: admin.firestore.DocumentReference,
    data: any,
  ) {
    checkForbiddenContent(data, 'Transaction.update', docRef.path);
    return originalTxnUpdate.call(this, docRef, data);
  };

  console.log("✅ [RUNTIME_TRAP_ACTIVE] Firestore write trap installed - will catch INVALID_KEYS writes");
  
  // Install additional global trap for direct writes
  installGlobalFirestoreWriteTrap();
}

// Track trap installation status
let trapInstalled = false;

/**
 * CRITICAL SAFETY GUARD: Detect any attempt to write INVALID_KEYS
 * This function throws if any code attempts invalid exchange status writes
 */
function detectInvalidKeysWrite(payload: any, operation: string): void {
  const forbiddenValues = ['INVALID_KEYS'];
  const forbiddenFields = ['exchangeStatus', 'keysClearedReason'];

  // Check for direct INVALID_KEYS writes
  for (const value of forbiddenValues) {
    for (const [key, val] of Object.entries(payload)) {
      if (val === value) {
        const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write "${value}" to field "${key}" during ${operation}`;
        console.error(errorMsg);
        console.error('   Payload:', JSON.stringify(payload, null, 2));
        console.error('   This violates the INVALID_KEYS invariant');
        console.error('   INVALID_KEYS can only be written during successful credential validation');
        console.error('   HARD ERROR: Write protection invariant triggered by detectInvalidKeysWrite.');
        throw new Error(errorMsg);
      }
    }
  }

  // Check for invalid keysClearedReason patterns
  if (payload.keysClearedReason && typeof payload.keysClearedReason === 'string') {
    if (payload.keysClearedReason.includes('Decryption failure') ||
        payload.keysClearedReason.includes('ENCRYPTION_SECRET')) {
      const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write invalid keysClearedReason during ${operation}`;
      console.error(errorMsg);
      console.error('   Reason:', payload.keysClearedReason);
      console.error('   Decryption failures must NOT write keysClearedReason');
      console.error('   HARD ERROR: Write protection invariant triggered.');
      throw new Error(errorMsg);
    }
  }
}

/**
 * FIRESTORE PAYLOAD SANITIZER: Removes forbidden fields from Firestore writes
 * EXCEPTION: Allows exchange status fields from /exchange/connect route only
 */
function sanitizeFirestorePayload(payload: any): any {
  console.log("🔍 [SANITIZER_ENTRY] Payload keys:", Object.keys(payload));

  // Detect invalid writes
  const forbiddenValues = ['INVALID_KEYS'];
  for (const value of forbiddenValues) {
    for (const [key, val] of Object.entries(payload)) {
      if (val === value) {
        const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write "${value}" to field "${key}"`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
    }
  }

  // Check for invalid keysClearedReason values
  if (payload.keysClearedReason && typeof payload.keysClearedReason === 'string') {
    if (payload.keysClearedReason.includes('Decryption failure') ||
        payload.keysClearedReason.includes('ENCRYPTION_SECRET')) {
      const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write invalid keysClearedReason`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  // CONDITIONAL SANITIZER - Allow exchange status fields ONLY from /exchange/connect
  const hasConnectToken = (globalThis as any).__DLX_EXCHANGE_CONNECT_WRITE_TOKEN === true;
  const stackTrace = new Error().stack || '';
  const isFromExchangeConnectRoute = stackTrace.includes('/routes/exchange.ts') || 
                                     stackTrace.includes('\\routes\\exchange.ts');

  // Define forbidden fields - but allow them from /exchange/connect route
  const forbiddenFields = ['exchangeStatus', 'keysClearedAt', 'keysClearedReason', 'corruptedAt', 'corruptedReason'];
  const sanitized = { ...payload };
  let removedFields = [];

  console.log(`🔍 [SANITIZER_DEBUG] Forbidden fields: ${forbiddenFields.join(', ')}`);
  console.log(`🔍 [SANITIZER_DEBUG] Payload keys: ${Object.keys(payload).join(', ')}`);
  console.log(`🔍 [SANITIZER_DEBUG] Sanitized keys before removal: ${Object.keys(sanitized).join(', ')}`);
  console.log(`🔍 [SANITIZER_DEBUG] Has connect token: ${hasConnectToken}, From exchange route: ${isFromExchangeConnectRoute}`);

  // Use Object.keys to find all properties, including those that might not show up in hasOwnProperty
  const allKeys = Object.keys(sanitized);
  for (const key of allKeys) {
    if (forbiddenFields.includes(key)) {
      const value = sanitized[key];
      
      // EXCEPTION: Allow these fields ONLY from /exchange/connect route with proper token
      if (hasConnectToken && isFromExchangeConnectRoute) {
        console.log(`✅ [SANITIZER_ALLOWED] Allowing forbidden field from /exchange/connect: ${key} (value: ${JSON.stringify(value)})`);
        // Keep the field - don't remove it
      } else {
        console.log(`🧹 [SANITIZER_REMOVING] Removing forbidden field: ${key} (was: ${JSON.stringify(value)})`);
        delete sanitized[key];
        removedFields.push(key);
        console.log(`🧹 [SANITIZER_REMOVED] Removed forbidden field: ${key} [PROOF: Write protection active]`);
      }
    }
  }

  console.log(`🔍 [SANITIZER_DEBUG] Sanitized keys after removal: ${Object.keys(sanitized).join(', ')}`);

  // Convert undefined values to FieldValue.delete()
  for (const [key, value] of Object.entries(sanitized)) {
    if (value === undefined) {
      sanitized[key] = admin.firestore.FieldValue.delete();
    }
  }

  console.log("🔍 [SANITIZER_EXIT] Sanitized keys:", Object.keys(sanitized));
  return sanitized;
}

/**
 * SANITIZED FIRESTORE UPDATE: Ensures all updates go through sanitization
 */
export async function sanitizedUpdate(
  docRef: admin.firestore.DocumentReference,
  data: any
) {
  // Check if this is an exchange config write
  const isExchangeConfig = docRef.path.includes('/exchangeConfig/current');

  if (isExchangeConfig) {
    // CRITICAL: Log stack trace BEFORE ANY write to exchange config
    const stackTrace = new Error().stack || '';
    const timestamp = new Date().toISOString();
    
    console.error("🚨 [EXCHANGE_CONFIG_WRITE_ATTEMPT] DETAILED TRACE:", {
      path: docRef.path,
      timestamp,
      stack: stackTrace,
      payloadKeys: Object.keys(data),
      hasExchangeStatus: 'exchangeStatus' in data,
      hasKeysClearedAt: 'keysClearedAt' in data,
      hasKeysClearedReason: 'keysClearedReason' in data,
      payloadSize: JSON.stringify(data).length,
      // Extract caller function names from stack
      callerFunctions: stackTrace.split('\n').slice(1, 8).map(line => line.trim().replace(/^at\s+/, ''))
    });

    // CRITICAL: Check for any INVALID_KEYS value being written
    for (const [key, value] of Object.entries(data)) {
      if (value === 'INVALID_KEYS') {
        const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write INVALID_KEYS to field "${key}" in ${docRef.path}`;
        console.error(errorMsg);
        console.error('   Timestamp:', timestamp);
        console.error('   Full payload:', JSON.stringify(data, null, 2));
        console.error('   Stack trace:', stackTrace.split('\n').slice(0, 15).join('\n'));
        throw new Error(errorMsg);
      }
    }
  }

  // HARD WRITE BARRIER: Block any write to exchangeStatus/keysClearedAt/keysClearedReason
  if (isExchangeConfig && (
    'exchangeStatus' in data || 
    'keysClearedAt' in data || 
    'keysClearedReason' in data
  )) {
    const errorMsg = `🚨 [HARD_WRITE_BARRIER] Attempted to update forbidden fields to exchange config: ${Object.keys(data).filter(k => ['exchangeStatus', 'keysClearedAt', 'keysClearedReason'].includes(k))}`;
    console.error(errorMsg);
    console.error('   Path:', docRef.path);
    console.error('   Stack:', new Error().stack);
    console.error('   HARD ERROR: Write protection invariant triggered by sanitizedUpdate.');
    throw new Error(errorMsg);
  }

  // Apply sanitization (local function to avoid circular imports)
  const sanitizedData = sanitizeFirestorePayload(data);

  // Use the original update method
  return docRef.update(sanitizedData);
}

/**
 * SANITIZED FIRESTORE WRITE: Ensures all writes go through sanitization
 * This prevents direct doc.set() calls from bypassing the sanitizer
 */
export async function sanitizedSet(
  docRef: admin.firestore.DocumentReference,
  data: any,
  options?: admin.firestore.SetOptions
) {
  // Check if this is an exchange config write
  const isExchangeConfig = docRef.path.includes('/exchangeConfig/current');

  if (isExchangeConfig) {
    // CRITICAL: Log stack trace BEFORE ANY write to exchange config
    const stackTrace = new Error().stack || '';
    const timestamp = new Date().toISOString();
    
    console.error("🚨 [EXCHANGE_CONFIG_SET_ATTEMPT] DETAILED TRACE:", {
      path: docRef.path,
      timestamp,
      stack: stackTrace,
      payloadKeys: Object.keys(data),
      hasExchangeStatus: 'exchangeStatus' in data,
      hasKeysClearedAt: 'keysClearedAt' in data,
      hasKeysClearedReason: 'keysClearedReason' in data,
      payloadSize: JSON.stringify(data).length,
      options: options || {},
      // Extract caller function names from stack
      callerFunctions: stackTrace.split('\n').slice(1, 8).map(line => line.trim().replace(/^at\s+/, ''))
    });

    // CRITICAL: Check for any INVALID_KEYS value being written
    for (const [key, value] of Object.entries(data)) {
      if (value === 'INVALID_KEYS') {
        const errorMsg = `🚨 [INVALID_KEYS_SET_DETECTED] Attempted to set INVALID_KEYS to field "${key}" in ${docRef.path}`;
        console.error(errorMsg);
        console.error('   Timestamp:', timestamp);
        console.error('   Full payload:', JSON.stringify(data, null, 2));
        console.error('   Options:', options);
        console.error('   Stack trace:', stackTrace.split('\n').slice(0, 15).join('\n'));
        throw new Error(errorMsg);
      }
    }
  }

  // HARD WRITE BARRIER: Block any write to exchangeStatus/keysClearedAt/keysClearedReason
  // EXCEPTION: Allow these fields ONLY from /exchange/connect route with proper token
  if (isExchangeConfig && (
    'exchangeStatus' in data || 
    'keysClearedAt' in data || 
    'keysClearedReason' in data ||
    'corruptedAt' in data ||
    'corruptedReason' in data
  )) {
    // Check if this is an allowed exchange connect write
    const hasConnectToken = (globalThis as any).__DLX_EXCHANGE_CONNECT_WRITE_TOKEN === true;
    const stackTrace = new Error().stack || '';
    const isFromExchangeRoute = stackTrace.includes('/routes/exchange.ts') || stackTrace.includes('\\routes\\exchange.ts');
    
    if (!hasConnectToken || !isFromExchangeRoute) {
      const errorMsg = `🚨 [HARD_WRITE_BARRIER] Attempted to write forbidden fields to exchange config: ${Object.keys(data).filter(k => ['exchangeStatus', 'keysClearedAt', 'keysClearedReason', 'corruptedAt', 'corruptedReason'].includes(k))}`;
      console.error(errorMsg);
      console.error('   Path:', docRef.path);
      console.error('   Has connect token:', hasConnectToken);
      console.error('   Is from exchange route:', isFromExchangeRoute);
      console.error('   Stack:', stackTrace);
      console.error('   HARD ERROR: Write protection invariant triggered by sanitizedSet.');
      throw new Error(errorMsg);
    }
    
    console.log('✅ [EXCHANGE_CONNECT_WRITE_ALLOWED] Allowing forbidden fields from exchange connect route');
  }

  console.log("🔍 [SANITIZED_SET_ENTRY] Raw payload keys:", Object.keys(data));

  // TEMPORARY: Check if exchangeStatus is in the raw payload
  if ('exchangeStatus' in data) {
    // EXCEPTION: Allow from exchange connect route with proper token
    const hasConnectToken = (globalThis as any).__DLX_EXCHANGE_CONNECT_WRITE_TOKEN === true;
    const stackTrace = new Error().stack || '';
    const isFromExchangeRoute = stackTrace.includes('/routes/exchange.ts') || stackTrace.includes('\\routes\\exchange.ts');
    const isDeleteOperation = data.exchangeStatus && 
      typeof data.exchangeStatus === 'object' && 
      data.exchangeStatus.constructor && 
      data.exchangeStatus.constructor.name === 'FieldValue';
    
    if (hasConnectToken && isFromExchangeRoute) {
      console.log('✅ [EXCHANGE_STATUS_ALLOWED] Allowing exchangeStatus write from exchange connect route:', data.exchangeStatus);
    } else {
      console.error("🚨 [CRITICAL_BUG] exchangeStatus found in raw payload passed to sanitizedSet", {
        exchangeStatusValue: data.exchangeStatus,
        allKeys: Object.keys(data),
        hasConnectToken,
        isFromExchangeRoute,
        isDeleteOperation,
        payload: JSON.stringify(data, null, 2)
      });
      throw new Error("CRITICAL_BUG: exchangeStatus found in payload passed to sanitizedSet - should have been prevented earlier");
    }
  }

  // Apply sanitization (local function to avoid circular imports)
  const sanitizedData = sanitizeFirestorePayload(data);

  console.log("🔍 [SANITIZED_SET_SANITIZED] Sanitized keys:", Object.keys(sanitizedData));

  // Use the monkey-patched set method (which has runtime trap)
  return docRef.set(sanitizedData, options);
}

export const firebaseAuth = () => getFirebaseAdmin().auth();

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return getFirebaseAdmin().auth().verifyIdToken(token);
}
