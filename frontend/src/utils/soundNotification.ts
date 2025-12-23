/**
 * Sound Notification Utility
 * Handles playing sounds for notifications based on user preferences
 */

const NOTIFICATION_TYPE_MAP: Record<string, string> = {
  'autoTradeExecuted': 'autoTradeExecuted',
  'tradeApproved': 'tradeApproved',
  'tradeRejected': 'tradeRejected',
  'accuracyAlert': 'accuracyAlert',
  'whaleAlert': 'whaleAlert',
  'dailyLossLimitHit': 'dailyLossLimitHit',
  'maxTradesLimitHit': 'maxTradesLimitHit',
  'autoTradeEnabled': 'autoTradeEnabled',
  'autoTradeDisabled': 'autoTradeDisabled',
  'engineStarted': 'engineStarted',
  'engineStopped': 'engineStopped',
  'pendingTradeConfirmation': 'pendingTradeConfirmation',
  'apiFailure': 'apiFailure',
  'exchangeDisconnected': 'exchangeDisconnected',
  'riskRuleViolation': 'riskRuleViolation',
};

// Map notification types to sound file paths
const SOUND_MAP: Record<string, string> = {
  'autoTradeExecuted': '/sounds/trade-executed.mp3',
  'tradeApproved': '/sounds/trade-approved.mp3',
  'tradeRejected': '/sounds/trade-rejected.mp3',
  'accuracyAlert': '/sounds/accuracy-alert.mp3',
  'whaleAlert': '/sounds/whale-alert.mp3',
  'dailyLossLimitHit': '/sounds/warning.mp3',
  'maxTradesLimitHit': '/sounds/warning.mp3',
  'autoTradeEnabled': '/sounds/success.mp3',
  'autoTradeDisabled': '/sounds/info.mp3',
  'engineStarted': '/sounds/success.mp3',
  'engineStopped': '/sounds/info.mp3',
  'pendingTradeConfirmation': '/sounds/notification.mp3',
  'apiFailure': '/sounds/error.mp3',
  'exchangeDisconnected': '/sounds/error.mp3',
  'riskRuleViolation': '/sounds/warning.mp3',
};

// Fallback sound if specific sound not found
const DEFAULT_SOUND = '/sounds/notification.mp3';

// Cache for audio elements to avoid reloading
const audioCache = new Map<string, HTMLAudioElement>();

/**
 * Play sound for a notification type
 */
export async function playNotificationSound(notificationType: string): Promise<void> {
  // Map notification type to sound file
  const typeId = NOTIFICATION_TYPE_MAP[notificationType] || notificationType;
  const soundPath = SOUND_MAP[typeId] || DEFAULT_SOUND;

  try {
    // Get or create audio element
    let audio = audioCache.get(soundPath);
    if (!audio) {
      audio = new Audio(soundPath);
      audio.volume = 0.5; // Set volume to 50%
      audioCache.set(soundPath, audio);
    }

    // Reset audio to beginning and play
    audio.currentTime = 0;

    // Play with error handling for autoplay policies
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        // Autoplay was prevented - user interaction required
        console.warn('Sound playback prevented by browser:', error);
        // Silently fail - don't spam console
      });
    }
  } catch (error) {
    // Silently fail if sound file doesn't exist or can't be played
    console.warn('Failed to play notification sound:', error);
  }
}

/**
 * Trigger vibration for notifications (mobile support)
 */
export function triggerVibration(pattern: number | number[] = [200, 100, 200]): void {
  if (!('vibrate' in navigator)) {
    return; // Not supported, silently ignore
  }

  try {
    navigator.vibrate(pattern);
  } catch (error) {
    // Silently fail if vibration is not supported or blocked
    console.warn('Vibration not available:', error);
  }
}

/**
 * Check if vibration is enabled
 * Deprecated: Use data.vibrateEnabled instead
 */
export function isVibrationEnabled(): boolean {
  try {
    const stored = localStorage.getItem('notificationVibration');
    return stored === 'true';
  } catch (err) {
    return false;
  }
}

/**
 * Handle notification with sound and vibration
 * Uses data.soundEnabled and data.vibrationEnabled to determine actions
 */
export async function handleNotification(notificationType: string, data?: any): Promise<void> {
  const soundEnabled = data?.soundEnabled ?? false;
  const vibrationEnabled = data?.vibrationEnabled ?? false;

  // Play sound if enabled
  if (soundEnabled) {
    await playNotificationSound(notificationType);
  }

  // Trigger vibration if enabled
  if (vibrationEnabled) {
    triggerVibration();
  }
}

