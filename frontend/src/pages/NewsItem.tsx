import React from 'react';

interface NewsItemProps {
  article: {
    title: string;
    summary?: string;
    description?: string;
    source: string;
    published_at: string;
    url: string;
    sentiment?: 'positive' | 'negative' | 'neutral';
  };
  className?: string;
}

const NewsItem: React.FC<NewsItemProps> = ({
  article,
  className = ""
}) => {
  return (
    <div
      key={article.url}
      onClick={() => window.open(article.url, '_blank')}
      className={`border-b border-slate-600/30 pb-3 last:border-b-0 cursor-pointer group ${className}`}
    >
      <div className="flex items-start gap-4">
        {/* Sentiment Badge */}
        <div className="flex-shrink-0 mt-1">
          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${article.sentiment === 'positive' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
            article.sentiment === 'negative' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
              'bg-slate-500/20 text-slate-400 border border-slate-500/30'
            }`}>
            {article.sentiment === 'positive' ? 'Bullish' :
              article.sentiment === 'negative' ? 'Bearish' : 'Neutral'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h4 className="text-white font-medium text-sm leading-tight mb-2 group-hover:text-blue-300 transition-colors">
                {article.title}
              </h4>
              <p className="text-slate-400 text-xs leading-relaxed mb-3 line-clamp-2">
                {article.summary || article.description}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <span>{article.source}</span>
              {article.published_at && (
                <>
                  <span>•</span>
                  <span>{new Date(article.published_at).toLocaleDateString()}</span>
                </>
              )}
            </span>
            <svg className="w-3 h-3 text-slate-500 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewsItem;
