import { useState, useEffect } from 'react';
import { wsService } from '../services/ws';

interface OrderbookLevel {
  price: string;
  quantity: string;
}

interface OrderbookProps {
  symbol: string;
}

export default function Orderbook({ symbol }: OrderbookProps) {
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [midPrice, setMidPrice] = useState<number | null>(null);
  const [spread, setSpread] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = wsService.subscribe('orderbook', (data: any) => {
      if (data.symbol === symbol) {
        setBids(data.bids.slice(0, 20));
        setAsks(data.asks.slice(0, 20));
        
        if (data.bids.length > 0 && data.asks.length > 0) {
          const bestBid = parseFloat(data.bids[0].price);
          const bestAsk = parseFloat(data.asks[0].price);
          const mid = (bestBid + bestAsk) / 2;
          const spreadValue = bestAsk - bestBid;
          setMidPrice(mid);
          setSpread(spreadValue);
        }
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
    <div className="space-y-3 sm:space-y-4">
      {midPrice && spread && (
        <div className="flex flex-col sm:flex-row justify-between gap-2 sm:gap-0 text-xs sm:text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Mid Price: </span>
            <span className="font-semibold text-white break-all">${formatPrice(midPrice.toString())}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Spread: </span>
            <span className="font-semibold text-white break-all">${formatPrice(spread.toString())}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="min-w-0">
          <h3 className="text-xs sm:text-sm font-semibold text-red-400 mb-2">Bids</h3>
          <div className="space-y-0.5 sm:space-y-1 text-xs max-h-64 sm:max-h-96 overflow-y-auto scrollbar-hide">
            {bids.map((bid, idx) => (
              <div key={idx} className="flex justify-between gap-2">
                <span className="text-red-400 truncate">{formatPrice(bid.price)}</span>
                <span className="text-gray-400 truncate text-right">{formatQty(bid.quantity)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="text-xs sm:text-sm font-semibold text-green-400 mb-2">Asks</h3>
          <div className="space-y-0.5 sm:space-y-1 text-xs max-h-64 sm:max-h-96 overflow-y-auto scrollbar-hide">
            {asks.map((ask, idx) => (
              <div key={idx} className="flex justify-between gap-2">
                <span className="text-green-400 truncate">{formatPrice(ask.price)}</span>
                <span className="text-gray-400 truncate text-right">{formatQty(ask.quantity)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

