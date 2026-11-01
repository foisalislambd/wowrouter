import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

/** Stand-in for next/link so the console screens can run under Vite. */
export default function Link({
  href,
  replace,
  children,
  prefetch: _prefetch,
  scroll: _scroll,
  ...rest
}: {
  href: string;
  replace?: boolean;
  children?: ReactNode;
  prefetch?: boolean;
  scroll?: boolean;
  className?: string;
  title?: string;
  target?: string;
  rel?: string;
  onClick?: () => void;
  'aria-current'?: 'page' | 'true' | 'false' | boolean;
}) {
  return (
    <RouterLink to={href} replace={replace} {...rest}>
      {children}
    </RouterLink>
  );
}
