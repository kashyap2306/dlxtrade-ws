import React from 'react';

interface KuCoinLogoProps {
  className?: string;
  size?: number;
}

export default function KuCoinLogo({ className = '', size = 40 }: KuCoinLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#23AF91"/>
        <circle cx="20" cy="20" r="12" fill="white"/>
        <path d="M14 20L18 16L22 20L18 24L14 20Z" fill="#23AF91"/>
        <path d="M18 16V24M22 20H26" stroke="#23AF91" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  );
}
