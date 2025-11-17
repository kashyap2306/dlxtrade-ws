export interface CryptoQuantData {
    exchangeFlow?: number;
    exchangeInflow?: number;
    exchangeOutflow?: number;
    whaleTransactions?: number;
    activeAddresses?: number;
}
export declare class CryptoQuantAdapter {
    private apiKey;
    private baseUrl;
    private httpClient;
    constructor(apiKey: string);
    getExchangeFlow(symbol: string): Promise<CryptoQuantData>;
    getOnChainMetrics(symbol: string): Promise<CryptoQuantData>;
}
//# sourceMappingURL=cryptoquantAdapter.d.ts.map