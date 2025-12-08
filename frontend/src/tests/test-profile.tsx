// Smoke test for Profile component
export const testProfile = async (): Promise<boolean> => {
  try {
    console.log('[SMOKE PROFILE] Starting test...');

    // Test 1: Check if Profile module can be imported
    const Profile = await import('../pages/Profile');
    if (!Profile.default) {
      throw new Error('Profile component not found');
    }
    console.log('[SMOKE PROFILE] ✅ Profile module imported successfully');

    // Test 2: Check if component is a valid React component
    const component = Profile.default;
    if (typeof component !== 'function') {
      throw new Error('Profile is not a valid React component');
    }
    console.log('[SMOKE PROFILE] ✅ Profile is a valid React component');

    // Test 3: Check for required dependencies
    try {
      await import('../services/api');
      await import('../hooks/useAuth');
      console.log('[SMOKE PROFILE] ✅ Required dependencies available');
    } catch (depError) {
      throw new Error(`Missing dependency: ${depError}`);
    }

    console.log('[SMOKE PROFILE] PASS');
    return true;
  } catch (error) {
    console.error('[SMOKE PROFILE] FAIL:', error);
    return false;
  }
};

// Auto-run test in development
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Run test after a short delay to allow component mounting
  setTimeout(() => {
    testProfile();
  }, 1000);
}
