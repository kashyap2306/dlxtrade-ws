import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useChatbot } from '../contexts/ChatbotContext';
import { BellIcon, Bars3Icon, SparklesIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

// Memoized Profile Menu Component
const ProfileMenu = memo(() => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Memoize user initials
  const userInitials = useMemo(() => {
    if (!user) return 'U';
    if (user.displayName) {
      return user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  }, [user?.displayName, user?.email]);

  // Handle click outside - memoized
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle escape key - memoized
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Memoized handlers
  const handleProfile = useCallback(() => {
    setIsOpen(false);
    navigate('/profile');
  }, [navigate]);

  const handleSettings = useCallback(() => {
    setIsOpen(false);
    navigate('/settings');
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    setIsOpen(false);
    await logout();
  }, [logout]);

  const toggleMenu = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={toggleMenu}
        aria-label="Profile menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex items-center gap-2 rounded-full bg-white/5 border border-white/10 pr-2 pl-1 py-1 text-white shadow-lg shadow-black/30 hover:bg-white/10 transition-all active:scale-95"
      >
        <span className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-purple-500 via-purple-400 to-blue-500 flex items-center justify-center text-xs sm:text-sm font-semibold shadow-md">
          {userInitials}
        </span>
        <ChevronDownIcon className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl z-50 animate-fade-in overflow-hidden">
          <div className="p-1.5 space-y-0.5">
            <button
              onClick={handleProfile}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-200 hover:text-white hover:bg-white/10 transition-all text-sm font-medium active:scale-95"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>Profile</span>
            </button>
            <button
              onClick={handleSettings}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-200 hover:text-white hover:bg-white/10 transition-all text-sm font-medium active:scale-95"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Settings</span>
            </button>
            <div className="border-t border-white/10 my-1"></div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all text-sm font-medium active:scale-95"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

ProfileMenu.displayName = 'ProfileMenu';

// Memoized Notification Bell Component
const OptimizedNotificationBell = memo(() => {
  const { user } = useAuth();
  const { unreadCount } = useNotificationContext();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Lazy load NotificationPanel to reduce initial bundle size
  const [NotificationPanel, setNotificationPanel] = useState<React.ComponentType<{ onClose: () => void }> | null>(null);

  // Handle click outside - memoized
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle escape key - memoized
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Lazy load NotificationPanel when opened
  useEffect(() => {
    if (isOpen && !NotificationPanel) {
      import('./NotificationPanel').then((module) => {
        setNotificationPanel(() => module.default);
      });
    }
  }, [isOpen, NotificationPanel]);

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={togglePanel}
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="relative p-2 text-gray-300 hover:text-white transition-colors rounded-lg hover:bg-white/10 active:scale-95"
      >
        <BellIcon className="w-5 h-5 sm:w-6 sm:h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-[10px] sm:text-xs font-bold text-white bg-red-500 rounded-full border-2 border-slate-900 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={closePanel}
            aria-hidden="true"
          />
          {/* Dropdown Panel */}
          <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] z-50">
            {NotificationPanel ? (
              <NotificationPanel onClose={closePanel} />
            ) : (
              <div className="bg-slate-900/95 backdrop-blur-xl border border-purple-500/20 rounded-xl p-4">
                <div className="animate-pulse text-gray-400 text-sm">Loading notifications...</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

OptimizedNotificationBell.displayName = 'OptimizedNotificationBell';

// Main TopNavigation Component
const TopNavigation = memo(() => {
  const { user } = useAuth();
  const { isOpen: chatbotOpen } = useChatbot();
  const handleHamburgerClick = useCallback(() => {
    const globalToggle = (window as any)?.__sidebarToggle;
    if (typeof globalToggle === 'function') {
      globalToggle();
    }
  }, []);

  // Hide navigation when chatbot is open
  if (chatbotOpen || !user) {
    return null;
  }

  return (
    <>
      <header className="sticky top-0 z-50 h-16 bg-slate-900/80 backdrop-blur-xl border-b border-white/10 shadow-md shadow-black/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-full">
          <div className="flex items-center justify-between h-full">
            {/* Left Section */}
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <button
                aria-label="Toggle menu"
                onClick={handleHamburgerClick}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all active:scale-95"
              >
                <Bars3Icon className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <span className="p-2 rounded-xl bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-400 text-white shadow-md">
                  <SparklesIcon className="w-4 h-4" />
                </span>
                <span className="text-lg sm:text-xl font-semibold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent tracking-tight truncate">
                  DLX Agent
                </span>
              </div>
            </div>

            {/* Right Section */}
            <div className="flex items-center gap-3 sm:gap-4">
              <OptimizedNotificationBell />
              <ProfileMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Spacer */}
      <div className="h-16" />
    </>
  );
});

TopNavigation.displayName = 'TopNavigation';

export default TopNavigation;
