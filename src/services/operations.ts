/** Runs a UI operation through the shell's shared error and notice handling. */
export type Run = (operation: () => Promise<unknown>, message?: string) => void;
