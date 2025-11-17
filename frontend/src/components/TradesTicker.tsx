import { useState, useEffect } from 'react';
import { wsService } from '../services/ws';

interface Trade {
  id: string;
  price: string;
  quantity: string;
  time: number;
  isBuyerMaker: boolean;
}

interface TradesTickerProps {
  symbol: string;
}

export default function TradesTicker({ symbol }: TradesTickerProps) {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    const unsubscribe = wsService.subscribe('trade', (data: any) => {
      if (data.symbol === symbol) {
        setTrades((prev) => [data, ...prev].slice(0, 50));
      }
    });

    return () => unsubscribe();
  }, [symbol]);

  const formatPrice = (price: string) => {
    return parseFloat(price).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
  };

  const formatQty = (qty: string) => {
    return parseFloat(qty).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8,
    });
  };

  return (
    <div className="max-h-96 overflow-y-auto">
      <div className="space-y-1 text-xs">
        {trades.length === 0 ? (
          <p className="text-gray-400 text-center py-4">No trades yet</p>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.id}
              className={`flex justify-between py-1 px-2 rounded ${
                trade.isBuyerMaker ? 'bg-red-500/10 border-l-2 border-red-400/30' : 'bg-green-500/10 border-l-2 border-green-400/30'
              }`}
            >
              <span className={trade.isBuyerMaker ? 'text-red-400' : 'text-green-400'}>
                ${formatPrice(trade.price)}
              </span>
              <span className="text-gray-300">{formatQty(trade.quantity)}</span>
              <span className="text-gray-500">
                {new Date(trade.time).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

