import React from 'react';

interface WeexLogoProps {
  className?: string;
  size?: number;
}

export default function WeexLogo({ className = '', size = 40 }: WeexLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#3B82F6"/>
        <path d="M12 28L20 20L28 28M12 20L20 12L28 20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}
