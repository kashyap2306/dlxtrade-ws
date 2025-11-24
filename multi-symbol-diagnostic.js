/**
 * Multi-Symbol Deep Research Diagnostic
 * Tests XRPUSDT, BTCUSDT, ETHUSDT and analyzes provider failures
 */

const { ResearchEngine } = require('./dist/services/researchEngine');

class MultiSymbolDiagnostic {
  constructor() {
    this.symbols = ['XRPUSDT', 'BTCUSDT', 'ETHUSDT'];
    this.results = {};
    this.providerFailures = {
      cryptocompare: [],
      coingecko: [],
      googlefinance: [],
      binance: [],
      marketaux: [],
      validSymbols: []
    };
  }

  async runFullDiagnostic() {
    console.log('🔬 MULTI-SYMBOL DEEP RESEARCH DIAGNOSTIC\n');
    console.log('=' .repeat(80));
    console.log('Testing symbols: XRPUSDT, BTCUSDT, ETHUSDT (5m timeframe)\n');

    for (const symbol of this.symbols) {
      console.log(`\n🚀 Testing ${symbol}...`);
      console.log('-'.repeat(40));

      try {
        const result = await this.runResearchForSymbol(symbol);
        this.results[symbol] = {
          success: true,
          result,
          error: null,
          duration: result._duration || 0
        };

        this.analyzeProviderCalls(symbol, result);

      } catch (error) {
        console.log(`❌ ${symbol} failed: ${error.message}`);
        this.results[symbol] = {
          success: false,
          result: null,
          error: error.message,
          duration: 0
        };
      }
    }

    this.generateProviderFailureReport();
    this.generateSummaryReport();

    return this.results;
  }

  async runResearchForSymbol(symbol) {
    const engine = new ResearchEngine();
    const startTime = Date.now();

    console.log(`Starting research for ${symbol}...`);

    const result = await engine.runResearch(symbol, 'system', null, true, [], '5m');

    const duration = Date.now() - startTime;
    result._duration = duration;

    console.log(`✅ ${symbol} completed in ${duration}ms`);
    console.log(`   Signal: ${result.signal}`);
    console.log(`   Confidence: ${result.confidence?.toFixed(1)}%`);
    console.log(`   API Calls: ${result.apiCallReport?.length || 0}`);

    return result;
  }

  analyzeProviderCalls(symbol, result) {
    const apiCallReport = result.apiCallReport || [];
    const providerDebug = result._providerDebug || {};

    console.log(`\n📊 Provider Analysis for ${symbol}:`);

    // Analyze each provider's calls and failures
    const providers = {
      cryptocompare: this.analyzeCryptoCompare(symbol, apiCallReport, providerDebug),
      coingecko: this.analyzeCoinGecko(symbol, apiCallReport, providerDebug),
      googlefinance: this.analyzeGoogleFinance(symbol, apiCallReport, providerDebug),
      binance: this.analyzeBinance(symbol, apiCallReport, providerDebug),
      marketaux: this.analyzeMarketAux(symbol, apiCallReport, providerDebug)
    };

    Object.entries(providers).forEach(([provider, analysis]) => {
      const status = analysis.status === 'healthy' ? '✅' :
                    analysis.status === 'partial' ? '⚠️' : '❌';
      console.log(`   ${status} ${provider}: ${analysis.status} - ${analysis.reason}`);

      if (analysis.status !== 'healthy') {
        this.providerFailures[provider].push({
          symbol,
          status: analysis.status,
          reason: analysis.reason,
          details: analysis.details,
          logs: analysis.logs
        });
      }
    });
  }

  analyzeCryptoCompare(symbol, apiCallReport, providerDebug) {
    const calls = apiCallReport.filter(call => call.apiName?.includes('CryptoCompare'));
    const debug = providerDebug.cryptocompare;

    if (calls.length === 0 && !debug) {
      return {
        status: 'failing',
        reason: 'No calls made to CryptoCompare',
        details: 'Adapter may not be initialized',
        logs: ['No CryptoCompare API calls found']
      };
    }

    const errors = calls.filter(call => call.status === 'ERROR');
    if (errors.length > 0) {
      return {
        status: 'failing',
        reason: 'API calls failing',
        details: errors.map(e => e.error).join('; '),
        logs: errors.map(e => `HTTP ${e.httpStatus}: ${e.error}`)
      };
    }

    const successCalls = calls.filter(call => call.status === 'SUCCESS');
    if (successCalls.length === 0) {
      return {
        status: 'partial',
        reason: 'No successful calls',
        details: 'Using fallback data',
        logs: ['All calls failed or returned no data']
      };
    }

    return {
      status: 'healthy',
      reason: `${successCalls.length} successful calls`,
      details: 'Working correctly',
      logs: successCalls.map(c => `${c.apiName}: ${c.duration}ms`)
    };
  }

