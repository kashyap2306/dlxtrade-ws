import { auth } from './firebase-config'; // keep existing import style

export const firebaseReady = new Promise<boolean>((resolve) => {
  // Resolve when Firebase's auth state is determined (signed in or signed out)
  const unsubscribe = auth.onAuthStateChanged(
    (user) => {
      unsubscribe();
      resolve(true);
    },
    (err) => {
      // On error, still resolve to avoid blocking app; log for diagnostics
      console.warn('[firebaseReady] onAuthStateChanged error:', err);
      unsubscribe();
      resolve(true);
    }
  );
});

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
