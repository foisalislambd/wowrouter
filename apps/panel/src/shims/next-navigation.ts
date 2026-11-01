import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from 'react-router-dom';

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const [params] = useRouterSearchParams();
  return params;
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push(href: string) {
      void navigate(href);
    },
    replace(href: string, _options?: { scroll?: boolean }) {
      void navigate(href, { replace: true });
    },
    back() {
      void navigate(-1);
    },
    refresh() {},
  };
}
