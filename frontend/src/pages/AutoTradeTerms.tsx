import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AutoTradeTerms() {
  const navigate = useNavigate();
  const [canAccept, setCanAccept] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const termsRef = useRef<HTMLDivElement>(null);

  // Check if user has scrolled to bottom
  const handleScroll = () => {
    if (!termsRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = termsRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px tolerance

    setCanAccept(isAtBottom);
  };

  // Auto-scroll detection
  useEffect(() => {
    const termsElement = termsRef.current;
    if (termsElement) {
      termsElement.addEventListener('scroll', handleScroll);
      return () => termsElement.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const handleAccept = async () => {
    if (!canAccept) return;

    setAccepting(true);

    try {
      // Simulate saving acceptance (in real implementation, this would save to backend)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Set terms as accepted and navigate back (AutoTrade page will handle enabling)
      localStorage.setItem('autoTradeTermsAccepted', 'true');
      navigate('/auto-trade');
    } catch (error) {
      console.error('Failed to accept terms:', error);
    } finally {
      setAccepting(false);
    }
  };

  const handleCancel = () => {
    navigate('/auto-trade');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d1421] to-[#05070c] overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-200 mb-2">Auto-Trade Terms & Conditions</h1>
          <p className="text-blue-100/60">Please read and accept the terms to enable Auto-Trade</p>
        </div>

        {/* Terms Content */}
        <div className="bg-[#0a0f1a] border border-blue-500/20 rounded-xl p-6 mb-6">
          <div
            ref={termsRef}
            className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-blue-700 scrollbar-track-blue-900 p-4 border border-blue-500/10 rounded-lg bg-[#0b0f18]"
          >
            <div className="text-blue-100 space-y-6">
              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">1. Auto-Trade General Description</h2>
                <p className="text-sm leading-relaxed">
                  Auto-Trade is an automated trading system that executes futures trading strategies on your behalf.
                  The system analyzes market data, identifies trading opportunities, and automatically opens and closes positions
                  based on predefined algorithms and risk management parameters.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">2. How Automated Orders Are Triggered</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Automated orders are triggered through algorithmic analysis of:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Real-time market data from integrated data providers</li>
                  <li>• Technical indicators and price action analysis</li>
                  <li>• Risk management parameters including position sizing</li>
                  <li>• Predefined entry and exit conditions</li>
                  <li>• Market volatility and liquidity assessments</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">3. Data Provider Requirements</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Auto-Trade requires active connections to data providers for market analysis:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Primary market data API (e.g., CryptoCompare, CoinGecko)</li>
                  <li>• News and sentiment analysis APIs (e.g., NewsData.io)</li>
                  <li>• Metadata and additional market information</li>
                  <li>• Real-time price feeds and order book data</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">4. Exchange Requirements</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Trading execution requires valid exchange API credentials:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Active futures trading account on supported exchanges</li>
                  <li>• Valid API key and secret with trading permissions</li>
                  <li>• Sufficient account balance for margin requirements</li>
                  <li>• Futures trading permissions enabled on the exchange</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">5. Futures Trading Risk</h2>
                <p className="text-sm leading-relaxed">
                  <strong className="text-red-400">CRITICAL RISK WARNING:</strong> Futures trading involves substantial risk of loss and is not suitable for every investor.
                  The use of leverage can work against you as well as for you. Before enabling Auto-Trade, you should carefully
                  consider your investment objectives, level of experience, and risk appetite.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">6. Leverage Usage Explanation</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Auto-Trade utilizes leverage in futures trading, which means:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Small price movements can result in large gains or losses</li>
                  <li>• Required margin is only a fraction of the total position value</li>
                  <li>• Liquidation can occur if account equity falls below maintenance margin</li>
                  <li>• Losses can exceed your initial investment</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">7. Margin/Liquidation Risks</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Margin requirements and liquidation risks include:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Initial margin requirements vary by asset and leverage</li>
                  <li>• Maintenance margin must be maintained to avoid liquidation</li>
                  <li>• Liquidation may result in total loss of position value</li>
                  <li>• Auto-Trade cannot prevent exchange-enforced liquidations</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">8. Spread/Slippage Risks</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Order execution may be affected by:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Bid-ask spreads in illiquid market conditions</li>
                  <li>• Price slippage during high volatility or low liquidity</li>
                  <li>• Execution delays due to network latency</li>
                  <li>• Partial fills or order rejections during extreme market movements</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">9. Volatility Risk</h2>
                <p className="text-sm leading-relaxed">
                  Cryptocurrency markets are highly volatile. Auto-Trade operates in these conditions, which means:
                  rapid price movements, flash crashes, and extreme volatility events can occur without warning,
                  potentially resulting in significant losses beyond normal risk expectations.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">10. News-Event Risk</h2>
                <p className="text-sm leading-relaxed mb-3">
                  Major news events and market catalysts can cause:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Sudden and extreme price movements</li>
                  <li>• Gap openings that skip stop-loss levels</li>
                  <li>• Temporary exchange halts or trading suspensions</li>
                  <li>• Increased volatility that may trigger multiple orders simultaneously</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">11. System Downtime Risk</h2>
                <p className="text-sm leading-relaxed">
                  System unavailability may occur due to maintenance, technical issues, or force majeure events.
                  During these periods, Auto-Trade will be unable to monitor markets or execute trades, potentially
                  missing opportunities or leaving positions unmanaged.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">12. API Disconnection Risk</h2>
                <p className="text-sm leading-relaxed mb-3">
                  API connectivity issues may result in:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Temporary loss of market data feeds</li>
                  <li>• Delayed order execution or failed orders</li>
                  <li>• Inability to monitor existing positions</li>
                  <li>• Missed trading signals during disconnection periods</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">13. Incorrect Configuration Risk</h2>
                <p className="text-sm leading-relaxed">
                  Improperly configured risk parameters, position sizing, or trading rules can result in:
                  excessive losses, unintended position sizes, or failure to adhere to your risk management preferences.
                  You are responsible for verifying all configuration settings before enabling Auto-Trade.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">14. User Responsibility</h2>
                <p className="text-sm leading-relaxed mb-3">
                  As the account holder, you are responsible for:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Verifying all configuration settings and risk parameters</li>
                  <li>• Maintaining sufficient account balance for margin requirements</li>
                  <li>• Monitoring account activity and system status</li>
                  <li>• Understanding the automated strategies being executed</li>
                  <li>• Disabling Auto-Trade during periods of high personal risk tolerance changes</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">15. Platform Responsibility Disclaimer</h2>
                <p className="text-sm leading-relaxed">
                  DLXTRADE provides the Auto-Trade platform as a tool for automated trading execution. We are not liable for:
                  trading losses, market volatility impacts, exchange-specific issues, or any financial outcomes resulting from
                  automated trading activities. The platform is provided "as is" without warranties of any kind.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">16. Security Requirements</h2>
                <p className="text-sm leading-relaxed mb-3">
                  You must maintain security best practices including:
                </p>
                <ul className="text-sm space-y-1 ml-4">
                  <li>• Secure storage of API credentials and account information</li>
                  <li>• Use of strong, unique passwords for all accounts</li>
                  <li>• Regular monitoring of account activity for unauthorized access</li>
                  <li>• Immediate reporting of suspected security breaches</li>
                </ul>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">17. Data Logging Consent</h2>
                <p className="text-sm leading-relaxed">
                  By enabling Auto-Trade, you consent to the logging of trading activity, performance metrics,
                  and system usage data for analysis and improvement purposes. This data helps optimize the
                  platform while maintaining your privacy and account security.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">18. Performance Not Guaranteed Disclaimer</h2>
                <p className="text-sm leading-relaxed">
                  <strong className="text-yellow-400">IMPORTANT:</strong> Past performance, backtesting results, and simulated trading
                  do not guarantee future results. Auto-Trade performance can vary significantly based on market conditions,
                  parameter settings, and external factors. No representation is made that any account will achieve profits or avoid losses.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">19. Account Termination Conditions</h2>
                <p className="text-sm leading-relaxed">
                  DLXTRADE reserves the right to suspend or terminate Auto-Trade access for any account that:
                  engages in abusive trading practices, violates platform terms, experiences unusual trading patterns,
                  or is suspected of market manipulation or other prohibited activities.
                </p>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-blue-200 mb-3">20. Final Agreement</h2>
                <p className="text-sm leading-relaxed mb-4">
                  By clicking "I Accept & Enable Auto-Trade" below, you acknowledge that you have read, understood,
                  and agree to be bound by all 20 sections of these terms and conditions. You accept full responsibility
                  for all automated trading activities and associated risks. This agreement constitutes the entire
                  understanding between you and DLXTRADE regarding Auto-Trade usage.
                </p>
                <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                  <p className="text-sm text-blue-200 font-medium">
                    ⚠️ Please scroll to the bottom of this agreement to enable the acceptance button.
                  </p>
                </div>
              </section>
            </div>
          </div>

          {/* Acceptance Section */}
          <div className="flex items-center justify-between pt-4 border-t border-blue-500/20">
            <div className="text-sm text-blue-100/60">
              {canAccept ? (
                <span className="text-green-400">✓ You have read the complete agreement</span>
              ) : (
                <span>Please scroll to the bottom to continue</span>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={handleCancel}
                className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-blue-100 rounded-lg transition-colors"
                disabled={accepting}
              >
                Cancel
              </button>
              <button
                onClick={handleAccept}
                disabled={!canAccept || accepting}
                className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg shadow-lg transition-colors"
              >
                {accepting ? 'Enabling...' : 'I Accept & Enable Auto-Trade'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
