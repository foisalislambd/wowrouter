import type { ReactNode } from 'react';

/** The Vite build does not load the mock worker. Screens render directly. */
export function DevMocks({ children }: { children: ReactNode }) {
  return children;
}
