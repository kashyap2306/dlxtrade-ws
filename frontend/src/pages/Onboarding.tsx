import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { agentsApi } from '../services/api';
import Toast from '../components/Toast';

interface Agent {
  id: string;
  name: string;
  description?: string;
  price?: number;
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  
  // Form data
  const [tradingMarkets, setTradingMarkets] = useState<string[]>([]);
  const [experienceLevel, setExperienceLevel] = useState('');
  const [interestedAgents, setInterestedAgents] = useState<string[]>([]);
  const [portfolioSize, setPortfolioSize] = useState('');
  const [preferences, setPreferences] = useState({
    riskLevel: '',
    tradingStyle: '',
    analysisType: '',
  });
  
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  const totalSteps = 6;

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    // Check if user already completed onboarding
    const checkOnboarding = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.data();
        if (userData && userData.onboardingRequired === false) {
          navigate('/dashboard');
          return;
        }
      } catch (err) {
        console.error('Error checking onboarding status:', err);
      }
    };

    checkOnboarding();
    loadAgents();
  }, [user, navigate]);

  const loadAgents = async () => {
    try {
      const response = await agentsApi.getAll();
      const agents = response.data.agents || [];
      setAvailableAgents(agents);
    } catch (err: any) {
      console.error('Error loading agents:', err);
      showToast('Failed to load agents', 'error');
    } finally {
      setLoadingAgents(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleMarketToggle = (market: string) => {
    setTradingMarkets(prev => 
      prev.includes(market) 
        ? prev.filter(m => m !== market)
        : [...prev, market]
    );
  };

  const handleAgentToggle = (agentId: string) => {
    setInterestedAgents(prev => 
      prev.includes(agentId) 
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    );
  };

  const handleNext = () => {
    // Validation
    if (currentStep === 1 && tradingMarkets.length === 0) {
      showToast('Please select at least one market', 'error');
      return;
    }
    if (currentStep === 2 && !experienceLevel) {
      showToast('Please select your trading experience', 'error');
      return;
    }
    if (currentStep === 3) {
      // Agents are optional, so no validation needed
    }
    if (currentStep === 4 && !portfolioSize) {
      showToast('Please select your portfolio size', 'error');
      return;
    }
    if (currentStep === 5) {
      if (!preferences.riskLevel || !preferences.tradingStyle || !preferences.analysisType) {
        showToast('Please fill all trading preferences', 'error');
        return;
      }
    }

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        tradingMarkets,
        experienceLevel,
        interestedAgents,
        portfolioSize,
        preferences,
        onboardingRequired: false,
        updatedAt: new Date(),
      });

      showToast('Onboarding completed successfully!', 'success');
      setTimeout(() => {
        navigate('/dashboard');
      }, 1000);
    } catch (err: any) {
      console.error('Error completing onboarding:', err);
      showToast('Failed to save onboarding data. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const progress = (currentStep / totalSteps) * 100;

  const getInitials = (): string => {
    if (!user) return 'U';
    if (user.displayName) {
      return user.displayName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 relative overflow-hidden">
      {/* Mobile Header - Only visible on mobile */}
      <header className="md:hidden fixed inset-x-0 top-0 z-[9999] bg-slate-900/95 backdrop-blur-2xl border-b border-slate-800/50 shadow-lg px-3 py-3">
        <div className="flex items-center justify-between gap-2 w-full">
          {/* Left side: Hamburger menu, Logo, Brand name */}
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
            {/* Hamburger Menu Icon */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 text-white hover:bg-slate-800/50 rounded-lg transition-colors flex-shrink-0"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* D Logo with blue gradient */}
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 via-blue-400 to-cyan-400 flex items-center justify-center flex-shrink-0 shadow-lg">
              <span className="text-white font-bold text-base">D</span>
            </div>

            {/* DigiLinex Brand Name - Truncate on small screens */}
            <span className="text-white font-semibold text-base truncate">DigiLinex</span>
          </div>

          {/* Right side: Notification bell, User avatar, Dropdown - Always visible */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Notification Bell */}
            <button className="w-9 h-9 rounded-lg bg-slate-800/90 border border-slate-600/30 flex items-center justify-center hover:bg-slate-700/50 transition-colors flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
            </button>

            {/* User Avatar with initials */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 via-purple-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-lg">
              <span className="text-white font-semibold text-xs">{getInitials()}</span>
            </div>

            {/* Dropdown Chevron */}
            <button className="p-1 text-white hover:bg-slate-800/50 rounded transition-colors flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile top padding to avoid content under header */}
      <div className="md:hidden h-16" />

      <div className="px-4 py-8 relative">
      {/* Animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      <div className="relative max-w-2xl mx-auto z-10">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-400">Step {currentStep} of {totalSteps}</span>
            <span className="text-sm text-gray-400">{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-slate-800/50 rounded-full h-2 overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-slate-800/50 backdrop-blur-xl border border-purple-500/20 rounded-2xl shadow-2xl p-6 sm:p-8">
          {/* Step A - Market Type */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  Which markets do you trade in?
                </h2>
                <p className="text-gray-400 text-sm">Select all that apply</p>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {['Crypto', 'Stocks', 'Forex', 'Options', 'Commodities', 'Futures', 'Other'].map((market) => (
                  <button
                    key={market}
                    type="button"
                    onClick={() => handleMarketToggle(market)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      tradingMarkets.includes(market)
                        ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                        : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{market}</span>
                      {tradingMarkets.includes(market) && (
                        <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step B - Trading Experience */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  How long have you been trading?
                </h2>
                <p className="text-gray-400 text-sm">Select your experience level</p>
              </div>
              
              <div className="space-y-3">
                {[
                  { value: 'new', label: 'New Trader (0–3 months)' },
                  { value: 'beginner', label: 'Beginner (3–12 months)' },
                  { value: 'intermediate', label: 'Intermediate (1–3 years)' },
                  { value: 'advanced', label: 'Advanced (3+ years)' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExperienceLevel(option.value)}
                    className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                      experienceLevel === option.value
                        ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                        : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{option.label}</span>
                      {experienceLevel === option.value && (
                        <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step C - Agents Interest */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  Which premium agent(s) are you interested in?
                </h2>
                <p className="text-gray-400 text-sm">Select the agent(s) you would like to buy</p>
              </div>
              
              {loadingAgents ? (
                <div className="text-center py-8 text-gray-400">Loading agents...</div>
              ) : availableAgents.length === 0 ? (
                <div className="text-center py-8 text-gray-400">No agents available</div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {availableAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => handleAgentToggle(agent.id)}
                      className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                        interestedAgents.includes(agent.id)
                          ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                          : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{agent.name}</div>
                          {agent.description && (
                            <div className="text-sm text-gray-400 mt-1 line-clamp-1">{agent.description}</div>
                          )}
                          {agent.price !== undefined && (
                            <div className="text-sm text-purple-400 mt-1">${agent.price}</div>
                          )}
                        </div>
                        {interestedAgents.includes(agent.id) && (
                          <svg className="w-5 h-5 text-purple-400 ml-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500 text-center">You can skip this step if you're not interested in any agents yet</p>
            </div>
          )}

          {/* Step D - Portfolio Size */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  What is your current portfolio size?
                </h2>
                <p className="text-gray-400 text-sm">Select the range that best describes your portfolio</p>
              </div>
              
              <div className="space-y-3">
                {[
                  { value: '0-1000', label: '₹0 – ₹1,000' },
                  { value: '1000-10000', label: '₹1,000 – ₹10,000' },
                  { value: '10000-100000', label: '₹10,000 – ₹100,000' },
                  { value: '100000-1000000', label: '₹100,000 – ₹1,000,000' },
                  { value: '1000000+', label: '₹1,000,000+' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPortfolioSize(option.value)}
                    className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                      portfolioSize === option.value
                        ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                        : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{option.label}</span>
                      {portfolioSize === option.value && (
                        <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step E - Trading Preferences */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  Tell us about your trading preferences
                </h2>
                <p className="text-gray-400 text-sm">Help us customize your experience</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Risk Level</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Low', 'Medium', 'High'].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setPreferences({ ...preferences, riskLevel: level.toLowerCase() })}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          preferences.riskLevel === level.toLowerCase()
                            ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                            : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Trading Style</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Intraday', 'Swing', 'Long-term'].map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setPreferences({ ...preferences, tradingStyle: style.toLowerCase() })}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          preferences.tradingStyle === style.toLowerCase()
                            ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                            : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Preferred Analysis</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Technical', 'Fundamental', 'AI Signals'].map((analysis) => (
                      <button
                        key={analysis}
                        type="button"
                        onClick={() => setPreferences({ ...preferences, analysisType: analysis.toLowerCase().replace(' ', '_') })}
                        className={`p-3 rounded-lg border-2 transition-all ${
                          preferences.analysisType === analysis.toLowerCase().replace(' ', '_')
                            ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                            : 'border-purple-500/30 bg-slate-900/50 text-gray-300 hover:border-purple-500/50'
                        }`}
                      >
                        {analysis}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step F - Completion */}
          {currentStep === 6 && (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 border-2 border-green-500/50 flex items-center justify-center">
                <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  Setup Complete
                </h2>
                <p className="text-gray-400">Your profile is ready. Continue to your dashboard.</p>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="mt-8 flex gap-3">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 px-4 py-2.5 bg-slate-900/50 border border-purple-500/30 rounded-lg text-gray-300 hover:bg-slate-800/50 transition-all"
                disabled={loading}
              >
                Back
              </button>
            )}
            {currentStep < totalSteps ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
                disabled={loading}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Go to Dashboard'}
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </div>
  );
}

