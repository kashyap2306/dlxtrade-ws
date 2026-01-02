import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';

interface PinkSalePresale {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  status: 'upcoming' | 'live' | 'ended';
  launchDate: number;
  softCap: number;
  hardCap: number;
  currentRaised: number;
  progress: number;
  contractAddress: string;
  isVerified: boolean;
  liquidityLocked: boolean;
  teamInfo: boolean;
  source: 'pinksale';
  // New enhanced fields
  coingeckoExists?: boolean;
  coingeckoName?: string;
  coingeckoSymbol?: string;
  lockDuration?: string;
}

interface LaunchpadAlert {
  id: string;
  uid: string;
  agentId: string;
  presaleId: string;
  presaleName: string;
  chain: string;
  status: 'upcoming' | 'live' | 'ended';
  launchDate: number;
  softCap: number;
  hardCap: number;
  isVerified: boolean;
  liquidityLocked: boolean;
  teamInfo: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: number;
  // Enhanced fields
  coingeckoExists?: boolean;
  coingeckoName?: string;
  coingeckoSymbol?: string;
  lockDuration?: string;
}

export class LaunchpadService {
  private static readonly PINKSALE_API_URL = 'https://api.pinksale.finance/api/v1/presales';
  private static readonly CACHE_KEY = 'pinksale_presales';
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // New API endpoints
  private static readonly COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';
  private static readonly PINKLOCK_API_URL = 'https://app.pinksale.finance/api'; // Using PinkSale's own API for lock info

