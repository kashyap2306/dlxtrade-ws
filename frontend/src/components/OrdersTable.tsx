import { useState, useEffect } from 'react';
import { ordersApi } from '../services/api';

interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  quantity: number;
  price?: number;
  status: string;
  filledQty: number;
  avgPrice: number;
  createdAt: string;
}

export default function OrdersTable() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ symbol: '', status: '' });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await loadOrders();
    };
    run();
    const interval = setInterval(run, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [filter]);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const response = await ordersApi.listOrders({
        ...filter,
        limit: 100,
      });
      setOrders(response.data);
    } catch (err) {
      console.error('Error loading orders:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await ordersApi.cancelOrder(id);
      loadOrders();
    } catch (err) {
      console.error('Error canceling order:', err);
    }
  };

  const exportCSV = () => {
    const headers = ['ID', 'Symbol', 'Side', 'Type', 'Quantity', 'Price', 'Status', 'Filled', 'Avg Price', 'Created'];
    const rows = orders.map((o) => [
      o.id,
      o.symbol,
      o.side,
      o.type,
      o.quantity,
      o.price || '',
      o.status,
      o.filledQty,
      o.avgPrice,
      o.createdAt,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders_${new Date().toISOString()}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <input
            type="text"
            placeholder="Symbol filter"
            value={filter.symbol}
            onChange={(e) => setFilter({ ...filter, symbol: e.target.value })}
            className="input text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 flex-1 min-w-0"
          />
          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            className="input text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 flex-1 sm:flex-initial sm:min-w-[140px]"
          >
            <option value="">All Status</option>
            <option value="NEW">New</option>
            <option value="FILLED">Filled</option>
            <option value="CANCELED">Canceled</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
        <button onClick={exportCSV} className="btn btn-secondary text-sm whitespace-nowrap">
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 scrollbar-hide">
        <table className="min-w-full divide-y divide-purple-500/20">
          <thead className="bg-slate-900/50">
            <tr>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">ID</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Symbol</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Side</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Type</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Qty</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Price</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Status</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Filled</th>
              <th className="px-2 sm:px-4 py-2 text-left text-xs font-medium text-gray-300 uppercase whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-slate-800/40 divide-y divide-purple-500/20">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-center text-gray-400">
                  No orders
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-700/30 transition-colors">
                  <td className="px-2 sm:px-4 py-2 text-xs text-gray-200 truncate max-w-[80px] sm:max-w-none">{order.id.slice(0, 8)}...</td>
                  <td className="px-2 sm:px-4 py-2 text-xs text-gray-200 whitespace-nowrap">{order.symbol}</td>
                  <td className={`px-2 sm:px-4 py-2 text-xs whitespace-nowrap ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {order.side}
                  </td>
                  <td className="px-2 sm:px-4 py-2 text-xs text-gray-200 whitespace-nowrap">{order.type}</td>
                  <td className="px-2 sm:px-4 py-2 text-xs text-gray-200 whitespace-nowrap">{order.quantity}</td>
                  <td className="px-2 sm:px-4 py-2 text-xs text-gray-200 whitespace-nowrap">{order.price || '-'}</td>
                  <td className="px-2 sm:px-4 py-2 text-xs">
                    <span className={`px-1.5 sm:px-2 py-1 rounded text-xs whitespace-nowrap ${
                      order.status === 'FILLED' ? 'bg-green-500/20 text-green-300 border border-green-400/30' :
                      order.status === 'CANCELED' ? 'bg-gray-500/20 text-gray-300 border border-gray-400/30' :
                      order.status === 'REJECTED' ? 'bg-red-500/20 text-red-300 border border-red-400/30' :
                      'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30'
                    }`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-2 text-xs text-gray-200 whitespace-nowrap">{order.filledQty}</td>
                  <td className="px-2 sm:px-4 py-2 text-xs whitespace-nowrap">
                    {order.status !== 'FILLED' && order.status !== 'CANCELED' && (
                      <button
                        onClick={() => handleCancel(order.id)}
                        className="text-red-400 hover:text-red-300 text-xs transition-colors px-2 py-1 rounded hover:bg-red-500/10"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