  analyzeCoinGecko(symbol, apiCallReport, providerDebug) {
    const calls = apiCallReport.filter(call => call.apiName?.includes('CoinGecko'));
    const debug = providerDebug.coingecko;

    if (calls.length === 0 && !debug) {
      return {
        status: 'failing',
        reason: 'No calls made to CoinGecko',
        details: 'Adapter may not be initialized or called',
        logs: ['No CoinGecko API calls found']
      };
    }

    const successCalls = calls.filter(call => call.status === 'SUCCESS');
    if (successCalls.length === 0) {
      return {
        status: 'failing',
        reason: 'All calls failed',
        details: 'CoinGecko API unavailable',
        logs: calls.map(c => `HTTP ${c.httpStatus}: ${c.error}`)
      };
    }

    return {
      status: 'healthy',
      reason: `${successCalls.length} successful calls`,
      details: 'Working correctly',
      logs: successCalls.map(c => `${c.apiName}: ${c.duration}ms`)
    };
  }

  analyzeGoogleFinance(symbol, apiCallReport, providerDebug) {
    const calls = apiCallReport.filter(call => call.apiName?.includes('Google'));
    const debug = providerDebug.googlefinance;

    if (calls.length === 0 && !debug) {
      return {
        status: 'failing',
        reason: 'No calls made to Google Finance',
        details: 'Adapter may not be initialized',
        logs: ['No Google Finance API calls found']
      };
    }

    const successCalls = calls.filter(call => call.status === 'SUCCESS');
    if (successCalls.length === 0) {
      return {
        status: 'failing',
        reason: 'All calls failed',
        details: 'Google Finance API unavailable',
        logs: calls.map(c => `HTTP ${c.httpStatus}: ${c.error}`)
      };
    }

    return {
      status: 'healthy',
      reason: `${successCalls.length} successful calls`,
      details: 'Working correctly',
      logs: successCalls.map(c => `${c.apiName}: ${c.duration}ms`)
    };
  }

  analyzeBinance(symbol, apiCallReport, providerDebug) {
    const calls = apiCallReport.filter(call => call.apiName?.includes('Binance'));
    const debug = providerDebug.binance;

    if (calls.length === 0 && !debug) {
      return {
        status: 'failing',
        reason: 'No calls made to Binance',
        details: 'Adapter may not be initialized',
        logs: ['No Binance API calls found']
      };
    }

    const errors = calls.filter(call => call.status === 'ERROR');
    if (errors.length > 0) {
      return {
        status: 'failing',
        reason: 'API calls failing',
        details: errors.map(e => e.error).join('; '),
        logs: errors.map(e => `HTTP ${e.httpStatus}: ${e.error}`)
      };
    }

    const successCalls = calls.filter(call => call.status === 'SUCCESS');
    if (successCalls.length === 0) {
      return {
        status: 'partial',
        reason: 'No successful calls',
        details: 'Using cached or fallback data',
        logs: ['All calls failed or returned no data']
      };
    }

    return {
      status: 'healthy',
      reason: `${successCalls.length} successful calls`,
      details: 'Working correctly',
      logs: successCalls.map(c => `${c.apiName}: ${c.duration}ms`)
    };
  }

  analyzeMarketAux(symbol, apiCallReport, providerDebug) {
    const calls = apiCallReport.filter(call => call.apiName?.includes('MarketAux'));
    const debug = providerDebug.marketaux;

    if (calls.length === 0 && !debug) {
      return {
        status: 'failing',
        reason: 'No calls made to MarketAux',
        details: 'API key missing or adapter not initialized',
        logs: ['No MarketAux API calls found']
      };
    }

    const errors = calls.filter(call => call.status === 'ERROR');
    if (errors.length > 0) {
      return {
        status: 'failing',
        reason: 'API calls failing',
        details: 'API key invalid or service unavailable',
        logs: errors.map(e => `HTTP ${e.httpStatus}: ${e.error}`)
      };
    }

    const successCalls = calls.filter(call => call.status === 'SUCCESS');
    if (successCalls.length === 0) {
      return {
        status: 'partial',
        reason: 'No successful calls',
        details: 'Using neutral sentiment fallback',
        logs: ['All calls failed or returned no data']
      };
    }

    return {
      status: 'healthy',
      reason: `${successCalls.length} successful calls`,
      details: 'Working correctly',
      logs: successCalls.map(c => `${c.apiName}: ${c.duration}ms`)
    };
  }

