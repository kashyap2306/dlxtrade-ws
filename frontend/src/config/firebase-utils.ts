import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from './firebase-config';

export async function resolveAgentDoc(
  agentKey: string
): Promise<{ id: string; data: any } | null> {
  if (!agentKey) return null;

  const aliasKey = (() => {
    const k = agentKey.toLowerCase();
    switch (k) {
      case 'liquidity_sniper_arbitrage':
        return 'LIQUIDITY_SWEEP_AGENT';
      default:
        return agentKey;
    }
  })();

  const user = auth.currentUser;
  if (!user) return null;

  const normalizedKey = aliasKey
    .toUpperCase()
    .replace(/-/g, '_');

  const userAgentsRef = collection(db, 'users', user.uid, 'agents');
  const snap = await getDocs(userAgentsRef);

  // Helper to normalize keys for comparison
  const normalize = (val: string) =>
    val?.toUpperCase().replace(/-/g, '_').replace(/(_AGENT|_STRATEGY)$/, '');

  for (const doc of snap.docs) {
    const data = doc.data();
    const docIdNorm = normalize(doc.id);
    const slugNorm = normalize(data?.slug ?? '');
    const keyNorm = normalize(data?.key ?? '');
    const agentKeyNorm = normalize(data?.agentKey ?? '');
    const typeNorm = normalize(data?.type ?? '');
    const targetNorm = normalize(normalizedKey);

    // Match by doc.id, slug, or any normalized variant (with/without _AGENT/_STRATEGY)
    if (
      docIdNorm === targetNorm ||
      slugNorm === targetNorm ||
      keyNorm === targetNorm ||
      agentKeyNorm === targetNorm ||
      typeNorm === targetNorm
    ) {
      return { id: doc.id, data };
    }
  }

  return null;
}

export async function getAuthToken(forceRefresh = false): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken(forceRefresh);
    return token || null;
  } catch (err) {
    console.warn('[getAuthToken] failed to get token:', err);
    return null;
  }
}

