import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { SidebarNav } from '@/components/sidebar-nav';
import { siteConfig } from '@/config/site';

export default function DefaultLayout() {
  const { t } = useTranslation();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className="hpm-shell bg-background text-foreground flex h-screen min-h-0">
      <div className="hidden h-screen shrink-0 md:block">
        <SidebarNav />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="flex shrink-0 items-center justify-between border-b px-4 py-3 md:hidden"
          style={{ borderColor: 'var(--color-separator)' }}
        >
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost px-2 py-1 font-mono text-lg leading-none"
            onClick={() => setDrawer(true)}
            aria-expanded={drawer}
            aria-controls="hpm-mobile-nav"
            aria-label={t('nav.openMenu')}
          >
            ≡
          </button>
          <span className="cyber-heading text-sm">{siteConfig.name}</span>
          <span className="w-8 shrink-0" aria-hidden />
        </header>
        <main className="hpm-content min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
      {drawer ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default border-0 bg-black/50 md:hidden"
            aria-label={t('actions.close')}
            onClick={() => setDrawer(false)}
          />
          <div
            id="hpm-mobile-nav"
            className="hpm-mobile-drawer fixed top-0 left-0 z-50 h-full max-h-[100dvh] overflow-y-auto md:hidden"
            style={{ width: 'min(16rem, 100vw)' }}
          >
            <SidebarNav onNavigate={() => setDrawer(false)} />
          </div>
        </>
      ) : null}
    </div>
  );
}
