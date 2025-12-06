import React from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

// Reusable input component for consistent styling
export const SettingsInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10"
    {...props}
  />
);

// Reusable card component for consistent styling
export const SettingsCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 p-5 sm:p-8 shadow-xl transition-all duration-300 hover:shadow-2xl hover:border-purple-500/20 ${className}`}>
    {children}
  </div>
);

// Reusable toggle switch component
export const ToggleSwitch: React.FC<{
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  size?: 'normal' | 'small';
}> = ({ id, checked, onChange, ariaLabel, size = 'normal' }) => {
  const dimensions = size === 'small'
    ? { container: 'w-10 h-5', knob: 'after:h-4 after:w-4', translate: 'peer-checked:after:translate-x-full', bg: 'peer-checked:bg-purple-500' }
    : { container: 'w-12 h-6', knob: 'after:h-5 after:w-5', translate: 'peer-checked:after:translate-x-full peer-checked:after:border-white', bg: 'peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500' };
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        id={id}
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <div className={`${dimensions.container} bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer ${dimensions.translate} ${dimensions.bg} after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full ${dimensions.knob} after:transition-all`}></div>
    </label>
  );
};

// Reusable provider test result component
export const ProviderTestResult: React.FC<{
  result: { status: 'success' | 'error' | null; message: string } | undefined;
  size?: 'normal' | 'small';
}> = ({ result, size = 'normal' }) => {
  if (!result) return null;
  const iconSize = size === 'small' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg text-${size === 'small' ? 'xs' : 'sm'} ${
  result.status === 'success'
    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
    : result.status === 'error'
      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
      : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
}`}>
      {result.status === 'success' && <CheckCircleIcon className={iconSize} />}
      {result.status === 'error' && <XCircleIcon className={iconSize} />}
      <span>{result.message}</span>
    </div>
  );
};
