// FREE MODE Deep Research v1.5 interfaces
export interface ProviderBackupConfig {
  primary: string;
  backups: string[];
}

export interface FreeModeProviderResult {
  success: boolean;
  data: any;
  latencyMs: number;
  provider: string;
  error?: string;
}

export interface TradePlan {
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskRewardRatio: number;
}

export interface FreeModeDeepResearchResult {
  signal: 'BUY' | 'SELL' | 'HOLD' | 'ANALYZING' | 'PENDING';
  accuracy: number;
  price?: number;
  snapshotAccuracy: number;
  tradePlan?: TradePlan;
  accuracyBreakdown: {
    indicatorScore: number;
    marketStructureScore: number;
    momentumScore: number;
    volumeScore: number;
    newsScore: number;
    riskPenalty: number;
  };
  accuracyWeightsUsed: Record<string, number>;
  indicators: {
    rsi: any;
    ma50: any;
    ma200: any;
    ema20: any;
    ema50: any;
    macd: any;
    volume: any;
    vwap: any;
    atr: any;
    pattern: any;
    momentum: any;
    price?: number;
    status?: 'completed' | 'partial';
  };
  metadata: any;
  news: any;
  raw: {
    marketData: any;
    cryptocompare: any;
    metadata: any;
    news: any;
  };
  providers: {
    marketData: any;
    metadata: any;
    news: any;
    cryptocompare?: any;
  };
  coinImages?: string[];
  structuredAnalysis?: any;
  partial?: boolean; // True if result is partial due to timeout but has usable data
  stages?: Record<string, { status: string }>;
  isFinal?: boolean; // True when research is complete and final
  isProcessing?: boolean; // True when research is still in progress
  analysis?: any; // Task 7: Consolidated analysis structure
}

export interface ProviderConfirmation {
  name: string;
  status: 'success' | 'failed' | 'rate-limited' | 'fallback';
  latencyMs: number;
  confirmationDeltaPercent?: number;
  raw?: any;
}

