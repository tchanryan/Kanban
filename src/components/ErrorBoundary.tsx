import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Unable to open Kanban Calendar</h1>
        <p>
          Your local database has not been cleared. Reload to retry. If the
          problem persists, retain browser site data for recovery.
        </p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
