import { useEffect } from 'react';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface SuccessPopupProps {
  message: string;
  onClose: () => void;
  autoCloseDelay?: number;
}

export default function SuccessPopup({ message, onClose, autoCloseDelay = 2000 }: SuccessPopupProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, autoCloseDelay);

    return () => clearTimeout(timer);
  }, [onClose, autoCloseDelay]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="relative bg-gradient-to-br from-green-500/20 via-emerald-500/20 to-teal-500/20 backdrop-blur-xl border border-green-400/50 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-fade-in">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg z-10"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4 border-2 border-green-400/50">
            <CheckCircleIcon className="w-10 h-10 text-green-400" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Success!</h3>
          <p className="text-gray-300 text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

