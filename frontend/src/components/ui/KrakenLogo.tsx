import React from 'react';

interface KrakenLogoProps {
  className?: string;
}

export default function KrakenLogo({ className = "w-8 h-8" }: KrakenLogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#5243C2"/>
      <path d="M16 6l6 6v8l-6 6-6-6v-8l6-6z" fill="white"/>
      <path d="M16 12l3 3v2l-3 3-3-3v-2l3-3z" fill="#5243C2"/>
      <circle cx="16" cy="16" r="2" fill="#5243C2"/>
    </svg>
  );
}
