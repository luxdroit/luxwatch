import {
  LayoutGrid,
  PlayCircle,
  SlidersHorizontal,
  User,
} from 'lucide-react';
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

  const navItems: Array<{
    id: AppView;
    label: string;
    mobileLabel: string;
    icon: typeof LayoutGrid;
  }> = [
    {
      id: 'catalog',
      label: 'Katalog',
      mobileLabel: 'Katalog',
      icon: LayoutGrid,
    },
    {
      id: 'continue',
      label: 'Kontynuuj',
      mobileLabel: 'Kontynuuj',
      icon: PlayCircle,
    },
    {
      id: 'profile',
      label: 'Profil',
      mobileLabel: 'Profil',
      icon: User,
    },
  ];

  if (isStaff) {
    navItems.push({
      id: 'management',
      label: 'Zarządzanie',
      mobileLabel: 'Panel',
      icon: SlidersHorizontal,
    });
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-[#09090B]/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('catalog')}
            className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#F8F8FA] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67E8F9] rounded"
          >
            Lux<span className="text-[#67E8F9]">Watch</span>
          </button>

          {/* Zone 2: Clean Typography Navigation Links (Desktop / Tablet) */}
          <nav
            aria-label="Nawigacja główna"
            className="hidden md:flex items-center gap-7"
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
              className="px-3.5 sm:px-4 py-2 text-xs font-semibold text-[#070B10] bg-[#67E8F9] hover:bg-[#A5F3FC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Wyloguj
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Icon Navigation Bar */}
      <nav
        aria-label="Nawigacja mobilna"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#09090B]/95 backdrop-blur-md border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
      >
        <div
          className={`grid h-16 ${isStaff ? 'grid-cols-4' : 'grid-cols-3'} items-stretch`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeView === item.id ||
              (item.id === 'catalog' &&
                (activeView === 'anime' || activeView === 'player'));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-1 min-h-[48px] transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[#67E8F9]'
                    : 'text-[#A3A8B4] hover:text-[#F8F8FA]'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 w-7 h-0.5 rounded-full bg-[#67E8F9]"
                  />
                )}
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="text-[11px] font-medium leading-none tracking-tight">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
