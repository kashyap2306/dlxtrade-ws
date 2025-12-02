import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { globalStatsApi, usersApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [, setMenuOpen] = useState(false);
  const [stats, setStats] = useState({
    totalTrades: 0,
    liveAgents: 0,
    activeUsers: 0,
  });

  useEffect(() => {
    loadStats();
  }, [user]);

  const loadStats = async () => {
    try {
      // Load global stats
      try {
        const globalResponse = await globalStatsApi.get();
        if (globalResponse.data) {
          setStats({
            totalTrades: globalResponse.data.totalTrades || 0,
            liveAgents: globalResponse.data.activeAgents || 6,
            activeUsers: globalResponse.data.activeUsers || 0,
          });
        }
      } catch (err: any) {
        suppressConsoleError(err, 'loadGlobalStats');
      }

      // Load user stats for total trades
      if (user) {
        try {
          const userResponse = await usersApi.getStats(user.uid);
          if (userResponse.data?.totalTrades) {
            setStats(prev => ({ ...prev, totalTrades: userResponse.data.totalTrades }));
          }
        } catch (err: any) {
          suppressConsoleError(err, 'loadUserStats');
        }
      }
    } catch (err: any) {
      // Fallback to placeholder stats
      setStats({
        totalTrades: 0,
        liveAgents: 6,
        activeUsers: 0,
      });
    }
  };

  const agents = [
    {
      id: 'airdrop-multiverse',
      name: 'Airdrop Multiverse',
      description: 'Automated airdrop discovery and claim system',
      features: ['Multi-chain support', 'Auto-claim eligible airdrops', 'Portfolio tracking'],
      icon: '🎁',
    },
    {
      id: 'liquidity-sniper',
      name: 'Liquidity Sniper & Arbitrage',
      description: 'Real-time liquidity detection and arbitrage opportunities',
      features: ['Cross-exchange arbitrage', 'MEV protection', 'Instant execution'],
      icon: '🎯',
    },
    {
      id: 'launchpad-hunter',
      name: 'AI Launchpad Hunter',
      description: 'Early-stage project discovery and investment automation',
      features: ['Pre-launch detection', 'Risk assessment', 'Auto-allocation'],
      icon: '🚀',
    },
    {
      id: 'whale-tracker',
      name: 'Whale Movement Tracker',
      description: 'Monitor and follow large wallet movements',
      features: ['Real-time alerts', 'Pattern analysis', 'Copy trading signals'],
      icon: '🐋',
    },
    {
      id: 'pre-market-alpha',
      name: 'Pre-Market AI Alpha',
      description: 'Predictive analytics for pre-market opportunities',
      features: ['ML predictions', 'Sentiment analysis', 'Risk scoring'],
      icon: '📊',
    },
    {
      id: 'whale-copy-trade',
      name: 'Whale Copy Trade',
      description: 'Automatically mirror successful whale strategies',
      features: ['Smart filtering', 'Position sizing', 'Stop-loss management'],
      icon: '🔄',
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#101726] to-[#0a0f1c] relative overflow-hidden">
      {/* Modern animated background with grid pattern */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Animated gradient orbs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/20 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-4000"></div>
        
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] opacity-40"></div>
        
        {/* Glowing lines effect */}
        <div className="absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-purple-500/20 to-transparent"></div>
        <div className="absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent"></div>
      </div>

      {user && <Sidebar onMenuToggle={setMenuOpen} />}

      <main className="min-h-screen relative z-10">
        <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${user ? '' : 'pt-8'}`}>
          {user ? (
            <div className="mb-8">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                DLX TRADING
              </h1>
              <p className="text-lg text-gray-300">Your Advanced AI Trading Ecosystem</p>
            </div>
          ) : (
            <div className="mb-8 text-center">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                DLX TRADING
              </h1>
              <p className="text-lg text-gray-300">Your Advanced AI Trading Ecosystem</p>
            </div>
          )}

          {/* SECTION 1 — Hero Banner */}
          <section className="relative mt-8 mb-16 lg:mb-24">
            <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-8 sm:p-12 lg:p-16 shadow-2xl shadow-purple-500/20 overflow-hidden">
              {/* Gradient accent line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500"></div>
              
              {/* Animated particles background */}
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
                <div className="absolute top-1/3 right-1/4 w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }}></div>
                <div className="absolute bottom-1/4 left-1/3 w-2 h-2 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
              </div>

              <div className="relative z-10 text-center">
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-4 sm:mb-6 leading-tight">
                  Your Advanced AI Trading Ecosystem
                </h1>
                <p className="text-lg sm:text-xl text-gray-300 mb-8 sm:mb-10 max-w-3xl mx-auto leading-relaxed">
                  Smart agents powered by deep research, HFT engines, market signals and live analytics.
                </p>
                <button
                  onClick={() => navigate('/agents')}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/40 hover:shadow-purple-500/60 transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Explore Trading Agents
                </button>
              </div>
            </div>
          </section>

          {/* SECTION 2 — Agents Overview Grid */}
          <section className="mb-16 lg:mb-24">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-8 sm:mb-12 text-center">
              Premium Trading Agents
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden group"
                >
                  {/* Gradient accent line */}
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  
                  {/* Agent Icon */}
                  <div className="text-5xl sm:text-6xl mb-4 text-center">{agent.icon}</div>
                  
                  {/* Agent Name */}
                  <h3 className="text-xl sm:text-2xl font-bold text-white mb-3 text-center group-hover:text-purple-300 transition-colors">
                    {agent.name}
                  </h3>
                  
                  {/* Description */}
                  <p className="text-gray-400 text-sm sm:text-base mb-6 text-center min-h-[3rem]">
                    {agent.description}
                  </p>
                  
                  {/* Features */}
                  <ul className="space-y-2 mb-6">
                    {agent.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm text-gray-300">
                        <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  
                  {/* Unlock Button */}
                  <button
                    onClick={() => navigate('/agents')}
                    className="w-full px-4 py-3 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/40 text-purple-300 font-semibold rounded-xl hover:from-purple-500/30 hover:to-pink-500/30 hover:border-purple-400/60 transition-all duration-300 transform hover:scale-105 active:scale-95"
                  >
                    Unlock Agent
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* SECTION 3 — Live Market Advantage */}
          <section className="mb-16 lg:mb-24">
            <div className="relative bg-black/30 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-6 sm:p-8 overflow-hidden">
              {/* Gradient accent line */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500"></div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6">
                {[
                  { label: 'Real-time Signals', icon: '⚡' },
                  { label: 'HFT Market Depth Alerts', icon: '📊' },
                  { label: 'AI-Powered Trade Patterns', icon: '🤖' },
                  { label: 'Sentiment Engine with 87% Accuracy', icon: '🎯' },
                  { label: 'Global Price Heatmaps', icon: '🌍' },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col items-center text-center p-4 bg-black/20 rounded-xl border border-cyan-500/20 hover:border-cyan-400/40 transition-all duration-300"
                  >
                    <div className="text-3xl sm:text-4xl mb-2">{item.icon}</div>
                    <p className="text-sm sm:text-base text-gray-300 font-medium">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* SECTION 4 — Why DLXTRADE AI? */}
          <section className="mb-16 lg:mb-24">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 items-center">
              {/* Left: Neon Glowing Illustration */}
              <div className="relative">
                <div className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-8 sm:p-12 aspect-square flex items-center justify-center overflow-hidden">
                  {/* Animated gradient orb */}
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-cyan-500/20 rounded-full blur-3xl animate-pulse"></div>
                  
                  {/* AI Icon/Illustration */}
                  <div className="relative z-10 text-center">
                    <div className="text-8xl sm:text-9xl mb-4">🤖</div>
                    <div className="w-32 h-32 sm:w-40 sm:h-40 mx-auto border-4 border-purple-400/50 rounded-full flex items-center justify-center" style={{ animation: 'spin 8s linear infinite' }}>
                      <div className="w-24 h-24 sm:w-32 sm:h-32 border-4 border-cyan-400/50 rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Content */}
              <div>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-6 sm:mb-8">
                  AI Optimized for Every Trade
                </h2>
                <ul className="space-y-4 sm:space-y-5">
                  {[
                    'Live Predictive Modeling',
                    'Smart Arbitrage & Momentum Detection',
                    'Deep Learning Market Insights',
                    'Stable Risk Management',
                    'Auto-Generated Trading Opportunities',
                  ].map((point, idx) => (
                    <li key={idx} className="flex items-start gap-3 sm:gap-4">
                      <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center mt-0.5">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <span className="text-base sm:text-lg text-gray-300 font-medium">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* SECTION 5 — Footer Stats */}
          <section className="mb-8 sm:mb-12">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
              {[
                { label: 'Total Trades Executed', value: stats.totalTrades.toLocaleString(), icon: '📈', color: 'from-green-500 to-emerald-500' },
                { label: 'Live AI Agents Running', value: stats.liveAgents.toString(), icon: '🤖', color: 'from-purple-500 to-pink-500' },
                { label: 'Active Users', value: stats.activeUsers.toLocaleString() || '1.2K+', icon: '👥', color: 'from-cyan-500 to-blue-500' },
              ].map((stat, idx) => (
                <div
                  key={idx}
                  className="relative bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden group"
                >
                  {/* Gradient accent line */}
                  <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${stat.color}`}></div>
                  
                  <div className="text-center">
                    <div className="text-4xl sm:text-5xl mb-3">{stat.icon}</div>
                    <div className={`text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent mb-2`}>
                      {stat.value}
                    </div>
                    <div className="text-sm sm:text-base text-gray-400 font-medium">{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

