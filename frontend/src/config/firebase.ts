import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAiImG-UYlHy79ayanN-GX42o--CO_q43M',
  authDomain: 'dlx-trading.firebaseapp.com',
  projectId: 'dlx-trading',
  storageBucket: 'dlx-trading.firebasestorage.app',
  messagingSenderId: '561570439242',
  appId: '1:561570439242:web:ab2153be757828ec1f46b3',
  measurementId: 'G-WDVHXT9N5T',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Analytics (only in browser)
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

// Initialize Firestore
export const db = getFirestore(app);

export default app;

