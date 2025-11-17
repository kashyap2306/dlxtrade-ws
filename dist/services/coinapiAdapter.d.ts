export interface CoinAPIData {
    price?: number;
    volume24h?: number;
    priceChange24h?: number;
    priceChangePercent24h?: number;
    historicalData?: Array<{
        time: string;
        price: number;
    }>;
    exchangeRate?: number;
}
export declare class CoinAPIAdapter {
    private apiKey;
    private apiType;
    private baseUrl;
    private httpClient;
    constructor(apiKey: string, apiType: 'market' | 'flatfile' | 'exchangerate');
    getMarketData(symbol: string): Promise<CoinAPIData>;
    getHistoricalData(symbol: string, days?: number): Promise<CoinAPIData>;
    getExchangeRate(baseAsset: string, quoteAsset?: string): Promise<CoinAPIData>;
}
//# sourceMappingURL=coinapiAdapter.d.ts.map