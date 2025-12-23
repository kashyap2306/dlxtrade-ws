// Smoke test for Agents Marketplace component
export const testAgentsMarketplace = async (): Promise<boolean> => {
  try {
    console.log('[SMOKE AGENTS-MARKETPLACE] Starting test...');

    // Test 1: Check if AgentsMarketplace module can be imported
    const AgentsMarketplace = await import('../pages/AgentsMarketplace');
    if (!AgentsMarketplace.default) {
      throw new Error('AgentsMarketplace component not found');
    }
    console.log('[SMOKE AGENTS-MARKETPLACE] ✅ AgentsMarketplace module imported successfully');

    // Test 2: Check if component is a valid React component
    const component = AgentsMarketplace.default;
    if (typeof component !== 'function') {
      throw new Error('AgentsMarketplace is not a valid React component');
    }
    console.log('[SMOKE AGENTS-MARKETPLACE] ✅ AgentsMarketplace is a valid React component');

    // Test 3: Check for required dependencies
    try {
      await import('../services/api');
      await import('../hooks/useAuth');
      await import('../components/AgentCard');
      console.log('[SMOKE AGENTS-MARKETPLACE] ✅ Required dependencies available');
    } catch (depError) {
      throw new Error(`Missing dependency: ${depError}`);
    }

    console.log('[SMOKE AGENTS-MARKETPLACE] PASS');
    return true;
  } catch (error) {
    console.error('[SMOKE AGENTS-MARKETPLACE] FAIL:', error);
    return false;
  }
};

// Auto-run test in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Run test after a short delay to allow component mounting
  setTimeout(() => {
    testAgentsMarketplace();
  }, 1000);
}
