/**
 * Sentiment Strategy Module
 * Analyzes news and social sentiment from LunarCrush
 */

export interface SentimentData {
  sentiment?: number; // -1 to 1 (LunarCrush sentiment)
  bullishSentiment?: number; // 0 to 1 (LunarCrush bullish sentiment)
  socialScore?: number; // Social score
  socialVolume?: number; // Social volume
  timestamp?: number;
}

export interface SentimentResult {
  signal: 'Bullish' | 'Bearish' | 'Neutral';
  score: number; // 0-1 normalized score
  sentiment: number; // Raw sentiment value
  description: string;
}

/**
 * Analyze sentiment from LunarCrush data
 * Signal logic:
 * - Sentiment > 0.3 → Bullish
 * - Sentiment < -0.3 → Bearish
 * - Between -0.3 and 0.3 → Neutral
 * 
 * Uses both sentiment (-1 to 1) and bullishSentiment (0 to 1) if available
 */
export function analyzeSentiment(data: SentimentData): SentimentResult {
  // Prefer bullishSentiment if available (0-1 scale), otherwise use sentiment (-1 to 1)
  let sentimentValue: number;
  
  if (data.bullishSentiment !== undefined && data.bullishSentiment !== null) {
    // Convert bullishSentiment (0-1) to sentiment scale (-1 to 1)
    sentimentValue = (data.bullishSentiment - 0.5) * 2;
  } else if (data.sentiment !== undefined && data.sentiment !== null) {
    sentimentValue = data.sentiment;
  } else {
    // No sentiment data available
    return {
      signal: 'Neutral',
      score: 0.5,
      sentiment: 0,
      description: 'Sentiment data not available',
    };
  }

  let signal: 'Bullish' | 'Bearish' | 'Neutral';
  let score: number;
  let description: string;

  if (sentimentValue > 0.3) {
    // Strong bullish sentiment
    signal = 'Bullish';
    // Normalize: 1.0 = 1.0, 0.3 = 0.65, 0 = 0.5
    score = Math.min(1.0, 0.5 + (sentimentValue * 0.5));
    description = `Strong bullish sentiment ${sentimentValue.toFixed(2)} → Bullish`;
  } else if (sentimentValue < -0.3) {
    // Strong bearish sentiment
    signal = 'Bearish';
    // Normalize: -1.0 = 0.0, -0.3 = 0.35, 0 = 0.5
    score = Math.max(0.0, 0.5 + (sentimentValue * 0.5));
    description = `Strong bearish sentiment ${sentimentValue.toFixed(2)} → Bearish`;
  } else if (sentimentValue > 0.1) {
    // Slightly bullish
    signal = 'Bullish';
    score = 0.5 + (sentimentValue * 0.25); // Scale 0.1-0.3 to 0.525-0.575
    description = `Slightly bullish sentiment ${sentimentValue.toFixed(2)} → Bullish`;
  } else if (sentimentValue < -0.1) {
    // Slightly bearish
    signal = 'Bearish';
    score = 0.5 + (sentimentValue * 0.25); // Scale -0.1 to -0.3 to 0.475-0.425
    description = `Slightly bearish sentiment ${sentimentValue.toFixed(2)} → Bearish`;
  } else {
    // Neutral
    signal = 'Neutral';
    score = 0.5;
    description = `Neutral sentiment ${sentimentValue.toFixed(2)} → Neutral`;
  }

  return {
    signal,
    score,
    sentiment: sentimentValue,
    description,
  };
}

