import { useState } from 'react';
import { Film } from 'lucide-react';
import { appendMediaAuth } from '../api/client';

interface CoverImageProps {
  src: string;
  alt: string;
  title: string;
  className?: string;
}

export function CoverImage({
  src,
  alt,
  title,
  className = 'w-full h-full object-cover',
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = appendMediaAuth(src);

  if (!resolvedSrc || failed) {
    return (
      <div
        className="w-full h-full bg-gradient-to-br from-[#1A1C23] via-[#111216] to-[#09090B] flex flex-col items-center justify-center p-4 text-center border border-white/10"
        aria-label={alt}
      >
        <Film className="w-8 h-8 text-[#67E8F9]/70 mb-2" aria-hidden="true" />
        <span className="text-xs font-medium text-[#A3A8B4] line-clamp-3">
          {title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
