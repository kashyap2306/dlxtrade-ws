// FORCE CACHE INVALIDATION - SIDEBAR FIX v2.0
// This comment block forces browser cache invalidation
// Added: 2024-12-31 23:59:59 UTC
// Random hash: a1b2c3d4e5f678901234567890abcdef
// If you see this, the cache has been invalidated

import { useState, useEffect } from 'react';
import { agentKeyToSlug } from '../utils/agentKeyToSlug';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase-config';

interface SidebarProps {
  onLogout?: () => void;
  onMenuToggle?: (open: boolean) => void;
}

// Default logout handler if not provided
const defaultLogout = async () => {
  const { signOut } = await import('firebase/auth');
  const { auth } = await import('../config/firebase');
  await signOut(auth);
  localStorage.removeItem('firebaseToken');
  localStorage.removeItem('firebaseUser');
  window.location.href = '/login';
};

// Crypto-style SVG Icons
const Icons = {
  Dashboard: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  Agents: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
    </svg>
  ),
  Agent: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Integrations: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Research: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  Settings: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  AutoTrade: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Logs: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  Profile: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  Admin: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  Users: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  Logout: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
};

export default function Sidebar({ onLogout, onMenuToggle }: SidebarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [agents, setAgents] = useState<{id: string, path: string, label: string}[]>([]);
  const [agentsChecked, setAgentsChecked] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  // REQ 4: Sidebar MUST depend on authReady, not just user
  const { user, authReady, authLoading, logout: authLogout } = useAuth();

  // Function to check admin status (assume admin if user has custom claim or role, or leave as false if no such logic)
  const checkAdmin = async () => {
    // TODO: Implement admin check via Firebase custom claims or roles if needed
    setIsAdmin(false); // Default to false for safety
  };

  // Listen to Firestore for approved agents in real-time
  useEffect(() => {
    if (!user) {
      setAgents([]);
      setAgentsChecked(true);
      return;
    }
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      const data = snapshot.data();
      const approvedAgents = data?.approvedAgents || [];
      const agents = Array.isArray(approvedAgents)
        ? approvedAgents.map((agentId: string) => ({
            id: agentId,
            path: `/agents/${agentId}`,
            label: agentId,
          }))
        : [];
      setAgents(agents);
      setAgentsChecked(true);
    });
    return () => unsubscribe();
  }, [user]);

  // Notify parent component of menu state changes
  useEffect(() => {
    if (onMenuToggle) {
      onMenuToggle(mobileMenuOpen);
    }
  }, [mobileMenuOpen, onMenuToggle]);

  // Only check admin status on mount
  useEffect(() => {
    if (user && authReady) {
      checkAdmin();
    } else {
      setAgents([]);
      setAgentsChecked(true);
    }
  }, [user, authReady]);

  const staticMenuItems = [
    { path: '/dashboard', label: 'Dashboard', Icon: Icons.Dashboard, icon: undefined },
    { path: '/agents', label: 'Agents Marketplace', Icon: Icons.Agents, icon: undefined },
    { path: '/research', label: 'Research', Icon: Icons.Research, icon: undefined },
    { path: '/auto-trade', label: 'Auto-Trade', Icon: Icons.AutoTrade, icon: undefined },
    { path: '/settings', label: 'Settings', Icon: Icons.Settings, icon: undefined },
    { path: '/profile', label: 'Profile', Icon: Icons.Profile, icon: undefined },
  ];

  // Create agent menu items from directly checked agents
  type MenuItem = {
    path: string;
    label: string;
    Icon: any;
    icon?: any;
    agentKey?: string;
  };

  function getSidebarAgentRoute(agentKey: string) {
    const slug = agentKeyToSlug(agentKey);
    switch (slug) {
      case 'trading-agent':
        return '/agents/trading-agent';
      case 'vwap-strategy':
        return '/agents/vwap-strategy';
      case 'crowd-consensus':
        return '/agents/crowd-consensus';
      case 'liquidity_sniper_arbitrage':
        return '/agents/liquidity_sniper_arbitrage';
      case 'launchpad-hunter':
        return '/agents/launchpad-hunter';
      default:
        // CRITICAL: Always use /agents/ (plural) routes - /agent/ (singular) is deprecated and returns 410
        return `/agents/${slug}`;
    }
  }

  const agentMenuItems: MenuItem[] = agents.map(agent => ({
    path: getSidebarAgentRoute(agent.id),
    label: agent.label,
    Icon: Icons.Agent,
    icon: undefined,
    agentKey: agent.id,
  }));

  const menuItems: MenuItem[] = [...staticMenuItems, ...agentMenuItems];

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(path);
  };

  const toggleMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  useEffect(() => {
    (window as any).__sidebarToggle = toggleMenu;
    (window as any).__sidebarOpen = mobileMenuOpen;
    return () => {
      delete (window as any).__sidebarToggle;
      delete (window as any).__sidebarOpen;
    };
  }, [mobileMenuOpen]);

  // Sidebar Rendering Guard - ALWAYS RENDER SIDEBAR
  console.log('[Sidebar] Render state:', {
    authReady,
    authLoading,
    hasUser: !!user,
    agentsCount: agents.length,
    agentsChecked
  });
  // Sidebar MUST always render - no early returns based on loading states

  // Don't render sidebar on admin routes (strict)
  if (location.pathname.startsWith('/admin')) return null;

  return (
    <>
      {/* Mobile Overlay - Only on mobile */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-md z-[90] transition-opacity duration-300 ease-out"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Premium Crypto Trading Sidebar - Mobile Only */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-full bg-slate-900/95 backdrop-blur-2xl border-r border-cyan-500/20 shadow-2xl z-[95]
          transform transition-transform duration-300 ease-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:hidden
        `}
        style={{
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
          boxShadow: 'inset -1px 0 0 rgba(6, 182, 212, 0.1), 0 0 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div className="flex flex-col h-full">
          {/* Logo Header */}
          <div className="px-6 py-6 border-b border-cyan-500/10">
            <div className="flex items-center justify-between">
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
              >
                Trading Agent
              </Link>
              {/* Close button for mobile only */}
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="lg:hidden p-1.5 text-gray-400 hover:text-cyan-400 transition-colors rounded-lg hover:bg-cyan-500/10"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
            {/* MENU Heading - Desktop Only */}
            <div className="hidden lg:block px-3 mb-4 pt-3">
              <div className="text-xs font-semibold text-cyan-400/75 uppercase tracking-widest relative">
                <span className="relative z-10">MENU</span>
                <span className="absolute inset-0 text-cyan-400/20 blur-sm">MENU</span>
              </div>
            </div>
            {menuItems.map((item) => {
              const active = isActive(item.path);
              const Icon = item.Icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={(e) => {
                    if (item.agentKey) {
                      const slug = agentKeyToSlug(item.agentKey);
                      const route = getSidebarAgentRoute(item.agentKey);
                      e.preventDefault();
                      setMobileMenuOpen(false);
                      navigate(route);
                      return;
                    }
                    setMobileMenuOpen(false);
                  }}
                  className={`
                    group relative flex items-center space-x-3 px-4 py-3 lg:px-3 lg:py-2 rounded-xl transition-all duration-200
                    ${active
                      ? 'text-cyan-400 bg-cyan-500/10 border-l-2 border-cyan-400'
                      : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/5 border-l-2 border-transparent'
                    }
                  `}
                >
                  {/* Active Left Neon Bar */}
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-gradient-to-b from-cyan-400 to-blue-400 rounded-r-full shadow-lg shadow-cyan-400/50" />
                  )}

                  {/* Hover Glow Effect */}
                  <div
                    className={`
                      absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200
                      ${active ? 'bg-cyan-500/5' : 'bg-[rgba(0,255,255,0.08)]'}
                    `}
                  />

                  {/* Icon */}
                  <div className={`
                    relative z-10 flex-shrink-0 transition-colors
                    ${active ? 'text-cyan-400' : 'text-gray-500 group-hover:text-cyan-400'}
                  `}>
                    <div className="w-6 h-6 lg:w-5 lg:h-5 flex items-center justify-center">
                      {item.icon ? (
                        <span className="text-lg lg:text-base">{item.icon}</span>
                      ) : (
                        <Icon />
                      )}
                    </div>
                  </div>

                  {/* Label */}
                  <span className={`
                    relative z-10 font-medium text-base lg:text-sm tracking-wide
                    ${active ? 'text-cyan-400' : 'text-gray-400 group-hover:text-cyan-300'}
                  `}>
                    {item.label}
                  </span>
                </Link>
              );
            })}


          </nav>

          {/* Logout Button */}
          <div className="px-3 py-4 border-t border-cyan-500/10">
            <button
              onClick={async () => {
                setMobileMenuOpen(false);
                if (onLogout) {
                  onLogout();
                } else {
                  await defaultLogout();
                }
              }}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-red-400 bg-slate-800/50 hover:bg-red-500/10 border border-slate-700/50 hover:border-red-500/30 rounded-xl transition-all duration-200 group"
            >
              <div className="text-gray-500 group-hover:text-red-400 transition-colors">
                <Icons.Logout />
              </div>
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* Custom Scrollbar Styles */}
        <style>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(6, 182, 212, 0.3);
            border-radius: 2px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(6, 182, 212, 0.5);
          }
        `}</style>
      </aside>

      {/* Desktop Sidebar - Always Visible */}
      <aside
        className="hidden lg:block fixed top-0 left-0 h-full w-64 bg-slate-900/95 backdrop-blur-2xl border-r border-cyan-500/20 shadow-2xl z-[90]"
        style={{
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
          boxShadow: 'inset -1px 0 0 rgba(6, 182, 212, 0.1), 0 0 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div className="flex flex-col h-full">
          {/* Logo Header - Desktop */}
          <div className="px-6 py-6 border-b border-cyan-500/10">
            <Link
              to="/"
              className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
            >
              Trading Agent
            </Link>
          </div>

          {/* Navigation Menu - Desktop */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
            {/* MENU Heading - Desktop Only */}
            <div className="px-3 mb-4 pt-3">
              <div className="text-xs font-semibold text-cyan-400/75 uppercase tracking-widest relative">
                <span className="relative z-10">MENU</span>
                <span className="absolute inset-0 text-cyan-400/20 blur-sm">MENU</span>
              </div>
            </div>
            {menuItems.map((item) => {
              const active = isActive(item.path);
              const Icon = item.Icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={(e) => {
                    if (item.agentKey) {
                      const routeChosen = getSidebarAgentRoute(item.agentKey);
                      console.debug({ from: 'sidebar', agentKey: item.agentKey, routeChosen });
                      e.preventDefault();
                      navigate(routeChosen);
                      return;
                    }
                  }}
                  className={`
                    group relative flex items-center space-x-3 px-4 py-3 lg:px-3 lg:py-2 rounded-xl transition-all duration-200
                    ${active
                      ? 'text-cyan-400 bg-cyan-500/10 border-l-2 border-cyan-400'
                      : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/5 border-l-2 border-transparent'
                    }
                  `}
                >
                  {/* Active Left Neon Bar */}
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 bg-gradient-to-b from-cyan-400 to-blue-400 rounded-r-full shadow-lg shadow-cyan-400/50" />
                  )}

                  {/* Hover Glow Effect */}
                  <div
                    className={`
                      absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200
                      ${active ? 'bg-cyan-500/5' : 'bg-[rgba(0,255,255,0.08)]'}
                    `}
                  />

                  {/* Icon */}
                  <div className={`
                    relative z-10 flex-shrink-0 transition-colors
                    ${active ? 'text-cyan-400' : 'text-gray-500 group-hover:text-cyan-400'}
                  `}>
                    <div className="w-6 h-6 lg:w-5 lg:h-5 flex items-center justify-center">
                      {item.icon ? (
                        <span className="text-lg lg:text-base">{item.icon}</span>
                      ) : (
                        <Icon />
                      )}
                    </div>
                  </div>

                  {/* Label */}
                  <span className={`
                    relative z-10 font-medium text-base lg:text-sm tracking-wide
                    ${active ? 'text-cyan-400' : 'text-gray-400 group-hover:text-cyan-300'}
                  `}>
                    {item.label}
                  </span>
                </Link>
              );
            })}

          </nav>

          {/* Logout Button - Desktop */}
          <div className="px-3 py-4 border-t border-cyan-500/10">
            <button
              onClick={async () => {
                if (onLogout) {
                  onLogout();
                } else {
                  await defaultLogout();
                }
              }}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-red-400 bg-slate-800/50 hover:bg-red-500/10 border border-slate-700/50 hover:border-red-500/30 rounded-xl transition-all duration-200 group"
            >
              <div className="text-gray-500 group-hover:text-red-400 transition-colors">
                <Icons.Logout />
              </div>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
