import React from 'react';

interface OKXLogoProps {
  className?: string;
  size?: number;
}

export default function OKXLogo({ className = '', size = 40 }: OKXLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#2D3748"/>
        <text x="20" y="25" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial, sans-serif">OKX</text>
      </svg>
    </div>
  );
}
