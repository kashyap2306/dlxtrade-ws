import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, GithubAuthProvider, updateProfile } from 'firebase/auth';
import { auth } from '../config/firebase';
import { authApi } from '../services/api';
import Toast from '../components/Toast';
import { useError } from '../contexts/ErrorContext';
import { getFirebaseErrorMessage, suppressConsoleError } from '../utils/errorHandler';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const navigate = useNavigate();
  const { showError } = useError();

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const validatePhone = (phone: string): boolean => {
    // Basic phone validation - 10 digits minimum
    const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  };

  const validatePassword = (password: string): string | null => {
    if (password.length < 6) {
      return 'Password must be at least 6 characters';
    }
    if (!/(?=.*[a-z])/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/(?=.*[A-Z])/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/(?=.*[0-9])/.test(password)) {
      return 'Password must contain at least one number';
    }
    return null;
  };


  const handleAfterSignUp = async (userCredential: any) => {
    try {
      // Update profile with display name
      if (fullName) {
        await updateProfile(userCredential.user, { displayName: fullName });
      }

      const token = await userCredential.user.getIdToken();
      localStorage.setItem('firebaseToken', token);
      localStorage.setItem('firebaseUser', JSON.stringify({
        uid: userCredential.user.uid,
        email: userCredential.user.email,
      }));

      // Call backend afterSignIn endpoint - this triggers ensureUser() which creates all Firestore documents
      const authResponse = await authApi.afterSignIn(token);

      if (!authResponse.data.success) {
        throw new Error(authResponse.data.error || 'User onboarding failed');
      }

      // New users always go to onboarding
      navigate('/onboarding');
    } catch (err: any) {
      suppressConsoleError(err, 'completeSignUp');
      const { message, type } = getFirebaseErrorMessage(err);
      showError(message, type);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!fullName || fullName.length < 2) {
      showError('Full name must be at least 2 characters', 'validation');
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Enter a valid email address', 'validation');
      return;
    }

    if (!phone || !validatePhone(phone)) {
      showError('Enter a valid phone number', 'validation');
      return;
    }

    if (password !== confirmPassword) {
      showError('Passwords do not match', 'validation');
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      showError(passwordError, 'validation');
      return;
    }

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await handleAfterSignUp(userCredential);
    } catch (err: any) {
      suppressConsoleError(err, 'signup');
      const { message, type } = getFirebaseErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      await handleAfterSignUp(userCredential);
    } catch (err: any) {
      suppressConsoleError(err, 'googleSignup');
      const { message, type } = getFirebaseErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubSignup = async () => {
    setLoading(true);
    try {
      const provider = new GithubAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      await handleAfterSignUp(userCredential);
    } catch (err: any) {
      suppressConsoleError(err, 'githubSignup');
      const { message, type } = getFirebaseErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 relative overflow-hidden px-4 py-8">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>
      
      <div className="relative card max-w-md w-full p-6 sm:p-8 mx-4 z-10">
        <h1 className="text-2xl sm:text-3xl font-bold text-center mb-2 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
          DLXTRADE
        </h1>
        <h2 className="text-xl font-semibold text-center mb-6 text-gray-300">Create Account</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">
              Full Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-2.5 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              placeholder="e.g., Jane Doe"
              disabled={loading}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">
              Email Address <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              className="w-full px-4 py-2.5 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              disabled={loading}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">
              Phone Number <span className="text-red-400">*</span>
            </label>
            <input
              type="tel"
              className="w-full px-4 py-2.5 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              placeholder="+1 234 567 8900"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">Include country code (e.g., +1 for US)</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">
              Password <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              className="w-full px-4 py-2.5 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 mt-1">At least 6 characters with uppercase, lowercase, and number</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">
              Confirm Password <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              className="w-full px-4 py-2.5 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              placeholder="••••••••"
              disabled={loading}
            />
          </div>
          
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-purple-500/20"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-slate-800/50 text-gray-400">Or sign up with</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900/50 border border-purple-500/30 rounded-lg text-gray-300 hover:bg-slate-800/50 hover:border-purple-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span className="text-sm font-medium">Google</span>
            </button>
            
            <button
              type="button"
              onClick={handleGitHubSignup}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900/50 border border-purple-500/30 rounded-lg text-gray-300 hover:bg-slate-800/50 hover:border-purple-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd"/>
              </svg>
              <span className="text-sm font-medium">GitHub</span>
            </button>
          </div>
        </div>
        
        <p className="mt-6 text-sm text-gray-400 text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-purple-400 hover:text-purple-300 transition-colors font-medium">
            Login
          </Link>
        </p>
      </div>
      
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

