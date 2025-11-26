// Research Page Types
export interface SymbolSummary {
  symbol: string;
  price: number;
  change24h: number;
  vol24h: number;
  marketCap?: number;
  volatility?: number;
  lastUpdated?: string;
}

export interface ResearchRunSummary {
  id: string;
  symbols: string[];
  timestamp: string;
  verdict: 'neutral' | 'watch' | 'opportunity' | 'risk';
  shortNote?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed';
  isNew?: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  timestamp: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
  snippet?: string;
  symbol?: string;
  isSignal?: boolean;
}

export interface ProviderStatus {
  name: string;
  status: 'ok' | 'key_missing' | 'slow' | 'error';
  hasKey: boolean;
  lastChecked: string;
  error?: string;
}

export interface PriceHistoryPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TopPerformer {
  symbol: string;
  changePercent: number;
  price: number;
  volume: number;
  marketCap?: number;
}

export interface MarketSnapshot {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap?: number;
  volatility24h?: number;
  high24h?: number;
  low24h?: number;
}

export interface DeepResearchOptions {
  dateRange?: {
    start: string;
    end: string;
  };
  timeframes?: string[];
  includeNews?: boolean;
  includeOnChain?: boolean;
  includeSocial?: boolean;
}

export interface DeepResearchRequest {
  filterType: 'single' | 'top10' | 'top100' | 'custom';
  symbol?: string;
  symbols?: string[];
  options?: DeepResearchOptions;
}

export interface ResearchHistoryPage {
  items: ResearchRunSummary[];
  page: number;
  size: number;
  total: number;
  hasMore: boolean;
}

// Settings and State Types
export interface ResearchSettings {
  autoTradeOn: boolean;
  autoLoadLastSymbol: boolean;
  realTimePricesOn: boolean;
  newsOn: boolean;
  refreshInterval: number; // in seconds
}

export interface ResearchPageState {
  currentSymbol: string;
  activeChartSymbol: string;
  selectedTimeframe: '1h' | '4h' | '24h' | '7d' | '30d';
  researchHistory: ResearchHistoryPage;
  topPerformers: TopPerformer[];
  providerStatuses: ProviderStatus[];
  settings: ResearchSettings;
  recentSearches: string[];
  favoriteSymbols: string[];
}

// UI Component Props Types
export interface SearchBarProps {
  onSymbolSelect: (symbol: string) => void;
  onQuickSelect: (symbols: string[]) => void;
  recentSymbols: string[];
  favoriteSymbols: string[];
  isLoading?: boolean;
}

export interface ProviderStatusCardProps {
  providers: ProviderStatus[];
  onAddApiKey?: (provider: string) => void;
}

export interface MarketSnapshotCardProps {
  snapshot: MarketSnapshot;
  isLoading?: boolean;
}

export interface PriceChartBlockProps {
  symbol: string;
  timeframe: string;
  topPerformers: TopPerformer[];
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: string) => void;
  isLoading?: boolean;
}

export interface DeepResearchFiltersProps {
  onSubmit: (request: DeepResearchRequest) => void;
  isRunning: boolean;
  currentSymbol?: string;
}

export interface ResearchHistoryProps {
  history: ResearchHistoryPage;
  onLoadMore: () => void;
  onViewDetails: (runId: string) => void;
  isLoading?: boolean;
}

export interface NewsOverviewProps {
  news: NewsItem[];
  onArticleClick: (url: string) => void;
  onSave: (newsId: string) => void;
  onDismiss: (newsId: string) => void;
  isLoading?: boolean;
}

// API Response Types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  error?: string;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
}

export interface DeepResearchResult {
  id: string;
  symbols: string[];
  results: any[]; // Full research data
  summary: ResearchRunSummary;
  timestamp: string;
}
