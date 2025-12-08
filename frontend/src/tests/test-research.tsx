// Smoke test for Research component
export const testResearch = async (): Promise<boolean> => {
  try {
    console.log('[SMOKE RESEARCH] Starting test...');

    // Test 1: Check if ResearchPanel module can be imported
    const ResearchPanel = await import('../pages/ResearchPanel');
    if (!ResearchPanel.default) {
      throw new Error('ResearchPanel component not found');
    }
    console.log('[SMOKE RESEARCH] ✅ ResearchPanel module imported successfully');

    // Test 2: Check if component is a valid React component
    const component = ResearchPanel.default;
    if (typeof component !== 'function') {
      throw new Error('ResearchPanel is not a valid React component');
    }
    console.log('[SMOKE RESEARCH] ✅ ResearchPanel is a valid React component');

    // Test 3: Check for required dependencies
    try {
      await import('../services/api');
      await import('../hooks/useAuth');
      console.log('[SMOKE RESEARCH] ✅ Required dependencies available');
    } catch (depError) {
      throw new Error(`Missing dependency: ${depError}`);
    }

    console.log('[SMOKE RESEARCH] PASS');
    return true;
  } catch (error) {
    console.error('[SMOKE RESEARCH] FAIL:', error);
    return false;
  }
};

// Auto-run test in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Run test after a short delay to allow component mounting
  setTimeout(() => {
    testResearch();
  }, 1000);
}
