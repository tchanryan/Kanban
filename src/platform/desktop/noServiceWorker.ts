export function useRegisterSW() {
  return {
    needRefresh: [false] as const,
    updateServiceWorker: async () => undefined,
  };
}
