import React from 'react';

interface MEXCLogoProps {
  className?: string;
  size?: number;
}

export default function MEXCLogo({ className = '', size = 40 }: MEXCLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#8B5CF6"/>
        <text x="20" y="25" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="Arial, sans-serif">MEXC</text>
      </svg>
    </div>
  );
}
