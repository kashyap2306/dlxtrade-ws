// Utility functions for ResearchPanel component

export const canExecute = (accuracy: number, settings?: any): boolean => {
  if (!settings) return false;
  return settings.autoTradeEnabled && accuracy >= (settings.minAccuracyThreshold || 0.85);
};
