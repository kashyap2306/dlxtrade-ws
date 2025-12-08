import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { broadcastPopupApi } from '../services/api';
import { isFirebaseAvailable } from '../config/firebase';

interface PopupData {
  title: string;
  benefits: string[];
  description: string;
  imageUrl?: string;
  oldPrice?: string;
  newPrice: string;
  actualCost: number;
  usersPurchased?: number;
  countdownEndTime?: number;
  active: boolean;
}

export default function BroadcastPopup() {
  const { user } = useAuth();
  const [popup, setPopup] = useState<PopupData | null>(null);
  const [show, setShow] = useState(false);
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Only enable popup system when Firebase is properly configured
    if (!isFirebaseAvailable()) {
      console.log('[BroadcastPopup] Disabled - Firebase not available');
      setPopup(null);
      setShow(false);
      return;
    }

    let pollingInterval: NodeJS.Timeout | null = null;

    const loadPopup = async () => {
      try {
        // Get current popup
        const popupResponse = await broadcastPopupApi.getCurrent();
        const popupData = popupResponse.data;

        if (popupData && popupData.active && !dismissed) {
          // Check if user has seen this popup
          try {
            const seenResponse = await broadcastPopupApi.getSeenPopups();
            const seenPopups = seenResponse.data?.seenPopups || [];
            const currentPopupId = 'current';

            if (!seenPopups.includes(currentPopupId)) {
              setPopup(popupData);
              setShow(true);
            }
          } catch (seenError) {
            console.error('Error checking seen popups:', seenError);
            // Show popup anyway if check fails
            setPopup(popupData);
            setShow(true);
          }
        } else {
          setPopup(null);
          setShow(false);
        }
      } catch (error) {
        console.error('Error loading broadcast popup:', error);
        // If API fails (e.g., backend not running), disable popup
        setPopup(null);
        setShow(false);
      }
    };

    // Initial load
    loadPopup();

    // Poll for popup updates every 30 seconds
    pollingInterval = setInterval(loadPopup, 30000);

    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };

    return () => unsubscribe();
  }, [user, dismissed]);

  // Update countdown timer
  useEffect(() => {
    if (!popup?.countdownEndTime) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const remaining = popup.countdownEndTime! - now;

      if (remaining <= 0) {
        setCountdown({ hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

      setCountdown({ hours, minutes, seconds });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [popup?.countdownEndTime]);

  const handleDismiss = async () => {
    if (!user || !popup) return;

    try {
      // If Firebase is not available, just dismiss locally
      if (!isFirebaseAvailable()) {
        setDismissed(true);
        setShow(false);
        setPopup(null);
        return;
      }

      // Mark popup as seen via backend API
      await broadcastPopupApi.markAsSeen('current');

      setDismissed(true);
      setShow(false);
      setPopup(null);
    } catch (error) {
      console.error('Error dismissing popup:', error);
      // Still dismiss locally even if API fails
      setDismissed(true);
      setShow(false);
      setPopup(null);
    }
  };

  const handlePurchase = () => {
    // Handle purchase action
    window.location.href = '/agents'; // Redirect to agents page or handle purchase
    handleDismiss();
  };

  if (!show || !popup) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleDismiss}
      />

      {/* Popup Card */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto card animate-slide-up">
        {/* Close Button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-slate-800/80 hover:bg-slate-700/80 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="space-y-6">
          {/* Title */}
          <h2 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent pr-12">
            {popup.title}
          </h2>

          {/* Benefits */}
          {popup.benefits && popup.benefits.length > 0 && (
            <div className="space-y-3">
              {popup.benefits.map((benefit, index) => (
                <div key={index} className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-gray-200 text-lg">{benefit}</span>
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          {popup.description && (
            <div className="text-gray-300 leading-relaxed">
              {popup.description.split('\n').map((line, i) => (
                <p key={i} className="mb-2">{line}</p>
              ))}
            </div>
          )}

          {/* Image */}
          {popup.imageUrl && (
            <div className="rounded-lg overflow-hidden border border-purple-500/30">
              <img 
                src={popup.imageUrl} 
                alt={popup.title}
                className="w-full h-64 object-cover"
              />
            </div>
          )}

          {/* Pricing */}
          <div className="flex items-center gap-4 flex-wrap">
            {popup.oldPrice && (
              <span className="text-2xl text-red-400 line-through">
                {popup.oldPrice}
              </span>
            )}
            <span className="text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
              {popup.newPrice}
            </span>
          </div>

          {/* Cost and Users Purchased */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <div className="text-sm text-gray-400 mb-1">Actual Cost</div>
              <div className="text-2xl font-bold text-cyan-400">${popup.actualCost}</div>
            </div>
            {popup.usersPurchased !== undefined && (
              <div className="card">
                <div className="text-sm text-gray-400 mb-1">Users Purchased</div>
                <div className="text-2xl font-bold text-purple-400">{popup.usersPurchased}+</div>
              </div>
            )}
          </div>

          {/* Countdown Timer */}
          {countdown && (
            <div className="card text-center">
              <div className="text-sm text-gray-400 mb-2">Time Remaining</div>
              <div className="flex items-center justify-center gap-4">
                <div>
                  <div className="text-3xl font-bold text-cyan-400">{String(countdown.hours).padStart(2, '0')}</div>
                  <div className="text-xs text-gray-500">Hours</div>
                </div>
                <div className="text-2xl text-gray-600">:</div>
                <div>
                  <div className="text-3xl font-bold text-cyan-400">{String(countdown.minutes).padStart(2, '0')}</div>
                  <div className="text-xs text-gray-500">Minutes</div>
                </div>
                <div className="text-2xl text-gray-600">:</div>
                <div>
                  <div className="text-3xl font-bold text-cyan-400">{String(countdown.seconds).padStart(2, '0')}</div>
                  <div className="text-xs text-gray-500">Seconds</div>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            <button
              onClick={handlePurchase}
              className="btn btn-primary flex-1"
            >
              Purchase Now
            </button>
            <button
              onClick={handleDismiss}
              className="btn btn-secondary"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

