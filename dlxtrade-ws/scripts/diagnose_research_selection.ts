
import { selectBestCoinByAccuracy, getTop100Coins } from '../src/services/researchModes';
import { firestoreAdapter } from '../src/services/firestoreAdapter';
import 'dotenv/config';

// Mock everything we can, but we want to test the REAL logic of selecting coins
// We need to bypass Firebase initialization if we can't do it, but firestoreAdapter is used.
// If firestoreAdapter fails to init, it might crash.
// However, selectBestCoinByAccuracy mostly relies on getTop100Coins and cacheService.

async function diagnose() {
    console.log("--- DIAGNOSTIC START ---");
    const uid = 'test_user_diagnose';

    console.log("1. Fetching Top 100 Coins...");
    try {
        const coins = await getTop100Coins(uid, 100);
        console.log(`Fetched ${coins.length} coins.`);

        if (coins.length > 0) {
            console.log("First 5 coins:");
            coins.slice(0, 5).forEach((c, i) => {
                console.log(`[${i}] ${c.symbol} | Vol: ${c.price_change_percentage_24h}% | MC: ${c.marketCap}`);
            });
        } else {
            console.log("WARNING: No coins returned. API keys might be missing or mocked.");
        }

        console.log("\n2. Running selectBestCoinByAccuracy...");
        const result = await selectBestCoinByAccuracy(uid, []);

        if (result) {
            console.log(`RESULT: Selected ${result.symbol} with accuracy ${result.accuracy}`);
        } else {
            console.log("RESULT: NULL (No coin selected)");
        }

    } catch (error: any) {
        console.error("CRITICAL ERROR during diagnostics:", error.message);
        console.error(error.stack);
    }

    console.log("--- DIAGNOSTIC END ---");
    process.exit(0);
}

diagnose();
