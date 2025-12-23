import React from 'react';

// Coin Image System with 3-level fallback logic
export interface CoinImageResult {
  main: string;
  supporting: string[];
  fallbackUsed: boolean;
}

/**
 * Get coin images using 3-level fallback system:
 * 1. Primary: CoinGecko → coins/{id} → image.large
 * 2. Backup: CoinPaprika → coins/{id} → logo
 * 3. Final fallback: GitHub cryptocurrency-icons → 128/color/{symbol}.png
 */
export async function getCoinImages(
  coinId: string,
  symbol: string,
  newsImages: string[] = []
): Promise<CoinImageResult> {
  const result: CoinImageResult = {
    main: '',
    supporting: [],
    fallbackUsed: false
  };

  try {
    // Level 1: CoinGecko (Primary)
    try {
      const coingeckoResponse = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`);
      if (coingeckoResponse.ok) {
        const coingeckoData = await coingeckoResponse.json();
        if (coingeckoData?.image?.large) {
          result.main = coingeckoData.image.large;
        }
      }
    } catch (error) {
      console.debug('CoinGecko API failed:', error);
    }

    // Level 2: CoinPaprika (Backup) - if CoinGecko failed
    if (!result.main) {
      try {
        const paprikaResponse = await fetch(`https://api.coinpaprika.com/v1/coins/${coinId}`);
        if (paprikaResponse.ok) {
          const paprikaData = await paprikaResponse.json();
          if (paprikaData?.logo) {
            result.main = paprikaData.logo;
          }
        }
      } catch (error) {
        console.debug('CoinPaprika API failed:', error);
      }
    }

    // Level 3: GitHub fallback
    if (!result.main) {
      const symbolUpper = symbol.toUpperCase();
      result.main = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbolUpper}.png`;
      result.fallbackUsed = true;
    }

    // Add supporting images (news images if available, otherwise fallback icons)
    if (newsImages && newsImages.length > 0) {
      result.supporting = newsImages.slice(0, 2); // Max 2 supporting images
    } else {
      // Use smaller versions of the main image or additional fallback icons
      result.supporting = [
        result.main.replace('/large/', '/small/').replace('/128/', '/32/'),
        result.main.replace('/large/', '/thumb/').replace('/128/', '/64/')
      ];
    }

  } catch (error) {
    console.error('Error fetching coin images:', error);
    // Ultimate fallback
    const symbolUpper = symbol.toUpperCase();
    result.main = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbolUpper}.png`;
    result.supporting = [
      `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/color/${symbolUpper}.png`,
      `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/64/color/${symbolUpper}.png`
    ];
    result.fallbackUsed = true;
  }

  return result;
}

/**
 * React hook for loading coin images with caching
 */
export function useCoinImages(coinId: string, symbol: string, newsImages: string[] = []) {
  const [images, setImages] = React.useState<CoinImageResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!coinId || !symbol) return;

    const loadImages = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await getCoinImages(coinId, symbol, newsImages);
        setImages(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load coin images');
        // Set fallback images
        const symbolUpper = symbol.toUpperCase();
        setImages({
          main: `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbolUpper}.png`,
          supporting: [
            `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/color/${symbolUpper}.png`,
            `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/64/color/${symbolUpper}.png`
          ],
          fallbackUsed: true
        });
      } finally {
        setLoading(false);
      }
    };

    loadImages();
  }, [coinId, symbol, newsImages]);

  return { images, loading, error };
}
