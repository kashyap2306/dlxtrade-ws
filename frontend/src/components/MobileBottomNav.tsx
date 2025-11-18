import { useLocation, useNavigate } from 'react-router-dom';
import { HomeIcon, SparklesIcon, ChartBarIcon, UserIcon } from '@heroicons/react/24/outline';
import { HomeIcon as HomeIconSolid, SparklesIcon as SparklesIconSolid, ChartBarIcon as ChartBarIconSolid, UserIcon as UserIconSolid } from '@heroicons/react/24/solid';
import { useChatbot } from '../contexts/ChatbotContext';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconSolid: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: HomeIcon, iconSolid: HomeIconSolid },
  { path: '/agents', label: 'Agents', icon: SparklesIcon, iconSolid: SparklesIconSolid },
  { path: '/research', label: 'Research', icon: ChartBarIcon, iconSolid: ChartBarIconSolid },
  { path: '/profile', label: 'Profile', icon: UserIcon, iconSolid: UserIconSolid },
];

export default function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isOpen: chatbotOpen } = useChatbot();

  // Hide bottom nav when chatbot is open
  if (chatbotOpen) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-purple-500/30 lg:hidden safe-bottom">
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = isActive ? item.iconSolid : item.icon;

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-lg transition-all flex-1 ${
                isActive
                  ? 'text-purple-400 bg-purple-500/10'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

