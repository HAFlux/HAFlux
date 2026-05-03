import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { GithubIcon, Logo } from '@/components/icons';
import { LangSwitch } from '@/components/lang-switch';
import { ThemeSwitch } from '@/components/theme-switch';
import { siteConfig } from '@/config/site';
import { useAuth } from '@/lib/auth';
import pkg from '../../package.json';

const NAV_KEYS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/proxy-hosts': 'nav.proxyHosts',
  '/clusters': 'nav.clusters',
  '/certificates': 'nav.certificates',
  '/error-pages': 'nav.errorPages',
  '/access-groups': 'nav.accessGroups',
  '/backup': 'nav.backup',
  '/help': 'nav.help',
  '/profile': 'nav.profile',
};

export const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => {
  const { logout } = useAuth();
  const { t } = useTranslation();

  return (
    <aside
      className="hpm-sidebar flex h-screen w-60 flex-col"
      style={{ borderRight: '1px solid var(--color-separator)' }}
    >
      <div className="flex items-center gap-2 px-5 py-4">
        <span style={{ color: 'var(--color-fg)' }}>
          <Logo size={26} />
        </span>
        <span className="cyber-heading text-base">{siteConfig.name}</span>
      </div>
      <div className="cyber-divider" />

      <div className="px-5 py-3">
        <span className="cyber-label">{t('nav.navigation')}</span>
      </div>

      <nav className="flex flex-col gap-px px-2">
        {siteConfig.navItems.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            onClick={() => onNavigate?.()}
            className={({ isActive }) =>
              clsx(
                'cyber-mono px-3 py-2 text-sm transition-[color,background-color,transform] duration-300 ease-out',
                'flex items-center gap-2',
                isActive
                  ? 'bg-[var(--color-fg)] text-[var(--color-bg)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]',
              )
            }
            style={{ borderRadius: 2 }}
          >
            {({ isActive }) => (
              <>
                <span style={{ opacity: isActive ? 1 : 0.4 }}>{isActive ? '▸' : '·'}</span>
                <span>{NAV_KEYS[item.href] ? t(NAV_KEYS[item.href]) : item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div
        className="mt-auto flex flex-col gap-3 px-4 py-4"
        style={{ borderTop: '1px solid var(--color-separator)' }}
      >
        <div className="flex items-center justify-between">
          <span className="cyber-label">v{pkg.version}</span>
          <div className="flex items-center gap-3">
            <a
              aria-label="GitHub"
              href={siteConfig.links.github}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-muted)' }}
              className="transition-colors duration-300 ease-out hover:text-[var(--color-fg)]"
            >
              <GithubIcon size={16} />
            </a>
            <ThemeSwitch />
          </div>
        </div>
        <LangSwitch />
        <button type="button" className="cyber-btn cyber-btn-ghost" onClick={logout}>
          [ {t('actions.signOut')} ]
        </button>
      </div>
    </aside>
  );
};
