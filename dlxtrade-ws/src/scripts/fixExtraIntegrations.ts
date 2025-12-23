import { getFirebaseAdmin } from '../utils/firebase';

const OFFICIAL_PROVIDERS = new Set<string>([
  "cryptocompare","coinstats","kaiko","livecoinwatch","marketaux","messari",
  "coingecko","coinpaprika",
  "altcoinbuzz_rss","coinstatsnews","cointelegraph_rss","cryptopanic","gnews",
  "newsdata","reddit","webzio",
]);

(async () => {
  try {
    const uid = process.argv[2];
    if (!uid) {
      console.error("Usage: node dist/scripts/fixExtraIntegrations.js <uid>");
      process.exit(1);
    }

    const db = getFirebaseAdmin().firestore();
    const colRef = db.collection(`users/${uid}/integrations`);
    const snap = await colRef.get();
    console.log("[FIX] Initial count:", snap.size);

    let deletes = 0;
    for (const doc of snap.docs) {
      const id = doc.id;
      if (!OFFICIAL_PROVIDERS.has(id)) {
        await doc.ref.delete();
        deletes++;
        console.log("[FIX] Deleted extra provider:", id);
      }
    }

    const afterSnap = await colRef.get();
    console.log("[FIX] Final count:", afterSnap.size);
    console.log("[FIX] Deleted extras:", deletes);
  } catch (err: any) {
    console.error("[FIX ERROR]", err?.message || err);
    process.exit(1);
  }
})();