  generateProviderFailureReport() {
    console.log('\n🔍 PROVIDER FAILURE ANALYSIS');
    console.log('='.repeat(80));

    Object.entries(this.providerFailures).forEach(([provider, failures]) => {
      if (failures.length === 0) {
        console.log(`✅ ${provider}: No failures detected`);
        return;
      }

      console.log(`\n❌ ${provider}: ${failures.length} failures`);
      console.log('-'.repeat(40));

      failures.forEach((failure, index) => {
        console.log(`${index + 1}. ${failure.symbol}: ${failure.reason}`);
        console.log(`   Status: ${failure.status}`);
        console.log(`   Details: ${failure.details}`);
        if (failure.logs && failure.logs.length > 0) {
          console.log(`   Logs: ${failure.logs.join('; ')}`);
        }
        console.log('');
      });

      // Generate root-cause analysis
      this.generateRootCauseAnalysis(provider, failures);
    });
  }

  generateRootCauseAnalysis(provider, failures) {
    console.log(`🔍 ROOT-CAUSE ANALYSIS for ${provider}:`);
    console.log('-'.repeat(40));

    const failureReasons = failures.map(f => f.reason);
    const uniqueReasons = [...new Set(failureReasons)];

    if (uniqueReasons.includes('No calls made to ' + provider)) {
      console.log('1-3 lines: Provider adapter not initialized or not called during research execution.');
      console.log('   Evidence: No API calls found in apiCallReport for this provider.');
      console.log('   Impact: Missing data for features that depend on this provider.');
      console.log('   Status codes/logs: N/A - provider never called');
    } else if (uniqueReasons.some(r => r.includes('API key'))) {
      console.log('1-3 lines: Missing or invalid API key preventing provider initialization.');
      console.log('   Evidence: Provider initialized with warning about missing API key.');
      console.log('   Impact: Provider returns neutral/default data instead of real market data.');
      console.log('   Status codes/logs: 401 Unauthorized or initialization warnings');
    } else if (uniqueReasons.some(r => r.includes('All calls failed'))) {
      console.log('1-3 lines: Network connectivity issues or service unavailability.');
      console.log('   Evidence: HTTP errors (500, 502, 503) or connection timeouts.');
      console.log('   Impact: Research falls back to cached or neutral data.');
      console.log('   Status codes/logs: Various HTTP 5xx errors in apiCallReport');
    } else {
      console.log('1-3 lines: Unknown failure pattern - requires deeper investigation.');
      console.log('   Evidence: Mixed failure reasons across symbols.');
      console.log('   Impact: Inconsistent data quality in research results.');
      console.log('   Status codes/logs: Multiple error types observed');
    }

    console.log('');
  }

  generateSummaryReport() {
    console.log('\n📊 DIAGNOSTIC SUMMARY REPORT');
    console.log('='.repeat(80));

    const successfulTests = Object.values(this.results).filter(r => r.success).length;
    const totalTests = this.symbols.length;

    console.log(`✅ Successful tests: ${successfulTests}/${totalTests}`);

    this.symbols.forEach(symbol => {
      const result = this.results[symbol];
      const status = result.success ? '✅' : '❌';
      const duration = result.duration ? `${result.duration}ms` : 'N/A';
      console.log(`${status} ${symbol}: ${result.success ? 'OK' : result.error} (${duration})`);
    });

    console.log('\n🔧 PROVIDER HEALTH SUMMARY:');
    Object.entries(this.providerFailures).forEach(([provider, failures]) => {
      const totalFailures = failures.length;
      const healthySymbols = this.symbols.length - totalFailures;
      const status = totalFailures === 0 ? '✅ HEALTHY' :
                    healthySymbols > 0 ? '⚠️ PARTIAL' : '❌ FAILING';
      console.log(`${status} ${provider}: ${healthySymbols}/${this.symbols.length} symbols working`);
    });

    console.log('\n🎯 NEXT STEPS:');
    console.log('1. Review root-cause analysis above for each failing provider');
    console.log('2. Apply minimal fixes for clear config/import bugs');
    console.log('3. Archive unused files if any found');
    console.log('4. Run smoke tests and create PR');
  }
}

// Run the diagnostic
async function main() {
  const diagnostic = new MultiSymbolDiagnostic();
  const results = await diagnostic.runFullDiagnostic();

  console.log('\n🎉 Multi-symbol diagnostic completed!');
  return results;
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MultiSymbolDiagnostic };
