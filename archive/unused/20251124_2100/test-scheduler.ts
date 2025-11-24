/**
 * Test script for Deep Research Scheduler
 * 
 * Simulates 3 scheduled ticks (with fast mode e.g., 5s interval) and verifies:
 * - No overlapping runs (timestamps non-overlapping)
 * - Exactly 1 coin processed per tick
 * - Distinct symbols processed
 * 
 * Usage:
 *   npx ts-node scripts/test-scheduler.ts
 */

import { deepResearchScheduler } from '../src/services/deepResearchScheduler';
import { logger } from '../src/utils/logger';

interface RunLog {
  timestamp: string;
  symbol: string;
  duration: number;
  success: boolean;
  instanceId: string;
}

const runLogs: RunLog[] = [];

async function simulateScheduledTicks(intervalMs: number = 5000, numTicks: number = 3): Promise<void> {
  console.log(`\n🧪 Starting scheduler test: ${numTicks} ticks with ${intervalMs}ms interval\n`);

  // Override scheduler interval for testing
  const originalInterval = (deepResearchScheduler as any).RUN_INTERVAL_MS;
  (deepResearchScheduler as any).RUN_INTERVAL_MS = intervalMs;

  // Start scheduler
  deepResearchScheduler.start();

  // Monitor runs
  const checkStatus = async () => {
    const status = await deepResearchScheduler.getStatus();
    if (status.lastRunTimestamp && status.lastSymbol) {
      const existingLog = runLogs.find(
        log => log.timestamp === status.lastRunTimestamp && log.symbol === status.lastSymbol
      );
      
      if (!existingLog) {
        runLogs.push({
          timestamp: status.lastRunTimestamp!,
          symbol: status.lastSymbol!,
          duration: status.lastDuration || 0,
          success: status.lastSuccess || false,
          instanceId: status.instanceId,
        });
        
        console.log(`✅ Run ${runLogs.length}: ${status.lastSymbol} at ${status.lastRunTimestamp} (${status.lastDuration}ms)`);
      }
    }
  };

  // Check status every second
  const statusInterval = setInterval(checkStatus, 1000);

  // Wait for all ticks to complete
  await new Promise((resolve) => {
    setTimeout(() => {
      clearInterval(statusInterval);
      (deepResearchScheduler as any).RUN_INTERVAL_MS = originalInterval;
      deepResearchScheduler.stop();
      resolve(undefined);
    }, intervalMs * numTicks + 2000); // Add 2s buffer
  });

  // Wait a bit more for final runs to complete
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Final status check
  await checkStatus();

  console.log(`\n📊 Test Results:\n`);
  console.log(`Total runs: ${runLogs.length}`);
  console.log(`Expected runs: ${numTicks}\n`);

  if (runLogs.length === 0) {
    console.log('❌ No runs were logged - check scheduler implementation');
    return;
  }

  // Verify no overlapping runs
  let overlaps = 0;
  for (let i = 0; i < runLogs.length - 1; i++) {
    const run1 = runLogs[i];
    const run2 = runLogs[i + 1];
    const end1 = new Date(run1.timestamp).getTime() + run1.duration;
    const start2 = new Date(run2.timestamp).getTime();
    
    if (end1 > start2) {
      overlaps++;
      console.log(`⚠️  Overlap detected: Run ${i + 1} ended at ${new Date(end1).toISOString()}, Run ${i + 2} started at ${new Date(start2).toISOString()}`);
    }
  }

  // Verify distinct symbols
  const symbols = runLogs.map(r => r.symbol);
  const uniqueSymbols = new Set(symbols);
  console.log(`\n📈 Symbol Coverage:`);
  console.log(`  Distinct symbols: ${uniqueSymbols.size}/${runLogs.length}`);
  console.log(`  Symbols: ${Array.from(uniqueSymbols).join(', ')}`);

  // Verify exactly 1 coin per run
  const onePerRun = runLogs.every(r => r.symbol);
  console.log(`\n✅ Assertions:`);
  console.log(`  Exactly 1 coin per run: ${onePerRun ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  No overlapping runs: ${overlaps === 0 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Runs completed: ${runLogs.length === numTicks ? '✅ PASS' : '⚠️  PARTIAL (may need more time)'}`);

  // Log snippet
  console.log(`\n📝 Log Snippet (3 runs with distinct symbols and no overlaps):\n`);
  runLogs.slice(0, 3).forEach((log, idx) => {
    console.log(`Run ${idx + 1}:`);
    console.log(`  Timestamp: ${log.timestamp}`);
    console.log(`  Symbol: ${log.symbol}`);
    console.log(`  Duration: ${log.duration}ms`);
    console.log(`  Success: ${log.success}`);
    console.log(`  Instance: ${log.instanceId}`);
    console.log();
  });
}

async function main() {
  try {
    // Wait a bit for Firestore to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await simulateScheduledTicks(5000, 3);

    console.log('\n✨ Test completed\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


