import React from 'react';

interface BybitLogoProps {
  className?: string;
}

export default function BybitLogo({ className = "w-8 h-8" }: BybitLogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#F7A600"/>
      <path d="M8 12h4v8h4v-8h4v8h4V12h4v12H8V12z" fill="white"/>
      <path d="M8 8h16v4H8V8z" fill="white"/>
    </svg>
  );
}
