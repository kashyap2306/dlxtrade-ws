require('dotenv').config();
const { runResearch } = require('./dist/services/researchEngine');

(async () => {
  try {
    console.log("Running deep research test...");
    const result = await runResearch({
      uid: "TEST_USER",
      symbol: "BTCUSDT",
      timeframe: "5m"
    });
    console.log("RESULT:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("ERROR:", err);
  }
})();
