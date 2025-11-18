import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useChatbot } from '../contexts/ChatbotContext';
import NotificationBell from './NotificationBell';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  children?: React.ReactNode;
}

// ProfileMenu component - inline in same file
function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  if (!user) return null;

  const getInitials = (): string => {
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
  };

  const handleProfile = () => {
    setIsOpen(false);
    navigate('/profile');
  };

  const handleSettings = () => {
    setIsOpen(false);
    navigate('/settings');
  };

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Profile menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="relative w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 via-purple-400 to-blue-500 flex items-center justify-center text-white font-semibold text-xs shadow-lg hover:shadow-purple-500/50 transition-all hover:scale-105"
      >
        <span>{getInitials()}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-44 p-3 rounded-2xl bg-black/30 backdrop-blur-xl border border-white/10 shadow-lg z-50 animate-fade-in">
          <div className="space-y-1">
            <button
              onClick={handleProfile}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-200 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Profile
            </button>
            <button
              onClick={handleSettings}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-200 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
            <div className="border-t border-white/10 my-1"></div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-sm font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Header({
  title,
  subtitle,
  onMenuToggle,
  menuOpen = false,
  children,
}: HeaderProps) {
  const { isOpen: chatbotOpen } = useChatbot();

  // Hide header when chatbot is open
  if (chatbotOpen) {
    return null;
  }

  return (
    <>
      {/* Mobile Header - Fixed, Safe Area Aware */}
      <header className="lg:hidden fixed inset-x-0 top-0 z-[9999] w-full flex items-center justify-between px-4 py-3 bg-black/30 backdrop-blur-md border-b border-white/10 safe-top">
        {/* Left: Hamburger Menu */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {onMenuToggle && (
            <button
              onClick={onMenuToggle}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="p-2 text-white hover:text-cyan-400 transition-colors rounded-lg hover:bg-white/10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={menuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
                />
              </svg>
            </button>
          )}
          {/* Title */}
          <h1 className="text-white font-bold tracking-wide text-lg">
            {title === 'Dashboard' ? 'DLX TRADING — Dashboard' : 'DLX TRADING'}
          </h1>
        </div>

        {/* Right: Notification Bell, Profile Menu and other actions */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <NotificationBell />
          <ProfileMenu />
          {children}
        </div>
      </header>

      {/* Desktop Title - Below App Bar */}
      {(title || subtitle) && (
        <div className="hidden lg:block mt-8 mb-6 px-4 lg:px-0">
          {title && (
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-2 leading-tight">
              {title === 'Dashboard' ? 'DLX TRADING — Dashboard' : title}
            </h1>
          )}
          {subtitle && (
            <p className="text-sm sm:text-base text-gray-300 max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Mobile Top Padding to Avoid Content Under Header */}
      <div className="lg:hidden h-16" />
    </>
  );
}