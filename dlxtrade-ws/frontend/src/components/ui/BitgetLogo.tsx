import React from 'react';

interface BitgetLogoProps {
  className?: string;
  size?: number;
}

export default function BitgetLogo({ className = '', size = 40 }: BitgetLogoProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="8" fill="#FF4C4C"/>
        <path d="M12 12H20V16H16V20H20V24H16V28H12V12Z" fill="white"/>
        <path d="M24 12H28V28H24V24H20V20H24V12Z" fill="white"/>
      </svg>
    </div>
  );
}
