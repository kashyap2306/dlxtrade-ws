import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { doc, setDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { adminApi } from '../services/api';
import Toast from '../components/Toast';
import AdminLayout from '../components/AdminLayout';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

interface Benefit {
  id: string;
  text: string;
}

export default function AdminBroadcastPopup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  const [title, setTitle] = useState('');
  const [benefits, setBenefits] = useState<Benefit[]>([
    { id: '1', text: '' },
    { id: '2', text: '' },
    { id: '3', text: '' },
    { id: '4', text: '' },
    { id: '5', text: '' },
    { id: '6', text: '' },
  ]);
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [oldPrice, setOldPrice] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [actualCost, setActualCost] = useState('');
  const [usersPurchased, setUsersPurchased] = useState('');
  const [countdownHours, setCountdownHours] = useState('');
  const [countdownMinutes, setCountdownMinutes] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const updateBenefit = (id: string, text: string) => {
    setBenefits(prev => prev.map(b => b.id === id ? { ...b, text } : b));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      showToast('Please enter a title', 'error');
      return;
    }
    
    if (!newPrice.trim() || !actualCost.trim()) {
      showToast('Please enter new price and actual cost', 'error');
      return;
    }

    setLoading(true);
    try {
      let imageUrl = '';
      
      // Upload image if provided
      if (imageFile) {
        const storage = getStorage();
        const imageRef = ref(storage, `popups/${Date.now()}_${imageFile.name}`);
        await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(imageRef);
      }

      // Calculate countdown end time
      const hours = parseInt(countdownHours) || 0;
      const minutes = parseInt(countdownMinutes) || 0;
      const countdownEndTime = Date.now() + (hours * 60 + minutes) * 60 * 1000;

      const popupData = {
        title: title.trim(),
        benefits: benefits.filter(b => b.text.trim()).map(b => b.text.trim()),
        description: description.trim(),
        imageUrl,
        oldPrice: oldPrice.trim(),
        newPrice: newPrice.trim(),
        actualCost: parseFloat(actualCost),
        usersPurchased: parseInt(usersPurchased) || 0,
        countdownEndTime,
        createdAt: Date.now(),
        createdBy: user?.uid || 'admin',
        active: true,
      };

      // Save to Firestore globalPopup collection
      const popupRef = doc(collection(db, 'globalPopup'), 'current');
      await setDoc(popupRef, popupData);

      // Also send to backend API
      try {
        await adminApi.broadcastPopup(popupData);
      } catch (apiErr) {
        console.warn('Backend API call failed, but popup saved to Firestore:', apiErr);
      }

      showToast('Popup broadcasted successfully!', 'success');
      
      // Reset form
      setTimeout(() => {
        setTitle('');
        setBenefits([
          { id: '1', text: '' },
          { id: '2', text: '' },
          { id: '3', text: '' },
          { id: '4', text: '' },
          { id: '5', text: '' },
          { id: '6', text: '' },
        ]);
        setDescription('');
        setImageFile(null);
        setImagePreview(null);
        setOldPrice('');
        setNewPrice('');
        setActualCost('');
        setUsersPurchased('');
        setCountdownHours('');
        setCountdownMinutes('');
      }, 1500);
    } catch (error: any) {
      console.error('Error broadcasting popup:', error);
      showToast(error.message || 'Failed to broadcast popup', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="min-h-screen relative z-10">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
              Broadcast Popup
            </h1>
            <p className="text-gray-400">Create and broadcast a popup to all active users</p>
          </div>

          <form onSubmit={handleSubmit} className="card space-y-6">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                placeholder="Enter popup title"
                required
              />
            </div>

            {/* Benefits */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Benefits (up to 6 items)
              </label>
              <div className="space-y-2">
                {benefits.map((benefit) => (
                  <div key={benefit.id} className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <input
                      type="text"
                      value={benefit.text}
                      onChange={(e) => updateBenefit(benefit.id, e.target.value)}
                      className="input flex-1"
                      placeholder={`Benefit ${benefit.id}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input min-h-32 resize-none"
                placeholder="Enter description (supports markdown)"
                rows={6}
              />
            </div>

            {/* Image Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Main Image
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="input"
              />
              {imagePreview && (
                <div className="mt-4 rounded-lg overflow-hidden border border-purple-500/30">
                  <img src={imagePreview} alt="Preview" className="w-full h-64 object-cover" />
                </div>
              )}
            </div>

            {/* Pricing Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Old Price (strikethrough)
                </label>
                <input
                  type="text"
                  value={oldPrice}
                  onChange={(e) => setOldPrice(e.target.value)}
                  className="input"
                  placeholder="e.g., $900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  New Price (highlighted) *
                </label>
                <input
                  type="text"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="input"
                  placeholder="e.g., $299"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Actual Cost *
                </label>
                <input
                  type="number"
                  value={actualCost}
                  onChange={(e) => setActualCost(e.target.value)}
                  className="input"
                  placeholder="299"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Users Purchased
                </label>
                <input
                  type="number"
                  value={usersPurchased}
                  onChange={(e) => setUsersPurchased(e.target.value)}
                  className="input"
                  placeholder="200"
                />
              </div>
            </div>

            {/* Countdown Timer */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Countdown Timer
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Hours</label>
                  <input
                    type="number"
                    value={countdownHours}
                    onChange={(e) => setCountdownHours(e.target.value)}
                    className="input"
                    placeholder="0"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Minutes</label>
                  <input
                    type="number"
                    value={countdownMinutes}
                    onChange={(e) => setCountdownMinutes(e.target.value)}
                    className="input"
                    placeholder="0"
                    min="0"
                    max="59"
                  />
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary flex-1"
              >
                {loading ? 'Broadcasting...' : 'Broadcast Popup'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </AdminLayout>
  );
}

