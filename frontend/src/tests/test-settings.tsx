// Smoke test for Settings component
export const testSettings = async (): Promise<boolean> => {
  try {
    console.log('[SMOKE SETTINGS] Starting test...');

    // Test 1: Check if Settings module can be imported
    const Settings = await import('../pages/Settings');
    if (!Settings.default) {
      throw new Error('Settings component not found');
    }
    console.log('[SMOKE SETTINGS] ✅ Settings module imported successfully');

    // Test 2: Check if component is a valid React component
    const component = Settings.default;
    if (typeof component !== 'function') {
      throw new Error('Settings is not a valid React component');
    }
    console.log('[SMOKE SETTINGS] ✅ Settings is a valid React component');

    // Test 3: Check for required dependencies
    try {
      await import('../services/api');
      await import('../hooks/useAuth');
      console.log('[SMOKE SETTINGS] ✅ Required dependencies available');
    } catch (depError) {
      throw new Error(`Missing dependency: ${depError}`);
    }

    console.log('[SMOKE SETTINGS] PASS');
    return true;
  } catch (error) {
    console.error('[SMOKE SETTINGS] FAIL:', error);
    return false;
  }
};

// Auto-run test in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Run test after a short delay to allow component mounting
  setTimeout(() => {
    testSettings();
  }, 1000);
}
