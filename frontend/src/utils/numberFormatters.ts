// Utility functions for formatting numbers in provider cards

export const formatPrice = (price: number): string => {
  if (price >= 1e9) {
    return `$${(price / 1e9).toFixed(2)}B`;
  } else if (price >= 1e6) {
    return `$${(price / 1e6).toFixed(2)}M`;
  } else if (price >= 1e3) {
    return `$${(price / 1e3).toFixed(2)}K`;
  } else {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};

export const formatVolume = (volume: number): string => {
  if (volume >= 1e9) {
    return `${(volume / 1e9).toFixed(1)}B`;
  } else if (volume >= 1e6) {
    return `${(volume / 1e6).toFixed(1)}M`;
  } else if (volume >= 1e3) {
    return `${(volume / 1e3).toFixed(1)}K`;
  } else {
    return volume.toLocaleString('en-US');
  }
};

export const formatPercentage = (percentage: number): string => {
  const sign = percentage >= 0 ? '+' : '';
  return `${sign}${percentage.toFixed(2)}%`;
};

export const formatMarketCap = (marketCap: number): string => {
  if (marketCap >= 1e12) {
    return `$${(marketCap / 1e12).toFixed(2)}T`;
  } else if (marketCap >= 1e9) {
    return `$${(marketCap / 1e9).toFixed(2)}B`;
  } else if (marketCap >= 1e6) {
    return `$${(marketCap / 1e6).toFixed(2)}M`;
  } else if (marketCap >= 1e3) {
    return `$${(marketCap / 1e3).toFixed(2)}K`;
  } else {
    return `$${marketCap.toLocaleString('en-US')}`;
  }
};

/**
 * Format price with dynamic precision to prevent identical values due to rounding
 * - Prices >= 1000: 2 decimals
 * - Prices >= 100: 3 decimals
 * - Prices >= 10: 4 decimals
 * - Prices >= 1: 5 decimals
 * - Prices < 1: 6 decimals
 * 
 * This ensures prices like 0.412345 are not shown as 0.41
 */
export const formatTradePrice = (price: number): string => {
  if (!price || price <= 0) return '0.00';
  
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 100) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  } else if (price >= 10) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  } else if (price >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  } else {
    return price.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  }
};