  /**
   * Fetch presales from PinkSale API
   */
  static async fetchPinkSalePresales(): Promise<PinkSalePresale[]> {
    try {
      const response = await fetch(`${this.PINKSALE_API_URL}/list?limit=50`);

      if (!response.ok) {
        throw new Error(`PinkSale API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !data.data) {
        throw new Error('Invalid PinkSale API response');
      }

      const basicPresales: PinkSalePresale[] = data.data.map((item: any) => ({
        id: item.id?.toString() || '',
        name: item.name || 'Unknown',
        symbol: item.symbol || '',
        chain: this.mapChainId(item.chain_id),
        status: this.mapStatus(item.status),
        launchDate: item.start_time ? item.start_time * 1000 : Date.now(),
        softCap: parseFloat(item.soft_cap) || 0,
        hardCap: parseFloat(item.hard_cap) || 0,
        currentRaised: parseFloat(item.raised) || 0,
        progress: parseFloat(item.progress) || 0,
        contractAddress: item.contract_address || '',
        isVerified: !!item.is_verified,
        liquidityLocked: !!item.liquidity_locked,
        teamInfo: !!item.team_info,
        source: 'pinksale' as const,
      }));

      // Enhance presales with additional API checks (limit to first 10 for performance)
      const enhancedPresales: PinkSalePresale[] = [];
      for (let i = 0; i < Math.min(basicPresales.length, 10); i++) {
        try {
          const enhanced = await this.processPresaleWithAPIs(basicPresales[i]);
          enhancedPresales.push(enhanced);
        } catch (error) {
          // If enhancement fails, use basic data
          enhancedPresales.push(basicPresales[i]);
        }
      }

      // Add remaining basic presales without enhancement
      enhancedPresales.push(...basicPresales.slice(10));

      const presales = enhancedPresales;

      // Cache the results
      await this.cachePresales(presales);

      return presales;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch PinkSale presales');
      // Return cached data if available
      return await this.getCachedPresales();
    }
  }

  /**
   * Get cached presales if available
   */
  static async getCachedPresales(): Promise<PinkSalePresale[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const cacheDoc = await db.collection('cache').doc(this.CACHE_KEY).get();

      if (!cacheDoc.exists) return [];

      const data = cacheDoc.data();
      if (!data || !data.presales || !data.timestamp) return [];

      // Check if cache is still valid
      const age = Date.now() - data.timestamp;
      if (age > this.CACHE_DURATION) return [];

      return data.presales as PinkSalePresale[];
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get cached presales');
      return [];
    }
  }

  /**
   * Cache presales data
   */
  static async cachePresales(presales: PinkSalePresale[]): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('cache').doc(this.CACHE_KEY).set({
        presales,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to cache presales');
    }
  }

  /**
   * Generate alerts for users based on their settings
   */
  static async generateAlertsForUsers(): Promise<void> {
    try {
      const presales = await this.fetchPinkSalePresales();
      const db = getFirebaseAdmin().firestore();

      // Get all users who have access to the launchpad hunter agent
      const userAgentsQuery = db.collectionGroup('agents')
        .where('agentId', '==', 'ai_launchpad_hunter')
        .where('unlocked', '==', true);

      const userAgentsSnapshot = await userAgentsQuery.get();

      const userIds = new Set<string>();
      userAgentsSnapshot.forEach(doc => {
        const pathParts = doc.ref.path.split('/');
        if (pathParts.length >= 2) {
          userIds.add(pathParts[1]); // uid from users/{uid}/agents/{agentId}
        }
      });

      // Process each user's alerts
      for (const uid of userIds) {
        await this.generateAlertsForUser(uid, presales);
      }

      logger.info({ userCount: userIds.size, presaleCount: presales.length }, 'Generated launchpad alerts for users');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to generate alerts for users');
    }
  }

  /**
   * Generate alerts for a specific user
   */
  static async generateAlertsForUser(uid: string, presales: PinkSalePresale[]): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();

      // Get user's settings for this agent
      const userAgentDoc = await db.collection('users').doc(uid).collection('agents').doc('ai_launchpad_hunter').get();
      const userSettings = userAgentDoc.exists ? userAgentDoc.data()?.settings || {} : {};

      // Apply user filters
      const filteredPresales = this.filterPresalesForUser(presales, userSettings);

      // Get existing alerts to avoid duplicates
      const existingAlertsQuery = db.collection('users').doc(uid).collection('launchpadAlerts')
        .where('createdAt', '>', Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

      const existingAlertsSnapshot = await existingAlertsQuery.get();
      const existingAlertIds = new Set<string>();

      existingAlertsSnapshot.forEach(doc => {
        const data = doc.data();
        existingAlertIds.add(data.presaleId);
      });

      // Generate new alerts
      const newAlerts: LaunchpadAlert[] = [];

      for (const presale of filteredPresales) {
        if (!existingAlertIds.has(presale.id)) {
          const riskLevel = this.calculateRiskLevel(presale);

          // Apply risk filter
          if (userSettings.riskFilter === 'low' && riskLevel !== 'low') continue;

          const alert: LaunchpadAlert = {
            id: `${presale.id}_${Date.now()}`,
            uid,
            agentId: 'ai_launchpad_hunter',
            presaleId: presale.id,
            presaleName: presale.name,
            chain: presale.chain,
            status: presale.status,
            launchDate: presale.launchDate,
            softCap: presale.softCap,
            hardCap: presale.hardCap,
            isVerified: presale.isVerified,
            liquidityLocked: presale.liquidityLocked,
            teamInfo: presale.teamInfo,
            riskLevel,
            createdAt: Date.now(),
            // Enhanced fields
            coingeckoExists: presale.coingeckoExists,
            coingeckoName: presale.coingeckoName,
            coingeckoSymbol: presale.coingeckoSymbol,
            lockDuration: presale.lockDuration,
          };

          newAlerts.push(alert);
        }
      }

      // Save new alerts
      const batch = db.batch();
      for (const alert of newAlerts) {
        const alertRef = db.collection('users').doc(uid).collection('launchpadAlerts').doc(alert.id);
        batch.set(alertRef, alert);
      }

      if (newAlerts.length > 0) {
        await batch.commit();
        logger.info({ uid, alertCount: newAlerts.length }, 'Saved launchpad alerts for user');
      }

    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to generate alerts for user');
    }
  }

  /**
   * Filter presales based on user settings
   */
  static filterPresalesForUser(presales: PinkSalePresale[], userSettings: any): PinkSalePresale[] {
    let filtered = presales;

    // Filter by enabled status
    if (!userSettings.enabled) return [];

    // Filter by chains
    if (userSettings.selectedChains && userSettings.selectedChains.length > 0) {
      filtered = filtered.filter(p => userSettings.selectedChains.includes(p.chain));
    }

    // Filter by status
    if (userSettings.alertTypes && userSettings.alertTypes.length > 0) {
      filtered = filtered.filter(p => userSettings.alertTypes.includes(p.status));
    }

    // Filter by max alerts per day (this is checked at generation time)
    // We'll handle this by limiting the number of alerts we generate

    return filtered;
  }

  /**
   * Calculate risk level based on enhanced safety flags
   */
  static calculateRiskLevel(presale: PinkSalePresale): 'low' | 'medium' | 'high' {
    let riskScore = 0;

    if (!presale.isVerified) riskScore += 2;
    if (!presale.liquidityLocked) riskScore += 2;
    if (!presale.teamInfo) riskScore += 1;
    // New risk factors - token already exists on CoinGecko is concerning
    if (presale.coingeckoExists === true) riskScore += 1;

    if (riskScore <= 1) return 'low';
    if (riskScore <= 3) return 'medium';
    return 'high';
  }

  /**
   * Map PinkSale chain ID to readable chain name
   */
  static mapChainId(chainId: number): string {
    const chainMap: Record<number, string> = {
      1: 'ETH',
      56: 'BSC',
      137: 'Polygon',
      43114: 'Avalanche',
      250: 'Fantom',
      42161: 'Arbitrum',
      10: 'Optimism',
    };
    return chainMap[chainId] || `Chain ${chainId}`;
  }

  /**
   * Map PinkSale status to our status
   */
  static mapStatus(status: string): 'upcoming' | 'live' | 'ended' {
    switch (status?.toLowerCase()) {
      case 'upcoming':
      case 'not_started':
        return 'upcoming';
      case 'live':
      case 'active':
        return 'live';
      default:
        return 'ended';
    }
  }

  /**
   * Check if token exists on CoinGecko
   */
  static async checkTokenOnCoinGecko(tokenSymbol: string, contractAddress?: string): Promise<{ exists: boolean; name?: string; symbol?: string }> {
    try {
      // First try by symbol
      const searchResponse = await fetch(`${this.COINGECKO_API_URL}/search?query=${encodeURIComponent(tokenSymbol)}`);
      if (!searchResponse.ok) {
        return { exists: false };
      }

      const searchData = await searchResponse.json();
      if (searchData.coins && searchData.coins.length > 0) {
        // Check if any match our criteria
        const exactMatch = searchData.coins.find((coin: any) =>
          coin.symbol?.toLowerCase() === tokenSymbol.toLowerCase()
        );

        if (exactMatch) {
          return {
            exists: true,
            name: exactMatch.name,
            symbol: exactMatch.symbol
          };
        }
      }

      // If contract address is provided, try to get token info directly
      if (contractAddress) {
        try {
          const tokenResponse = await fetch(`${this.COINGECKO_API_URL}/coins/ethereum/contract/${contractAddress}`);
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            return {
              exists: true,
              name: tokenData.name,
              symbol: tokenData.symbol
            };
          }
        } catch (error) {
          // Contract lookup failed, continue
        }
      }

      return { exists: false };
    } catch (error: any) {
      logger.warn({ error: error.message, tokenSymbol }, 'CoinGecko API check failed');
      return { exists: false }; // Graceful degradation
    }
  }

  /**
   * Check liquidity lock status using PinkSale API
   */
  static async checkLiquidityLock(contractAddress: string, chain: string): Promise<{ locked: boolean; duration?: string }> {
    try {
      // Use PinkSale's own API to check lock status
      // This is a simplified check - in production you might need more specific endpoints
      const lockResponse = await fetch(`${this.PINKLOCK_API_URL}/locks?contract=${contractAddress}&chain=${chain}`);
      if (!lockResponse.ok) {
        return { locked: false };
      }

      const lockData = await lockResponse.json();
      if (lockData.success && lockData.data && lockData.data.length > 0) {
        const lock = lockData.data[0];
        return {
          locked: true,
          duration: lock.duration || 'Unknown duration'
        };
      }

      return { locked: false };
    } catch (error: any) {
      logger.warn({ error: error.message, contractAddress, chain }, 'Liquidity lock check failed');
      return { locked: false }; // Graceful degradation
    }
  }

  /**
   * Enhanced presale processing with additional API checks
   */
  static async processPresaleWithAPIs(presale: PinkSalePresale, userApiKeys?: any): Promise<PinkSalePresale> {
    const enhancedPresale = { ...presale };

    try {
      // Check CoinGecko token existence
      const coingeckoResult = await this.checkTokenOnCoinGecko(presale.symbol, presale.contractAddress);
      enhancedPresale.coingeckoExists = coingeckoResult.exists;
      enhancedPresale.coingeckoName = coingeckoResult.name;
      enhancedPresale.coingeckoSymbol = coingeckoResult.symbol;
    } catch (error) {
      enhancedPresale.coingeckoExists = false;
    }

    try {
      // Check liquidity lock status (override PinkSale's basic flag with more accurate check)
      const lockResult = await this.checkLiquidityLock(presale.contractAddress, presale.chain);
      enhancedPresale.liquidityLocked = lockResult.locked;
      enhancedPresale.lockDuration = lockResult.duration;
    } catch (error) {
      // Keep original PinkSale liquidity lock flag if API fails
    }

    return enhancedPresale;
  }

  /**
   * Get user's alerts
   */
  static async getUserAlerts(uid: string, limit: number = 50): Promise<LaunchpadAlert[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const alertsQuery = db.collection('users').doc(uid).collection('launchpadAlerts')
        .orderBy('createdAt', 'desc')
        .limit(limit);

      const snapshot = await alertsQuery.get();
      return snapshot.docs.map(doc => doc.data() as LaunchpadAlert);
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user alerts');
      return [];
    }
  }

  /**
   * Update user settings
   */
  static async updateUserSettings(uid: string, settings: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userAgentRef = db.collection('users').doc(uid).collection('agents').doc('ai_launchpad_hunter');

      await userAgentRef.set({
        settings,
        updatedAt: new Date(),
      }, { merge: true });

      logger.info({ uid }, 'Updated launchpad hunter settings');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to update user settings');
    }
  }

  /**
   * Get user settings (with decrypted API keys)
   */
  static async getUserSettings(uid: string): Promise<any> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userAgentDoc = await db.collection('users').doc(uid).collection('agents').doc('ai_launchpad_hunter').get();

      if (!userAgentDoc.exists) return {};

      const data = userAgentDoc.data();
      const settings = data?.settings || {};

      // Decrypt API keys if they exist
      if (settings.apiKeys) {
        const { decrypt } = await import('../services/keyManager');
        const decryptedApiKeys: any = {};
        for (const [key, encryptedValue] of Object.entries(settings.apiKeys)) {
          if (encryptedValue && typeof encryptedValue === 'string') {
            try {
              decryptedApiKeys[key] = await decrypt(encryptedValue, 'launchpad');
            } catch (decryptError) {
              logger.warn({ uid, key }, 'Failed to decrypt API key, skipping');
              // Skip this key if decryption fails
            }
          }
        }
        settings.apiKeys = decryptedApiKeys;
      }

      return settings;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user settings');
      return {};
    }
  }
}
