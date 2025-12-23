// Smoke test for Auto-Trade component
export const testAutoTrade = async (): Promise<boolean> => {
  try {
    console.log('[SMOKE AUTO-TRADE] Starting test...');

    // Test 1: Check if AutoTrade module can be imported
    const AutoTrade = await import('../pages/AutoTrade');
    if (!AutoTrade.default) {
      throw new Error('AutoTrade component not found');
    }
    console.log('[SMOKE AUTO-TRADE] ✅ AutoTrade module imported successfully');

    // Test 2: Check if component is a valid React component
    const component = AutoTrade.default;
    if (typeof component !== 'function') {
      throw new Error('AutoTrade is not a valid React component');
    }
    console.log('[SMOKE AUTO-TRADE] ✅ AutoTrade is a valid React component');

    // Test 3: Check for required dependencies
    try {
      await import('../services/api');
      await import('../hooks/useAuth');
      console.log('[SMOKE AUTO-TRADE] ✅ Required dependencies available');
    } catch (depError) {
      throw new Error(`Missing dependency: ${depError}`);
    }

    console.log('[SMOKE AUTO-TRADE] PASS');
    return true;
  } catch (error) {
    console.error('[SMOKE AUTO-TRADE] FAIL:', error);
    return false;
  }
};

// Auto-run test in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Run test after a short delay to allow component mounting
  setTimeout(() => {
    testAutoTrade();
  }, 1000);
}
