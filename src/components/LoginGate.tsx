import { useState } from 'react';
import type { FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../api/client';
import type { UserAccount } from '../types';

interface LoginGateProps {
  onSuccess: (user: UserAccount) => void;
}

export function LoginGate({ onSuccess }: LoginGateProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Wprowadź nazwę użytkownika oraz hasło.');
      return;
    }

    setLoading(true);
    try {
      const { user } = await api.login(username.trim(), password);
      onSuccess(user);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Nie udało się zalogować.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#09090B] text-[#F8F8FA] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md bg-[#111216] border border-white/10 rounded-xl p-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <span className="font-display text-2xl font-bold tracking-tight text-[#F8F8FA]">
              Lux<span className="text-[#67E8F9]">Watch</span>
            </span>
            <Lock className="w-5 h-5 text-[#67E8F9]" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#F8F8FA] mb-2">
            Prywatny dostęp
          </h1>
          <p className="text-sm text-[#A3A8B4] leading-relaxed">
            Dostęp do katalogu oraz odtwarzacza wymaga uwierzytelnienia
            kontem utworzonym przez administratora.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label
              htmlFor="login-username"
              className="block text-sm font-medium text-[#E4E4EA] mb-2"
            >
              Nazwa użytkownika
            </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/15 rounded-lg text-[#F8F8FA] placeholder-[#525663] focus:outline-none focus:border-[#67E8F9] transition-colors"
              placeholder="Wpisz swój nick"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-[#E4E4EA] mb-2"
            >
              Hasło
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/15 rounded-lg text-[#F8F8FA] placeholder-[#525663] focus:outline-none focus:border-[#67E8F9] transition-colors"
              placeholder="Wpisz hasło"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-sm text-red-200"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-[#67E8F9] hover:bg-[#A5F3FC] disabled:opacity-60 text-[#070B10] font-semibold text-sm rounded-lg transition-colors cursor-pointer"
          >
            {loading ? 'Logowanie...' : 'Zaloguj się'}
          </button>
        </form>
      </div>
    </main>
  );
}
