import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { walletApi } from '../../services/api';
import { suppressConsoleError } from '../../utils/errorHandler';
import { ArrowPathIcon, CheckCircleIcon, XCircleIcon, PlusIcon } from '@heroicons/react/24/outline';
import {
  BinanceLogo,
  BybitLogo,
  KuCoinLogo,
  OKXLogo,
  CoinbaseLogo,
  BitgetLogo,
  KrakenLogo,
  GateIOLogo,
  BingXLogo,
  WEEXLogo,
} from '../exchangeLogos';

interface Balance {
  asset: string;
  free: number;
  locked: number;
  usdValue: number;
}

interface WalletData {
  exchange: string;
  connected: boolean;
  balances: Balance[];
  totalUsdValue: number;
}

const EXCHANGE_LOGOS: Record<string, React.ComponentType<{ className?: string }>> = {
  binance: BinanceLogo,
  bybit: BybitLogo,
  kucoin: KuCoinLogo,
  okx: OKXLogo,
  coinbase: CoinbaseLogo,
  bitget: BitgetLogo,
  kraken: KrakenLogo,
  gateio: GateIOLogo,
  bingx: BingXLogo,
  weex: WEEXLogo,
};

const EXCHANGE_NAMES: Record<string, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
  kucoin: 'KuCoin',
  okx: 'OKX',
  coinbase: 'Coinbase',
  bitget: 'Bitget',
  kraken: 'Kraken',
  gateio: 'Gate.io',
  bingx: 'BingX',
  weex: 'WEEX',
};

interface WalletCardProps {
  onConnectClick?: () => void;
}

export default React.memo(function WalletCard({ onConnectClick }: WalletCardProps) {
  const { user } = useAuth();
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  // Cache TTL: 30 seconds
  const CACHE_TTL = 30000;

  const fetchBalances = useCallback(async (force = false) => {
    if (!user) return;

    // Check cache
    if (!force && lastFetch && Date.now() - lastFetch < CACHE_TTL) {
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const response = await walletApi.getBalances();
      setWalletData(response.data);
      setLastFetch(Date.now());
    } catch (err: any) {
      suppressConsoleError(err, 'fetchWalletBalances');
      if (err.response?.status === 404 || err.response?.status === 400) {
        // No exchange connected
        setWalletData({
          exchange: '',
          connected: false,
          balances: [],
          totalUsdValue: 0,
        });
      } else {
        setError('Could not fetch balances');
      }
    } finally {
      setRefreshing(false);
    }
  }, [user, lastFetch]);

  useEffect(() => {
    if (user) {
      fetchBalances();
    }
  }, [user, fetchBalances]);

  const handleRefresh = useCallback(() => {
    fetchBalances(true);
  }, [fetchBalances]);

  const sortedBalances = useMemo(() => {
    if (!walletData?.balances) return [];
    return [...walletData.balances].sort((a, b) => b.usdValue - a.usdValue);
  }, [walletData?.balances]);

  const ExchangeLogo = walletData?.exchange
    ? EXCHANGE_LOGOS[walletData.exchange.toLowerCase()]
    : null;
  const exchangeName = walletData?.exchange
    ? EXCHANGE_NAMES[walletData.exchange.toLowerCase()] || walletData.exchange
    : null;

  if (!walletData) {
    return (
      <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700/50 rounded w-1/3"></div>
          <div className="h-20 bg-gray-700/50 rounded"></div>
        </div>
      </div>
    );
  }

  if (!walletData.connected) {
    return (
      <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
          Wallet
        </h2>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <XCircleIcon className="w-12 h-12 text-gray-500 mb-3" />
          <p className="text-gray-400 mb-4">Not connected</p>
          {onConnectClick && (
            <button
              onClick={onConnectClick}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all"
            >
              <PlusIcon className="w-5 h-5" />
              Connect Exchange
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          Wallet
        </h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          aria-label="Refresh balances"
        >
          <ArrowPathIcon className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Exchange Info */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-black/40 rounded-lg">
        {ExchangeLogo && (
          <div className="w-10 h-10 flex items-center justify-center">
            <ExchangeLogo className="w-full h-full" />
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">{exchangeName}</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
              <CheckCircleIcon className="w-3 h-3 mr-1" />
              Connected
            </span>
          </div>
        </div>
      </div>

      {/* Total Balance */}
      <div className="mb-4 p-4 bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-xl border border-purple-500/30">
        <div className="text-sm text-gray-400 mb-1">Total Balance</div>
        <div className="text-2xl font-bold text-white">
          ${walletData.totalUsdValue.toFixed(2)}
        </div>
      </div>

      {/* Balance List */}
      {sortedBalances.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {sortedBalances
            .filter((b) => b.usdValue > 0.01) // Only show balances > $0.01
            .map((balance) => (
              <div
                key={balance.asset}
                className="flex items-center justify-between p-3 bg-black/40 rounded-lg hover:bg-black/60 transition-colors"
              >
                <div>
                  <div className="text-white font-medium">{balance.asset}</div>
                  <div className="text-xs text-gray-400">
                    Free: {balance.free.toFixed(8)} | Locked: {balance.locked.toFixed(8)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-white font-semibold">
                    ${balance.usdValue.toFixed(2)}
                  </div>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="text-center py-4 text-gray-400 text-sm">No balances available</div>
      )}
    </div>
  );
});

