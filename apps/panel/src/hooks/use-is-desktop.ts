import { useSyncExternalStore } from "react";

export const DESKTOP_BREAKPOINT = 1024;

function getMediaQuery() {
  return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
}

function subscribeDesktop(onStoreChange: () => void) {
  const media = getMediaQuery();
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

export function useIsDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => getMediaQuery().matches, () => false);
}
