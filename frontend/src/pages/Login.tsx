import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';
import { wsService } from '../services/ws';
import { usersApi } from '../services/api';
import { sendPasswordResetEmail } from 'firebase/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      localStorage.setItem('firebaseToken', token);
      localStorage.setItem('firebaseUser', JSON.stringify({
        uid: userCredential.user.uid,
        email: userCredential.user.email,
      }));
      
      // Call backend afterSignIn endpoint to ensure user document exists (idempotent)
      try {
        const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
        const authResponse = await fetch(`${baseURL}/api/auth/afterSignIn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            idToken: token,
          }),
        });
        
        if (!authResponse.ok) {
          const errorData = await authResponse.json();
          console.error('❌ Error in afterSignIn:', errorData);
          throw new Error(errorData.error || 'Failed to complete sign-in');
        }
        
        const authData = await authResponse.json();
        console.log('✅ User onboarding completed:', authData);
        console.log('✅ Created new user:', authData.createdNew);
        console.log('✅ User logged in successfully:', userCredential.user.uid);
      } catch (err: any) {
        console.error('❌ Error completing sign-in:', err);
        console.error('Error details:', err.message);
        // Don't block login if this fails - user is already authenticated
        // But log it so we know about the issue
      }
      
      wsService.connect();
      navigate('/');
    } catch (err: any) {
      let errorMessage = 'Login failed';
      if (err.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      } else if (err.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    try {
      if (!email) {
        setError('Enter your email to reset password');
        return;
      }
      await sendPasswordResetEmail(auth, email);
      setError('Password reset email sent');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>
      
      <div className="relative bg-slate-800/50 backdrop-blur-xl border border-purple-500/20 rounded-2xl shadow-2xl max-w-md w-full p-8 mx-4">
        <h1 className="text-3xl font-bold text-center mb-6 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">DLXTRADE</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/20 border border-red-400/30 text-red-300 px-4 py-3 rounded-lg backdrop-blur-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Email</label>
            <input
              type="email"
              className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Password</label>
            <input
              type="password"
              className="w-full px-4 py-2 bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
          <button
            type="button"
            onClick={handleForgotPassword}
            className="w-full mt-2 px-4 py-2 text-sm text-purple-300 hover:text-white transition-colors"
          >
            Forgot Password?
          </button>
        </form>
        <p className="mt-4 text-sm text-gray-400 text-center">
          Don't have an account?{' '}
          <Link to="/signup" className="text-purple-400 hover:text-purple-300 transition-colors">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}

