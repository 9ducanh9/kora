'use client';

import { useState, useEffect, useCallback } from 'react';
import { ThemeMode, ResolvedTheme } from './types';

const THEME_STORAGE_KEY = 'kora:theme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');
  const [isMounted, setIsMounted] = useState(false);

  // 1. Initialize from localStorage on client mount
  useEffect(() => {
    setIsMounted(true);
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
      if (stored && (stored === 'system' || stored === 'light' || stored === 'dark')) {
        setThemeState(stored);
        const resolved = stored === 'system' ? getSystemTheme() : stored;
        setResolvedTheme(resolved);
        document.documentElement.setAttribute('data-theme', resolved);
      } else {
        const sys = getSystemTheme();
        setResolvedTheme(sys);
        document.documentElement.setAttribute('data-theme', sys);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // 2. React to theme or system preference changes
  useEffect(() => {
    if (!isMounted) return;

    const updateTheme = () => {
      const activeResolved = theme === 'system' ? getSystemTheme() : theme;
      setResolvedTheme(activeResolved);
      document.documentElement.setAttribute('data-theme', activeResolved);
    };

    updateTheme();

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => updateTheme();
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
  }, [theme, isMounted]);

  // 3. User setter with persistence
  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // Ignore localStorage errors
    }
    const resolved = newTheme === 'system' ? getSystemTheme() : newTheme;
    setResolvedTheme(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme
  };
}
