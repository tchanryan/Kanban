import { useEffect } from 'react';

export interface ViewReadiness {
  name: string;
  key: string;
  ready: boolean;
  itemCount: number;
}

/** Record local post-paint readiness without a network or native control channel. */
export function useViewReadiness({
  name,
  key,
  ready,
  itemCount,
}: ViewReadiness): void {
  useEffect(() => {
    if (!ready) return;
    let paintFrame: number | undefined;
    const layoutFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => {
        performance.clearMarks(name);
        performance.mark(name, { detail: { key, itemCount } });
      });
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      if (paintFrame !== undefined) cancelAnimationFrame(paintFrame);
    };
  }, [name, key, ready, itemCount]);
}
