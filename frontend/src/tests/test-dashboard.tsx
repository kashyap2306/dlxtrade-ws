// Smoke test for Dashboard component
export const testDashboard = async (): Promise<boolean> => {
  try {
    console.log('[SMOKE DASHBOARD] Starting test...');

    // Test 1: Check if Dashboard module can be imported
    const Dashboard = await import('../pages/Dashboard');
    if (!Dashboard.default) {
      throw new Error('Dashboard component not found');
    }
    console.log('[SMOKE DASHBOARD] ✅ Dashboard module imported successfully');

    // Test 2: Check if component is a valid React component
    const component = Dashboard.default;
    if (typeof component !== 'function') {
      throw new Error('Dashboard is not a valid React component');
    }
    console.log('[SMOKE DASHBOARD] ✅ Dashboard is a valid React component');

    // Test 3: Check for required dependencies
    try {
      await import('../services/api');
      await import('../hooks/useAuth');
      console.log('[SMOKE DASHBOARD] ✅ Required dependencies available');
    } catch (depError) {
      throw new Error(`Missing dependency: ${depError}`);
    }

    console.log('[SMOKE DASHBOARD] PASS');
    return true;
  } catch (error) {
    console.error('[SMOKE DASHBOARD] FAIL:', error);
    return false;
  }
};

// Auto-run test in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Run test after a short delay to allow component mounting
  setTimeout(() => {
    testDashboard();
  }, 1000);
}
