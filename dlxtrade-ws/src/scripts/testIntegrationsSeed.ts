import { getFirebaseAdmin } from '../utils/firebase';

(async () => {
  const uid = process.argv[2];
  if (!uid) {
    console.error("Usage: node dist/testIntegrationsSeed.js <uid>");
    process.exit(1);
  }

  const expected = [
    // Market Data
    "coingecko", "coinpaprika", "coinmarketcap", "coinlore", "coinapi",
    "bravenewcoin", "messari", "kaiko", "livecoinwatch", "coinstats", "coincheckup",
    // News
    "newsdata", "cryptopanic", "reddit", "cointelegraph_rss", "altcoinbuzz_rss",
    "gnews", "marketaux", "webzio", "coinstatsnews", "newscatcher", "cryptocompare_news",
    // Metadata
    "cryptocompare", "coingecko_metadata", "coinpaprika_metadata", "coinmarketcap_metadata",
    "coinstats_metadata", "cryptocompare_metadata", "livecoinwatch_metadata",
    "messari_metadata", "coinlore_metadata", "coincheckup_metadata", "coincap_metadata",
  ];

  const db = getFirebaseAdmin().firestore();
  const snap = await db.collection(`users/${uid}/integrations`).get();
  console.log("Total providers:", snap.size);

  const existing = snap.docs.map(d => d.id);
  const missing = expected.filter(e => !existing.includes(e));

  if (missing.length === 0 && snap.size === expected.length) {
    console.log("✔ FIXED — All providers exist");
  } else {
    console.log("❌ Missing providers:", missing);
  }
})();

