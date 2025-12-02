interface ToastProps {
  message: string;
  type: 'success' | 'error';
}

export default function Toast({ message, type }: ToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 animate-fade-in">
      <div
        className={`px-4 py-3 rounded-lg shadow-2xl backdrop-blur-xl border ${
          type === 'success' 
            ? 'bg-green-500/20 border-green-400/30 text-green-300' 
            : 'bg-red-500/20 border-red-400/30 text-red-300'
        }`}
      >
        {message}
      </div>
    </div>
  );
}

