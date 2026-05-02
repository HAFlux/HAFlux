import { type FC, useState, useEffect, useCallback } from 'react';
import { SunFilledIcon, MoonFilledIcon } from '@/components/icons';

export interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const initial = saved ?? prefers;
    setTheme(initial);
    root.classList.toggle('dark', initial === 'dark');
    setIsMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  if (!isMounted) return <div className="h-6 w-6" />;

  return (
    <button
      aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      className={`px-px transition-opacity hover:opacity-80 cursor-pointer bg-transparent border-none ${className ?? ''}`}
      onClick={toggle}
      type="button"
    >
      {theme === 'light' ? <MoonFilledIcon size={20} /> : <SunFilledIcon size={20} />}
    </button>
  );
};
