import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';

import { Logo } from '@/components/icons';
import { TerminalTypewriter } from '@/components/terminal-typewriter';
import { ThemeSwitch } from '@/components/theme-switch';
import { ApiError, api } from '@/lib/api';
import { setToken, useAuth } from '@/lib/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const { token } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.auth.login({ email, password }),
    onSuccess: (data) => {
      setToken(data.accessToken);
      navigate(next ?? '/dashboard', { replace: true });
    },
  });

  if (token) return <Navigate replace to={next ?? '/dashboard'} />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--color-fg)' }}>
            <Logo size={26} />
          </span>
          <span className="cyber-heading text-base">HAFlux</span>
        </div>
        <ThemeSwitch />
      </header>

      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex flex-col gap-3 text-center">
            <span className="cyber-label inline-block min-h-[1.25em]">
              <TerminalTypewriter text="Multi-haproxy control plane" charDelayMs={18} />
            </span>
            <h1 className="cyber-heading inline-block min-h-[1.2em] text-3xl">
              <TerminalTypewriter text="Sign in" startDelayMs={380} charDelayMs={55} />
            </h1>
            <p className="min-h-[3rem] text-sm" style={{ color: 'var(--color-muted)' }}>
              <TerminalTypewriter
                text="Use the bootstrap credentials. Defaults are printed in the api container logs on first start."
                startDelayMs={820}
                charDelayMs={10}
              />
            </p>
          </div>

          <div className="cyber-card p-6">
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <label className="flex flex-col gap-1.5">
                <span className="cyber-label">Email</span>
                <input
                  className="cyber-input"
                  autoComplete="email"
                  placeholder="admin@haflux.local"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="cyber-label">Password</span>
                <input
                  className="cyber-input"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              {mutation.isError && (
                <p className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
                  ! {mutation.error instanceof ApiError ? mutation.error.message : 'Sign-in failed'}
                </p>
              )}

              <button
                type="submit"
                className="cyber-btn"
                disabled={mutation.isPending}
                aria-disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Signing in…' : 'Continue ▸'}
              </button>
            </form>
          </div>

          <div className="text-center">
            <span className="cyber-label">[ HAFlux · v0.0.1 ]</span>
          </div>
        </div>
      </div>
    </div>
  );
}
