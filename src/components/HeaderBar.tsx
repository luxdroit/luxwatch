import type { UserAccount } from '../types';
import { canManageContent } from '../utils/rbacLogic';

export type AppView =
  | 'catalog'
  | 'continue'
  | 'profile'
  | 'management'
  | 'anime'
  | 'player';

interface HeaderBarProps {
  user: UserAccount;
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

export function HeaderBar({
  user,
  activeView,
  onNavigate,
  onLogout,
}: HeaderBarProps) {
  const isStaff = canManageContent(user.role);

  const navItems: Array<{ id: AppView; label: string }> = [
    { id: 'catalog', label: 'Katalog' },
    { id: 'continue', label: 'Kontynuuj' },
    { id: 'profile', label: 'Profil' },
  ];

  if (isStaff) {
    navItems.push({ id: 'management', label: 'Zarządzanie' });
  }

  return (
    <header className="sticky top-0 z-40 bg-[#09090B]/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('catalog')}
          className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#F8F8FA] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67E8F9] rounded"
        >
          Lux<span className="text-[#67E8F9]">Watch</span>
        </button>

        {/* Zone 2: Clean Typography Navigation Links */}
        <nav
          aria-label="Nawigacja główna"
          className="flex items-center gap-3.5 sm:gap-7 overflow-x-auto"
        >
          {navItems.map((item) => {
            const isActive =
              activeView === item.id ||
              (item.id === 'catalog' &&
                (activeView === 'anime' || activeView === 'player'));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#F8F8FA] border-[#67E8F9]'
                    : 'text-[#A3A8B4] border-transparent hover:text-[#F8F8FA]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 text-xs font-semibold text-[#070B10] bg-[#67E8F9] hover:bg-[#A5F3FC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Wyloguj
          </button>
        </div>
      </div>
    </header>
  );
}
