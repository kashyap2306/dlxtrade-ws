interface HeaderProps {
  title?: string;
  subtitle?: string;
  onMenuToggle?: () => void;
  menuOpen?: boolean;
  children?: React.ReactNode;
}

export default function Header({ title, subtitle, onMenuToggle, menuOpen, children }: HeaderProps) {

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1">
            {/* Mobile Menu Button - Crypto Style */}
            {onMenuToggle && (
              <button
                onClick={onMenuToggle}
                className="p-2.5 bg-slate-800/80 backdrop-blur-xl border border-cyan-500/30 rounded-xl text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-400/50 transition-all duration-300 shadow-lg shadow-cyan-500/10 hover:shadow-cyan-500/20"
                aria-label="Toggle menu"
              >
                <div className="relative w-6 h-6">
                  <span
                    className={`absolute top-0 left-0 w-full h-0.5 bg-cyan-400 rounded-full transition-all duration-300 ease-out ${
                      menuOpen ? 'rotate-45 top-2.5' : ''
                    }`}
                  />
                  <span
                    className={`absolute top-2.5 left-0 w-full h-0.5 bg-cyan-400 rounded-full transition-all duration-300 ease-out ${
                      menuOpen ? 'opacity-0 scale-0' : 'opacity-100 scale-100'
                    }`}
                  />
                  <span
                    className={`absolute top-5 left-0 w-full h-0.5 bg-cyan-400 rounded-full transition-all duration-300 ease-out ${
                      menuOpen ? '-rotate-45 top-2.5' : ''
                    }`}
                  />
                </div>
              </button>
            )}
            
            {/* Title Section */}
            {(title || subtitle) && (
              <div className="flex-1">
                {title && (
                  <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p className="text-gray-300 text-sm sm:text-base">{subtitle}</p>
                )}
              </div>
            )}
          </div>
          
          {/* Right side content */}
          {children && <div className="flex-shrink-0">{children}</div>}
        </div>
      </div>

      {/* Desktop Title Section */}
      {(title || subtitle) && (
        <div className="hidden lg:block mb-6 lg:mb-8">
          {title && (
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-gray-300 text-sm sm:text-base">{subtitle}</p>
          )}
        </div>
      )}
    </>
  );
}

