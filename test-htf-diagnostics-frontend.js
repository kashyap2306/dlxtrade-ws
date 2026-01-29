/**
 * Test script to check HTF diagnostics API response
 * Run this in the browser console on the HTF agent page
 */

(async function testHTFDiagnostics() {
  console.log('=== HTF DIAGNOSTICS API TEST ===');
  
  try {
    // Get the API base URL from the current page
    const apiBaseUrl = window.location.origin;
    
    // Call the diagnostics API
    const response = await fetch(`${apiBaseUrl}/api/agents/htf-trend-filter-agent/diagnostics?limit=5`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include' // Include cookies for authentication
    });
    
    if (!response.ok) {
      console.error('API Error:', response.status, response.statusText);
      return;
    }
    
    const data = await response.json();
    console.log('API Response:', data);
    
    const diagnostics = data.diagnostics || [];
    console.log(`\nTotal diagnostics: ${diagnostics.length}`);
    
    if (diagnostics.length > 0) {
      const first = diagnostics[0];
      console.log('\n=== FIRST DIAGNOSTIC ENTRY ===');
      console.log('Full entry:', JSON.stringify(first, null, 2));
      
      console.log('\n=== DATA STRUCTURE CHECK ===');
      console.log('Has runtimeState:', !!first.runtimeState);
      console.log('Has runtimeState.indicators:', !!first.runtimeState?.indicators);
      console.log('Has runtimeState.indicators.results:', !!first.runtimeState?.indicators?.results);
      
      if (first.runtimeState) {
        console.log('\nruntimeState keys:', Object.keys(first.runtimeState));
        console.log('runtimeState:', JSON.stringify(first.runtimeState, null, 2));
      }
      
      if (first.runtimeState?.indicators) {
        console.log('\nindicators keys:', Object.keys(first.runtimeState.indicators));
        console.log('indicators:', JSON.stringify(first.runtimeState.indicators, null, 2));
      }
      
      if (first.runtimeState?.indicators?.results) {
        console.log('\nresults keys:', Object.keys(first.runtimeState.indicators.results));
        console.log('results:', JSON.stringify(first.runtimeState.indicators.results, null, 2));
      } else {
        console.warn('\n⚠️ NO RESULTS FOUND!');
        console.log('Checking alternative paths...');
        console.log('first.indicators:', first.indicators);
        console.log('first.signal:', first.signal);
        console.log('first.signal?.indicators:', first.signal?.indicators);
      }
      
      console.log('\n=== ICON RENDER CONDITION ===');
      const hasFullDiagnostics = !!(first.runtimeState?.indicators?.results);
      console.log('hasFullDiagnostics:', hasFullDiagnostics);
      console.log('Icon WILL render:', hasFullDiagnostics ? 'YES ✓' : 'NO ✗');
    } else {
      console.warn('No diagnostics found!');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
})();
