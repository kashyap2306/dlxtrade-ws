const { ResearchEngine } = require('./dist/services/researchEngine');

async function debugApiCalls() {
  console.log('🔍 DEBUGGING API CALL REPORT\n');

  const engine = new ResearchEngine();
  const result = await engine.runResearch('BTCUSDT', 'system', null, true, [], '5m');

  console.log('API Call Report:');
  result.apiCallReport.forEach(call => {
    console.log(`- ${call.apiName}: ${call.status} (${call.httpStatus || 'N/A'})`);
  });

  console.log('\nProvider Debug:');
  if (result._providerDebug) {
    Object.entries(result._providerDebug).forEach(([provider, data]) => {
      console.log(`- ${provider}: ${data.status || 'unknown'}`);
    });
  }
}

debugApiCalls().catch(console.error);
