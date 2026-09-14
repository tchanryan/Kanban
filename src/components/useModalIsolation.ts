import { useEffect, type RefObject } from 'react';
// Inert every sibling on the path to body; both pointer and assistive technology
// navigation stay inside a modal inspector. Restore previous state on close.
export function useModalIsolation(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const changed = new Map<HTMLElement, boolean>();
    let branch: HTMLElement | null = ref.current;
    while (branch?.parentElement && branch !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          changed.set(sibling, sibling.inert);
          sibling.setAttribute('inert', '');
        }
      }
      branch = branch.parentElement;
    }
    return () => {
      changed.forEach((wasInert, element) => {
        element.toggleAttribute('inert', wasInert);
      });
    };
  }, [ref, active]);
}
