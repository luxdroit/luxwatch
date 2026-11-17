import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

function IOSInstallGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-pwa-title"
    >
      <div className="w-full max-w-sm bg-[#111216] border border-[#67E8F9]/30 rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              id="ios-pwa-title"
              className="font-display text-lg font-semibold text-[#F8F8FA]"
            >
              Zainstaluj LuxWatch na iPhone / iPad
            </h3>
            <p className="text-xs text-[#A3A8B4] mt-0.5">
              Dodaj aplikację do ekranu głównego w Safari
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij instrukcję instalacji"
            className="p-1.5 text-[#A3A8B4] hover:text-[#F8F8FA] rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <ol className="space-y-3 text-sm text-[#E4E4EA]">
          <li className="flex items-start gap-2.5">
            <span className="w-6 h-6 rounded-full bg-[#67E8F9]/15 border border-[#67E8F9]/40 text-[#67E8F9] text-xs font-mono font-semibold flex items-center justify-center shrink-0">
              1
            </span>
            <span>
              Stuknij ikonę{' '}
              <span className="inline-flex items-center gap-1 font-semibold text-[#67E8F9]">
                <Share className="w-3.5 h-3.5" aria-hidden="true" />
                Udostępnij
              </span>{' '}
              na pasku przeglądarki Safari.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-6 h-6 rounded-full bg-[#67E8F9]/15 border border-[#67E8F9]/40 text-[#67E8F9] text-xs font-mono font-semibold flex items-center justify-center shrink-0">
              2
            </span>
            <span>
              Przewiń listę i wybierz{' '}
              <strong className="text-[#F8F8FA]">Do ekranu początkowego</strong>.
            </span>
          </li>
        </ol>

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] py-2.5 bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-sm font-semibold rounded-lg transition-colors cursor-pointer"
        >
          Rozumiem
        </button>
      </div>
    </div>
  );
}

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Pobierz jako aplikację"
        className="px-3 py-2 text-xs font-medium text-[#67E8F9] bg-[#0B151A] hover:bg-[#67E8F9]/15 border border-[#67E8F9]/40 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">Zainstaluj</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Zainstaluj aplikację na iOS"
          className="px-3 py-2 text-xs font-medium text-[#67E8F9] bg-[#0B151A] hover:bg-[#67E8F9]/15 border border-[#67E8F9]/40 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Aplikacja</span>
        </button>
        {showIOSGuide && (
          <IOSInstallGuideModal onClose={() => setShowIOSGuide(false)} />
        )}
      </>
    );
  }

  return null;
}

export function PWAInstallBanner({ hasBottomNav }: { hasBottomNav: boolean }) {
  const { isInstallable, isInstalled, isIOS, isDismissed, install, dismiss } =
    usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || isDismissed || (!isInstallable && !isIOS)) {
    return null;
  }

  return (
    <>
      <div
        role="region"
        aria-label="Instalacja aplikacji LuxWatch"
        className={`fixed left-3 right-3 sm:left-auto sm:right-5 sm:w-96 z-40 bg-[#111216]/95 backdrop-blur-md border border-[#67E8F9]/40 rounded-xl p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.65)] flex items-center gap-3 ${
          hasBottomNav ? 'bottom-20 md:bottom-5' : 'bottom-4'
        }`}
      >
        <div className="w-10 h-10 rounded-lg bg-[#0B151A] border border-[#67E8F9]/30 flex items-center justify-center shrink-0">
          <Smartphone className="w-5 h-5 text-[#67E8F9]" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#F8F8FA] truncate">
            Zainstaluj LuxWatch na urządzeniu
          </p>
          <p className="text-[11px] text-[#A3A8B4] truncate">
            Szybki dostęp jak w aplikacji mobilnej
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (isInstallable) {
              void install();
            } else {
              setShowIOSGuide(true);
            }
          }}
          className="px-3 py-2 min-h-[36px] bg-[#67E8F9] hover:bg-[#A5F3FC] text-[#070B10] text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          Pobierz
        </button>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Zamknij propozycję instalacji"
          className="p-1.5 text-[#A3A8B4] hover:text-[#F8F8FA] rounded-lg shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {showIOSGuide && (
        <IOSInstallGuideModal onClose={() => setShowIOSGuide(false)} />
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed top-16 right-4 z-50 flex items-center gap-2 rounded-lg bg-[#0B151A] border border-[#67E8F9]/50 px-3 py-1.5 text-xs font-medium text-[#CFFAFE] shadow-lg"
    >
      <span className="h-2 w-2 rounded-full bg-[#67E8F9] animate-pulse" />
      <span>Tryb offline — brak połączenia z siecią</span>
    </div>
  );
}
