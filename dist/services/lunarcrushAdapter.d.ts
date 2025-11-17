export interface LunarCrushData {
    socialScore?: number;
    socialVolume?: number;
    marketCapRank?: number;
    altRank?: number;
    sentiment?: number;
    bullishSentiment?: number;
}
export declare class LunarCrushAdapter {
    private apiKey;
    private baseUrl;
    private httpClient;
    constructor(apiKey: string);
    getCoinData(symbol: string): Promise<LunarCrushData>;
}
//# sourceMappingURL=lunarcrushAdapter.d.ts.map