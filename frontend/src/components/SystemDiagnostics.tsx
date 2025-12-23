import React, { useState, useEffect } from 'react';
import { autoTradeApi } from '../services/api';
import { ChevronDownIcon, ChevronUpIcon, BeakerIcon } from '@heroicons/react/24/outline';

export const SystemDiagnostics: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const fetchDiagnostics = async () => {
        try {
            setLoading(true);
            const resp = await autoTradeApi.getDiagnostics();
            setData(resp.data);
        } catch (e) {
            console.error('Failed to fetch diagnostics', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchDiagnostics();
            const interval = setInterval(fetchDiagnostics, 30000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    const renderStatus = (status: string) => {
        const colors: any = {
            'ACTIVE': 'bg-green-500/20 text-green-400 border-green-500/30',
            'RUNNING': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
            'WAITING': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
            'IDLE': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
            'DISABLED': 'bg-red-500/20 text-red-400 border-red-500/30'
        };
        return (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${colors[status] || colors.IDLE}`}>
                {status}
            </span>
        );
    };

    const formatTime = (time: string | null) => {
        if (!time) return 'Never';
        return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="mt-8 border border-white/10 rounded-xl overflow-hidden bg-slate-900/20">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <BeakerIcon className="w-5 h-5 text-purple-400" />
                    <span className="text-sm font-semibold text-gray-300">System Diagnostics</span>
                </div>
                {isOpen ? <ChevronUpIcon className="w-4 h-4 text-gray-400" /> : <ChevronDownIcon className="w-4 h-4 text-gray-400" />}
            </button>

            {isOpen && (
                <div className="p-4 pt-0 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    {loading && !data ? (
                        <div className="py-4 text-center text-xs text-gray-500">Retrieving system state...</div>
                    ) : data ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Auto Trade */}
                            <div className="p-3 rounded-lg bg-slate-800/40 border border-white/5 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Auto Trade</span>
                                    {renderStatus(data.autoTrade?.status)}
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[11px] text-gray-300 flex justify-between">
                                        <span>Eval:</span>
                                        <span className="text-gray-400">{formatTime(data.autoTrade?.lastEvaluation)}</span>
                                    </p>
                                    <p className="text-[11px] text-gray-500 leading-tight italic border-t border-white/5 pt-1">
                                        {data.autoTrade?.reason}
                                    </p>
                                </div>
                            </div>

                            {/* Background Research */}
                            <div className="p-3 rounded-lg bg-slate-800/40 border border-white/5 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Research</span>
                                    {renderStatus(data.backgroundResearch?.status)}
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[11px] text-gray-300 flex justify-between">
                                        <span>Last:</span>
                                        <span className="text-gray-400">{formatTime(data.backgroundResearch?.lastRunAt)}</span>
                                    </p>
                                    <p className="text-[11px] text-gray-300 flex justify-between">
                                        <span>Next:</span>
                                        <span className="text-gray-400">{formatTime(data.backgroundResearch?.nextRunAt)}</span>
                                    </p>
                                </div>
                            </div>

                            {/* Accuracy Alerts */}
                            <div className="p-3 rounded-lg bg-slate-800/40 border border-white/5 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Alerts</span>
                                    {renderStatus(data.accuracyAlerts?.status)}
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[11px] text-gray-300 flex justify-between">
                                        <span>Last Acc:</span>
                                        <span className="text-gray-400">{data.accuracyAlerts?.lastAccuracyChecked}%</span>
                                    </p>
                                    <p className="text-[11px] text-gray-300 flex justify-between">
                                        <span>Sent:</span>
                                        <span className="text-gray-400">{formatTime(data.accuracyAlerts?.lastAlertSentAt)}</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-4 text-center text-xs text-red-400">Unable to load diagnostics</div>
                    )}
                </div>
            )}
        </div>
    );
};
