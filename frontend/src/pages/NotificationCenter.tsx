import React, { useState, useMemo } from 'react';
import { useNotificationContext, Notification } from '../contexts/NotificationContext';
import { autoTradeApi } from '../services/api'; // Import API for approvals
import Toast from '../components/Toast'; // Import Toast
import {
    CheckCircleIcon,
    ExclamationTriangleIcon,
    XCircleIcon,
    InformationCircleIcon,
    BellIcon,
    ChartBarIcon,
    BoltIcon, // Using BoltIcon for both autoTrade and confirmTrade in general icon getter, but we'll override for category tabs
    CurrencyDollarIcon,
    CpuChipIcon,
    CheckIcon, // For "Confirm"
    XMarkIcon  // For "Reject"
} from '@heroicons/react/24/outline';

const NotificationCenter: React.FC = () => {
    const { notifications, markAsRead, markAllAsRead, loading, refresh } = useNotificationContext();
    // Add 'confirm' to activeTab type
    const [activeTab, setActiveTab] = useState<'all' | 'confirm' | 'trade' | 'accuracy' | 'whale' | 'system'>('all');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [processingId, setProcessingId] = useState<string | null>(null); // Track ID being processed

    // Mapping categories to notification types
    const categoryMap = {
        confirm: ['confirmTrade'], // New category
        trade: ['autoTrade'], // Removed confirmTrade from here to isolate it
        accuracy: ['accuracy'],
        whale: ['whale'],
        system: ['info', 'warning', 'error', 'success']
    };

    const filteredNotifications = useMemo(() => {
        if (activeTab === 'all') return notifications;
        return notifications.filter(n => categoryMap[activeTab].includes(n.type));
    }, [notifications, activeTab]);

    const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

    const handleMarkAllRead = () => {
        markAllAsRead();
    };

    const formatTimestamp = (timestamp: string | number) => {
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    // Action Handlers for Trade Confirmation
    const handleApproveTrade = async (notification: Notification, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click (mark as read)

        const requestId = notification.data?.requestId || notification.data?.tradeData?.requestId;
        if (!requestId) {
            setToast({ message: 'Invalid trade data: missing Request ID', type: 'error' });
            return;
        }

        setProcessingId(notification.id);
        try {
            await autoTradeApi.approveTrade(requestId);
            setToast({ message: 'Trade approved successfully', type: 'success' });
            // Mark as read after action
            markAsRead(notification.id);
            // Refresh notifications/status if needed, though marked read is enough UI update usually
            // refresh(); 
        } catch (err: any) {
            setToast({ message: err.response?.data?.error || 'Failed to approve trade', type: 'error' });
        } finally {
            setProcessingId(null);
        }
    };

    const handleRejectTrade = async (notification: Notification, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent card click

        const requestId = notification.data?.requestId || notification.data?.tradeData?.requestId;
        if (!requestId) {
            setToast({ message: 'Invalid trade data: missing Request ID', type: 'error' });
            return;
        }

        setProcessingId(notification.id);
        try {
            await autoTradeApi.rejectTrade(requestId);
            setToast({ message: 'Trade rejected', type: 'success' });
            markAsRead(notification.id);
        } catch (err: any) {
            setToast({ message: err.response?.data?.error || 'Failed to reject trade', type: 'error' });
        } finally {
            setProcessingId(null);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return <CheckCircleIcon className="w-6 h-6 text-green-400" />;
            case 'warning': return <ExclamationTriangleIcon className="w-6 h-6 text-yellow-400" />;
            case 'error': return <XCircleIcon className="w-6 h-6 text-red-400" />;
            case 'autoTrade': return <BoltIcon className="w-6 h-6 text-purple-400" />;
            case 'confirmTrade': return <BoltIcon className="w-6 h-6 text-orange-400" />;
            case 'accuracy': return <ChartBarIcon className="w-6 h-6 text-cyan-400" />;
            case 'whale': return <CurrencyDollarIcon className="w-6 h-6 text-emerald-400" />;
            case 'info':
            default: return <InformationCircleIcon className="w-6 h-6 text-blue-400" />;
        }
    };

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'autoTrade': return 'Auto Trade';
            case 'confirmTrade': return 'Trade Confirmation';
            case 'accuracy': return 'Accuracy Alert';
            case 'whale': return 'Whale Alert';
            case 'error': return 'Error';
            case 'warning': return 'Warning';
            case 'success': return 'Success';
            default: return 'System Info';
        }
    };

    // Render Tabs
    const renderTab = (id: 'all' | 'confirm' | 'trade' | 'accuracy' | 'whale' | 'system', label: string, icon: React.ReactNode) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === id
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
        >
            {icon}
            {label}
        </button>
    );

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto pb-24 min-h-screen">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                        <BellIcon className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white tracking-tight">Notification Center</h1>
                        <p className="text-gray-400 mt-1">Real-time alerts and updates</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="px-4 py-2 rounded-lg bg-slate-800 border border-white/10">
                        <span className="text-gray-400 text-sm">Unread: </span>
                        <span className={`font-bold ${unreadCount > 0 ? 'text-white' : 'text-gray-500'}`}>{unreadCount}</span>
                    </div>
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllRead}
                            className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-lg text-sm font-medium transition-all"
                        >
                            Mark all as read
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-2 mb-6 border-b border-white/10 pb-4">
                {renderTab('all', 'All', <BellIcon className="w-4 h-4" />)}
                {/* Confirm Category - Important to be prominent */}
                {renderTab('confirm', 'Confirm', <CheckCircleIcon className="w-4 h-4 text-orange-400" />)}
                {renderTab('trade', 'Trade', <BoltIcon className="w-4 h-4" />)}
                {renderTab('accuracy', 'Accuracy', <ChartBarIcon className="w-4 h-4" />)}
                {renderTab('whale', 'Whale', <CurrencyDollarIcon className="w-4 h-4" />)}
                {renderTab('system', 'System', <CpuChipIcon className="w-4 h-4" />)}
            </div>

            {/* Notification Feed */}
            <div className="space-y-3">
                {loading ? (
                    <div className="flex flex-col gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-24 bg-slate-800/50 rounded-xl animate-pulse border border-white/5"></div>
                        ))}
                    </div>
                ) : filteredNotifications.length === 0 ? (
                    <div className="text-center py-16 bg-slate-800/30 rounded-2xl border border-white/5 border-dashed">
                        <BellIcon className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-medium text-gray-300">No notifications found</h3>
                        <p className="text-gray-500 mt-2">You're all caught up! Check back later for updates.</p>
                    </div>
                ) : (
                    filteredNotifications.map((notification) => (
                        <div
                            key={notification.id}
                            onClick={() => !notification.read && markAsRead(notification.id)}
                            className={`relative group p-4 sm:p-5 rounded-xl border transition-all duration-200 cursor-pointer ${notification.read
                                ? 'bg-slate-900/40 border-slate-800 hover:border-slate-700 opacity-80 hover:opacity-100'
                                : 'bg-slate-800/60 border-purple-500/20 hover:border-purple-500/40 shadow-lg shadow-purple-900/10'
                                }`}
                        >
                            <div className="flex items-start gap-4">
                                {/* Icon Column */}
                                <div className={`flex-shrink-0 mt-1 p-2 rounded-lg ${notification.read ? 'bg-slate-800 text-gray-500' : 'bg-slate-800/80'
                                    }`}>
                                    {getIcon(notification.type)}
                                </div>

                                {/* Content Column */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                                        <h3 className={`text-base font-semibold truncate pr-4 ${notification.read ? 'text-gray-300' : 'text-white'
                                            }`}>
                                            {notification.title}
                                        </h3>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className={`text-xs px-2 py-0.5 rounded-full border ${notification.read
                                                ? 'border-gray-700 text-gray-500'
                                                : 'border-white/10 text-gray-400 bg-white/5'
                                                }`}>
                                                {getTypeLabel(notification.type)}
                                            </span>
                                            <span className="text-xs text-gray-500 whitespace-nowrap">
                                                {formatTimestamp(notification.timestamp)}
                                            </span>
                                        </div>
                                    </div>

                                    <p className={`text-sm leading-relaxed ${notification.read ? 'text-gray-500' : 'text-gray-300'
                                        }`}>
                                        {notification.message}
                                    </p>

                                    {/* Action Buttons for Confirm Category */}
                                    {notification.type === 'confirmTrade' && !notification.read && (
                                        <div className="mt-4 flex flex-wrap gap-3">
                                            <button
                                                onClick={(e) => handleApproveTrade(notification, e)}
                                                disabled={processingId === notification.id}
                                                className="flex items-center gap-2 text-xs font-semibold bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 px-4 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {processingId === notification.id ? 'Processing...' : (
                                                    <>
                                                        <CheckIcon className="w-4 h-4" />
                                                        Confirm Execution
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={(e) => handleRejectTrade(notification, e)}
                                                disabled={processingId === notification.id}
                                                className="flex items-center gap-2 text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-4 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <XMarkIcon className="w-4 h-4" />
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Unread Indicator */}
                                {!notification.read && (
                                    <div className="absolute top-5 right-5 w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]"></div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Demo Mock Data Hint */}
            {filteredNotifications.length === 0 && (
                <div className="mt-8 text-center text-xs text-gray-600">
                    <p>Notifications are retained for 30 days.</p>
                </div>
            )}

            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </div>
    );
};

export default NotificationCenter;
