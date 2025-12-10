import React from 'react';

interface CoinbaseLogoProps {
  className?: string;
}

export default function CoinbaseLogo({ className = "w-8 h-8" }: CoinbaseLogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#0052FF"/>
      <path d="M16 6C10.48 6 6 10.48 6 16C6 21.52 10.48 26 16 26C21.52 26 26 21.52 26 16C26 10.48 21.52 6 16 6ZM16 22.5C11.86 22.5 8.5 19.14 8.5 15C8.5 10.86 11.86 7.5 16 7.5C20.14 7.5 23.5 10.86 23.5 15C23.5 19.14 20.14 22.5 16 22.5Z" fill="white"/>
      <path d="M16 11.5C13.52 11.5 11.5 13.52 11.5 16C11.5 18.48 13.52 20.5 16 20.5C18.48 20.5 20.5 18.48 20.5 16C20.5 13.52 18.48 11.5 16 11.5ZM16 18C14.62 18 13.5 16.88 13.5 15.5C13.5 14.12 14.62 13 16 13C17.38 13 18.5 14.12 18.5 15.5C18.5 16.88 17.38 18 16 18Z" fill="#0052FF"/>
    </svg>
  );
}
