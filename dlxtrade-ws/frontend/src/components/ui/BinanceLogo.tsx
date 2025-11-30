import React from 'react';

interface BinanceLogoProps {
  className?: string;
  size?: number;
}

export default function BinanceLogo({ className = '', size = 40 }: BinanceLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#F3BA2F"/>
        <path d="M20 8L28 12V16L32 20L28 24V28L20 32L12 28V24L8 20L12 16V12L20 8Z" fill="white"/>
        <path d="M20 8V16M20 16L28 12M20 16L12 12M20 16V24M20 24L28 20M20 24L32 20M20 24L12 20M20 24V32M20 32L28 28M20 32L12 28" stroke="#F3BA2F" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </div>
  );
}
