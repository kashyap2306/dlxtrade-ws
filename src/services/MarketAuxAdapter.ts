export interface MarketAuxData {
  sentiment: number;
  hypeScore: number;
  trendScore: number;
  totalArticles: number;
  latestArticles: any[];
}

export class MarketAuxAdapter {
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('MarketAux API key is required');
    }
  }

  async getNewsSentiment(symbol: string): Promise<MarketAuxData> {
    return {
      sentiment: 0,
      hypeScore: 0,
      trendScore: 0,
      totalArticles: 0,
      latestArticles: [],
    };
  }
}
