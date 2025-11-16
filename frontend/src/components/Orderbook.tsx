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
    <div className="space-y-4">
      {midPrice && spread && (
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-gray-400">Mid Price: </span>
            <span className="font-semibold text-white">${formatPrice(midPrice.toString())}</span>
          </div>
          <div>
            <span className="text-gray-400">Spread: </span>
            <span className="font-semibold text-white">${formatPrice(spread.toString())}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold text-red-400 mb-2">Bids</h3>
          <div className="space-y-1 text-xs">
            {bids.map((bid, idx) => (
              <div key={idx} className="flex justify-between">
                <span className="text-red-400">{formatPrice(bid.price)}</span>
                <span className="text-gray-400">{formatQty(bid.quantity)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-green-400 mb-2">Asks</h3>
          <div className="space-y-1 text-xs">
            {asks.map((ask, idx) => (
              <div key={idx} className="flex justify-between">
                <span className="text-green-400">{formatPrice(ask.price)}</span>
                <span className="text-gray-400">{formatQty(ask.quantity)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

