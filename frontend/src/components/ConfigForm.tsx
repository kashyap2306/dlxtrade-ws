import { useState } from 'react';

interface ConfigFormProps {
  onSubmit: (config: any) => void;
  onStop: () => void;
  loading: boolean;
  isRunning: boolean;
}

export default function ConfigForm({ onSubmit, onStop, loading, isRunning }: ConfigFormProps) {
  const [config, setConfig] = useState({
    symbol: 'BTCUSDT',
    quoteSize: 0.001,
    adversePct: 0.0002,
    cancelMs: 40,
    maxPos: 0.01,
    enabled: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1 text-gray-300">Symbol</label>
        <input
          type="text"
          className="input"
          value={config.symbol}
          onChange={(e) => setConfig({ ...config, symbol: e.target.value.toUpperCase() })}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1 text-gray-300">Quote Size</label>
        <input
          type="number"
          step="0.0001"
          className="input"
          value={config.quoteSize}
          onChange={(e) => setConfig({ ...config, quoteSize: parseFloat(e.target.value) })}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1 text-gray-300">Adverse Selection %</label>
        <input
          type="number"
          step="0.0001"
          className="input"
          value={config.adversePct}
          onChange={(e) => setConfig({ ...config, adversePct: parseFloat(e.target.value) })}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1 text-gray-300">Cancel Time (ms)</label>
        <input
          type="number"
          className="input"
          value={config.cancelMs}
          onChange={(e) => setConfig({ ...config, cancelMs: parseInt(e.target.value, 10) })}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1 text-gray-300">Max Position</label>
        <input
          type="number"
          step="0.0001"
          className="input"
          value={config.maxPos}
          onChange={(e) => setConfig({ ...config, maxPos: parseFloat(e.target.value) })}
          required
        />
      </div>
      <div className="flex space-x-2">
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            className="btn btn-danger flex-1"
            disabled={loading}
          >
            {loading ? 'Stopping...' : 'Stop Engine'}
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary flex-1"
            disabled={loading}
          >
            {loading ? 'Starting...' : 'Start Engine'}
          </button>
        )}
      </div>
    </form>
  );
}

