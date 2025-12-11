// Provider configuration constants
export const PROVIDER_CONFIG = {
  marketData: {
    icon: "📊",
    bgColor: "bg-blue-500",
    title: "Market Data Providers",
    description: "Real-time price, volume, and OHLC data",
    primary: {
      name: "CoinGecko",
      key: "coinGeckoKey",
      placeholder: "Enter CoinGecko API key"
    },
    backups: [
      { name: "CoinPaprika", key: "coinPaprikaKey", enabledKey: "coinPaprikaEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinMarketCap", key: "coinMarketCapKey", enabledKey: "coinMarketCapEnabled", type: "api", placeholder: "Enter CoinMarketCap API key" },
      { name: "CoinLore", key: "coinLoreKey", enabledKey: "coinLoreEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinAPI", key: "coinApiKey", enabledKey: "coinApiEnabled", type: "api", placeholder: "Enter CoinAPI key" },
      { name: "BraveNewCoin", key: "braveNewCoinKey", enabledKey: "braveNewCoinEnabled", type: "api", placeholder: "Enter BraveNewCoin API key" },
      { name: "Messari", key: "messariKey", enabledKey: "messariEnabled", type: "api", placeholder: "Enter Messari API key" },
      { name: "Kaiko", key: "kaikoKey", enabledKey: "kaikoEnabled", type: "api", placeholder: "Enter Kaiko API key" },
      { name: "LiveCoinWatch", key: "liveCoinWatchKey", enabledKey: "liveCoinWatchEnabled", type: "api", placeholder: "Enter LiveCoinWatch API key" },
      { name: "CoinStats", key: "coinStatsKey", enabledKey: "coinStatsEnabled", type: "api", placeholder: "Enter CoinStats API key" },
      { name: "CoinCheckup", key: "coinCheckupKey", enabledKey: "coinCheckupEnabled", type: "free", placeholder: "API Not Required" }
    ]
  },
  news: {
    icon: "📰",
    bgColor: "bg-green-500",
    title: "News Providers",
    description: "Sentiment analysis and market news",
    primary: {
      name: "NewsData.io",
      key: "newsDataKey",
      placeholder: "Enter NewsData.io API key"
    },
    backups: [
      { name: "CryptoPanic", key: "cryptoPanicKey", enabledKey: "cryptoPanicEnabled", type: "api", placeholder: "Enter CryptoPanic API key" },
      { name: "Reddit", key: "redditKey", enabledKey: "redditEnabled", type: "free", placeholder: "API Not Required" },
      { name: "Cointelegraph RSS", key: "cointelegraphKey", enabledKey: "cointelegraphEnabled", type: "free", placeholder: "API Not Required" },
      { name: "AltcoinBuzz RSS", key: "altcoinBuzzKey", enabledKey: "altcoinBuzzEnabled", type: "free", placeholder: "API Not Required" },
      { name: "GNews", key: "gnewsKey", enabledKey: "gnewsEnabled", type: "api", placeholder: "Enter GNews API key" },
      { name: "Marketaux", key: "marketauxKey", enabledKey: "marketauxEnabled", type: "api", placeholder: "Enter Marketaux API key" },
      { name: "Webz.io", key: "webzKey", enabledKey: "webzEnabled", type: "api", placeholder: "Enter Webz.io API key" },
      { name: "CoinStatsNews", key: "coinStatsNewsKey", enabledKey: "coinStatsNewsEnabled", type: "free", placeholder: "API Not Required" },
      { name: "NewsCatcher", key: "newsCatcherKey", enabledKey: "newsCatcherEnabled", type: "api", placeholder: "Enter NewsCatcher API key" },
      { name: "CryptoCompare News", key: "cryptoCompareNewsKey", enabledKey: "cryptoCompareNewsEnabled", type: "api", placeholder: "Enter CryptoCompare News API key" }
    ]
  },
  metadata: {
    icon: "📈",
    bgColor: "bg-purple-500",
    title: "Metadata Providers",
    description: "Market cap, supply, and asset information",
    primary: {
      name: "CryptoCompare",
      key: "cryptoCompareKey",
      placeholder: "Enter CryptoCompare API key"
    },
    backups: [
      { name: "CoinGecko", key: "coinGeckoKey", enabledKey: "coinGeckoEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinPaprika", key: "coinPaprikaKey", enabledKey: "coinPaprikaEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinMarketCap", key: "coinMarketCapKey", enabledKey: "coinMarketCapEnabled", type: "api", placeholder: "Enter CoinMarketCap API key" },
      { name: "CoinStats", key: "coinStatsKey", enabledKey: "coinStatsEnabled", type: "api", placeholder: "Enter CoinStats API key" },
      { name: "CryptoCompare", key: "cryptoCompareKey", enabledKey: "cryptoCompareEnabled", type: "api", placeholder: "Enter CryptoCompare API key" },
      { name: "LiveCoinWatch", key: "liveCoinWatchKey", enabledKey: "liveCoinWatchEnabled", type: "api", placeholder: "Enter LiveCoinWatch API key" },
      { name: "Messari", key: "messariKey", enabledKey: "messariEnabled", type: "api", placeholder: "Enter Messari API key" },
      { name: "CoinLore", key: "coinLoreKey", enabledKey: "coinLoreEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinCheckup", key: "coinCheckupKey", enabledKey: "coinCheckupEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinCap.io", key: "coinCapKey", enabledKey: "coinCapEnabled", type: "free", placeholder: "API Not Required" }
    ]
  }
};

// API name mapping for provider handling
export const API_NAME_MAP: Record<string, string> = {
  // Primary Providers
  'CoinGecko': 'coingecko',
  'NewsData.io': 'newsdata',
  'CryptoCompare': 'cryptocompare',
  // Market Data Backups
  'CoinPaprika': 'coinpaprika',
  'CoinMarketCap': 'coinmarketcap',
  'CoinLore': 'coinlore',
  'CoinAPI': 'coinapi',
  'BraveNewCoin': 'bravenewcoin',
  'Messari': 'messari',
  'Kaiko': 'kaiko',
  'LiveCoinWatch': 'livecoinwatch',
  'CoinStats': 'coinstats',
  'CoinCheckup': 'coincheckup',
  // News Backups
  'CryptoPanic': 'cryptopanic',
  'Reddit': 'reddit',
  'Cointelegraph RSS': 'cointelegraph_rss',
  'AltcoinBuzz RSS': 'altcoinbuzz_rss',
  'GNews': 'gnews',
  'Marketaux': 'marketaux',
  'Webz.io': 'webzio',
  'CoinStatsNews': 'coinstatsnews',
  'NewsCatcher': 'newscatcher',
  'CryptoCompare News': 'cryptocompare_news',
  // Metadata Backups
  'CoinCap.io': 'coincap',
  'CoinRanking': 'coinranking',
  'Nomics': 'nomics'
};
