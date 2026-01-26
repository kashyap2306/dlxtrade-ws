/**
 * Test script to verify HTF Trend Filter Agent diagnostics fix
 * This script tests that HTF agents now save per-symbol diagnostics
 */

const { AgentExecutionService } = require('./dlxtrade-ws/src/services/agentExecutionService');
const { firestoreAdapter } = require('./dlxtrade-ws/src/services/firestoreAdapter');

async function testHTFDiagnosticsFix() {
  console.log('🧪 Testing HTF Trend Filter Agent diagnostics fix...');
  
  try {
    // Test user ID (use a test user)
    const testUserId = 'test_user_htf_diagnostics';
    const testAgentId = 'HTF_TREND_FILTER_AGENT';
    
    // Create a mock HTF agent config
    const mockHTFAgent = {
      config: {
        id: testAgentId,
        userId: testUserId,
        name: 'HTF Trend Filter Agent',
        tradingPair: 'BTC/USDT',
        strategyType: 'HTF_TREND_FILTER',
        status: 'ACTIVE'
      }
    };
    
    // Create mock market data provider
    const mockMarketProvider = {
      getCandles: async (symbol, timeframe, limit) => {
        console.log(`📊 Mock market data requested: ${symbol} ${timeframe} (${limit} candles)`);
        
        // Return mock candle data with sufficient length
        const mockCandles = [];
        for (let i = 0; i < 250; i++) {
          mockCandles.push({
            timestamp: Date.now() - (i * 60000), // 1 minute intervals
            open: 50000 + Math.random() * 1000,
            high: 50500 + Math.random() * 1000,
            low: 49500 + Math.random() * 1000,
            close: 50000 + Math.random() * 1000,
            volume: 100 + Math.random() * 50
          });
        }
        
        return mockCandles;
      }
    };
    
    // Create agent execution service
    const executionService = new AgentExecutionService(mockMarketProvider);
    
    // Add the mock HTF agent to active agents
    executionService.activeAgents = new Map();
    executionService.activeAgents.set(testAgentId, mockHTFAgent);
    
    console.log('🎯 Executing HTF agent to test per-symbol diagnostics...');
    
    // Execute the HTF agent (this should now save diagnostics for both BTC/USDT and ETH/USDT)
    await executionService.executeAgent(mockHTFAgent);
    
    console.log('✅ HTF agent execution completed');
    
    // Check if diagnostics were saved for both symbols
    console.log('🔍 Checking saved diagnostics...');
    
    const diagnostics = await firestoreAdapter.getAgentDiagnostics(testAgentId, 10, testUserId);
    
    console.log(`📋 Found ${diagnostics.length} diagnostic entries:`);
    
    const btcDiagnostics = diagnostics.filter(d => d.tradingPair === 'BTC/USDT');
    const ethDiagnostics = diagnostics.filter(d => d.tradingPair === 'ETH/USDT');
    
    console.log(`  - BTC/USDT diagnostics: ${btcDiagnostics.length}`);
    console.log(`  - ETH/USDT diagnostics: ${ethDiagnostics.length}`);
    
    // Verify that we have diagnostics for both symbols
    if (btcDiagnostics.length > 0 && ethDiagnostics.length > 0) {
      console.log('✅ SUCCESS: HTF agent now saves per-symbol diagnostics!');
      
      // Show sample diagnostic entries
      console.log('\n📊 Sample diagnostic entries:');
      diagnostics.slice(0, 3).forEach((diag, index) => {
        console.log(`  ${index + 1}. ${diag.tradingPair} | ${diag.direction || 'NO_TRADE'} | ${diag.decision.reason}`);
      });
      
      return true;
    } else {
      console.log('❌ FAILED: Missing diagnostics for one or both symbols');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    return false;
  }
}

// Run the test
if (require.main === module) {
  testHTFDiagnosticsFix()
    .then(success => {
      if (success) {
        console.log('\n🎉 HTF diagnostics fix verification PASSED');
        process.exit(0);
      } else {
        console.log('\n💥 HTF diagnostics fix verification FAILED');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testHTFDiagnosticsFix };