import { useSyncExternalStore } from 'react';

const TOKEN_KEY = 'hapilot:access-token';

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  emit();
}

export function useAuth() {
  const token = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return {
    token,
    logout: () => setToken(null),
  };
}
