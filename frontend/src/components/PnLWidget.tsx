import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { tradesApi, usersApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function PnLWidget() {
  const { user } = useAuth();
  const [pnlData, setPnlData] = useState<any[]>([]);
  const [dailyPnL, setDailyPnL] = useState<number>(0);
  const [totalPnL, setTotalPnL] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadPnL();
      const interval = setInterval(loadPnL, 30000); // Update every 30 seconds
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadPnL = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch user data for total PnL
      const userResponse = await usersApi.get(user.uid);
      console.log('User PnL API response:', userResponse.data);
      const userTotalPnL = userResponse.data?.totalPnL || 0;
      setTotalPnL(userTotalPnL);

      // Fetch recent trades to calculate daily PnL and chart data
      const tradesResponse = await tradesApi.get({ uid: user.uid, limit: 100 });
      console.log('Trades API response:', tradesResponse.data);
      const trades = tradesResponse.data.trades || [];
      
      // Group trades by date and calculate daily PnL
      const today = new Date().toISOString().split('T')[0];
      const dailyPnLValue = trades
        .filter((trade: any) => {
          const tradeDate = trade.timestamp ? new Date(trade.timestamp).toISOString().split('T')[0] : '';
          return tradeDate === today;
        })
        .reduce((sum: number, trade: any) => sum + (trade.pnl || 0), 0);
      setDailyPnL(dailyPnLValue);

      // Create chart data from last 30 days of trades
      const last30Days = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const dayPnL = trades
          .filter((trade: any) => {
            const tradeDate = trade.timestamp ? new Date(trade.timestamp).toISOString().split('T')[0] : '';
            return tradeDate === dateStr;
          })
          .reduce((sum: number, trade: any) => sum + (trade.pnl || 0), 0);
        return {
          date: dateStr,
          pnl: dayPnL,
        };
      });
      
      setPnlData(last30Days);
    } catch (err: any) {
      console.error('Error loading PnL:', err);
      // Don't show toast here as it's a widget, just log the error
    } finally {
      setLoading(false);
    }
  };

  if (loading && pnlData.length === 0) {
    return (
      <div className="card">
        <h2 className="text-xl font-semibold mb-4 text-white">PnL & Performance</h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading PnL data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4 text-white">PnL & Performance</h2>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-400">Daily PnL</div>
            <div className={`text-2xl font-bold ${dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${dailyPnL.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Total PnL</div>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${totalPnL.toFixed(2)}
            </div>
          </div>
        </div>
        <div className="h-64">
          {pnlData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" />
                <XAxis dataKey="date" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #7c3aed', borderRadius: '8px', color: '#e5e7eb' }} />
                <Line type="monotone" dataKey="pnl" stroke="#a855f7" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              No PnL data available yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

