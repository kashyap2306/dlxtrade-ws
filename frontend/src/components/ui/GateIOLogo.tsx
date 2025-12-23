import React from 'react';

interface GateIOLogoProps {
  className?: string;
}

export default function GateIOLogo({ className = "w-8 h-8" }: GateIOLogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="#C4A000"/>
      <path d="M8 12h2v8h2v-8h2v8h2v-8h2v8h2V12h2v12H8V12z" fill="white"/>
      <path d="M8 8h16v4H8V8z" fill="white"/>
      <rect x="12" y="16" width="8" height="2" fill="#C4A000"/>
    </svg>
  );
}
