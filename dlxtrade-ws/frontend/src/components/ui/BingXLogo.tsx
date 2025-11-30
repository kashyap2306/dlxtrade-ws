import React from 'react';

interface BingXLogoProps {
  className?: string;
  size?: number;
}

export default function BingXLogo({ className = '', size = 40 }: BingXLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#FF6B35"/>
        <path d="M12 12L20 8L28 12V20L32 28H24L20 32L16 28H8L12 20V12Z" fill="white"/>
        <path d="M20 8V20M12 12L20 16M28 12L20 16M8 28L16 24M32 28L24 24" stroke="#FF6B35" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}
