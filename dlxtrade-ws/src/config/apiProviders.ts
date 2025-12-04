/**
 * Central API Providers Configuration
 * Defines all available providers with their configuration
 */

export interface ProviderConfig {
  providerName: string;
  id: string;
  type: 'marketData' | 'news' | 'metadata';
  apiKeyRequired: boolean;
  primary: boolean;
  url: string;
}

export interface ApiProvidersConfig {
  marketData: {
    primary: ProviderConfig;
    backups: ProviderConfig[];
  };
  news: {
    primary: ProviderConfig;
    backups: ProviderConfig[];
  };
  metadata: {
    primary: ProviderConfig;
    backups: ProviderConfig[];
  };
}

// Single source of truth for all API providers
export const API_PROVIDERS_CONFIG: ApiProvidersConfig = {
  marketData: {
    primary: {
      providerName: "CoinGecko",
      id: "coingecko",
      type: "marketData",
      apiKeyRequired: false,
      primary: true,
      url: "https://api.coingecko.com/api/v3/"
    },
    backups: [
      {
        providerName: "BraveNewCoin",
        id: "bravenewcoin",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://bravenewcoin.p.rapidapi.com/"
      },
      {
        providerName: "CoinAPI",
        id: "coinapi",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://rest.coinapi.io/"
      },
      {
        providerName: "CoinCheckup",
        id: "coincheckup",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coincheckup.com/v1/"
      },
      {
        providerName: "CoinLore",
        id: "coinlore",
        type: "marketData",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coinlore.net/api/"
      },
      {
        providerName: "CoinMarketCap",
        id: "coinmarketcap",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://pro-api.coinmarketcap.com/v1/"
      },
      {
        providerName: "CoinPaprika",
        id: "coinpaprika",
        type: "marketData",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coinpaprika.com/v1/"
      },
      {
        providerName: "CoinStats",
        id: "coinstats",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coinstats.app/public/v1/"
      },
      {
        providerName: "Kaiko",
        id: "kaiko",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://us.market-api.kaiko.io/"
      },
      {
        providerName: "LiveCoinWatch",
        id: "livecoinwatch",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.livecoinwatch.com/"
      },
      {
        providerName: "Messari",
        id: "messari",
        type: "marketData",
        apiKeyRequired: true,
        primary: false,
        url: "https://data.messari.io/api/v1/"
      }
    ]
  },
  news: {
    primary: {
      providerName: "NewsData.io",
      id: "newsdataio",
      type: "news",
      apiKeyRequired: true,
      primary: true,
      url: "https://newsdata.io/api/1/"
    },
    backups: [
      {
        providerName: "BingNews",
        id: "bingnews",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.bing.microsoft.com/v7.0/news/search"
      },
      {
        providerName: "ContextualWeb",
        id: "contextualweb",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://contextualweb.io/api/v1/"
      },
      {
        providerName: "CryptoPanic",
        id: "cryptopanic",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://cryptopanic.com/api/v1/"
      },
      {
        providerName: "GNews",
        id: "gnews",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://gnews.io/api/v4/"
      },
      {
        providerName: "MediaStack",
        id: "mediastack",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.mediastack.com/v1/"
      },
      {
        providerName: "NewsCatcher",
        id: "newscatcher",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.newscatcherapi.com/v3/"
      },
      {
        providerName: "NewsData.io",
        id: "newsdataio",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://newsdata.io/api/1/"
      },
      {
        providerName: "Reddit",
        id: "reddit",
        type: "news",
        apiKeyRequired: false,
        primary: false,
        url: "https://www.reddit.com/r/cryptocurrency/"
      },
      {
        providerName: "Webz.io",
        id: "webzio",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.webz.io/"
      },
      {
        providerName: "YahooNews",
        id: "yahoonews",
        type: "news",
        apiKeyRequired: false,
        primary: false,
        url: "https://news.search.yahoo.com/"
      }
    ]
  },
  metadata: {
    primary: {
      providerName: "CryptoCompare",
      id: "cryptocompare",
      type: "metadata",
      apiKeyRequired: true,
      primary: true,
      url: "https://min-api.cryptocompare.com/data/"
    },
    backups: [
      {
        providerName: "CoinCap",
        id: "coincap",
        type: "metadata",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coincap.io/v2/"
      },
      {
        providerName: "CoinGecko",
        id: "coingecko",
        type: "metadata",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coingecko.com/api/v3/"
      },
      {
        providerName: "CoinMarketCap",
        id: "coinmarketcap",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://pro-api.coinmarketcap.com/v1/"
      },
      {
        providerName: "CoinPaprika",
        id: "coinpaprika",
        type: "metadata",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coinpaprika.com/v1/"
      },
      {
        providerName: "CoinRanking",
        id: "coinranking",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coinranking.com/v2/"
      },
      {
        providerName: "CoinStats",
        id: "coinstats",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coinstats.app/public/v1/"
      },
      {
        providerName: "CryptoCompare",
        id: "cryptocompare",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://min-api.cryptocompare.com/data/"
      },
      {
        providerName: "LiveCoinWatch",
        id: "livecoinwatch",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.livecoinwatch.com/"
      },
      {
        providerName: "Messari",
        id: "messari",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://data.messari.io/api/v1/"
      },
      {
        providerName: "Nomics",
        id: "nomics",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.nomics.com/v1/"
      }
    ]
  }
};

/**
 * Get all providers for a specific type
 */
export function getProvidersForType(type: keyof ApiProvidersConfig): ProviderConfig[] {
  const config = API_PROVIDERS_CONFIG[type];
  return [config.primary, ...config.backups];
}

/**
 * Get all providers as a flat array
 */
export function getAllProviders(): ProviderConfig[] {
  const allProviders: ProviderConfig[] = [];
  Object.values(API_PROVIDERS_CONFIG).forEach(config => {
    allProviders.push(config.primary, ...config.backups);
  });
  return allProviders;
}

/**
 * Get provider by ID
 */
export function getProviderById(id: string): ProviderConfig | undefined {
  return getAllProviders().find(provider => provider.id === id);
}

/**
 * Check if provider requires API key
 */
export function providerRequiresApiKey(providerId: string): boolean {
  const provider = getProviderById(providerId);
  return provider?.apiKeyRequired ?? false;
}

export default API_PROVIDERS_CONFIG;
