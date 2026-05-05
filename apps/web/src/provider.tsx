import { ToastProvider } from '@/components/toast';

export function Provider({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
