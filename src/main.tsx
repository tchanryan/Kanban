import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/app.css';
import { ConfirmationHost } from './services/confirm';
import { services, servicesReady } from './app/services';
import { NativeRecovery } from './features/NativeRecovery';
void servicesReady
  .then(async () => {
    const recovery = services.platform.recovery;
    const available = await recovery?.isAvailable();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        {recovery && available === false ? (
          <main className="settings-page">
            <NativeRecovery service={recovery} />
          </main>
        ) : (
          <App />
        )}
        <ConfirmationHost />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    const root = document.getElementById('root')!;
    root.textContent =
      error instanceof Error
        ? error.message
        : 'Could not start storage. Existing data has been retained.';
    root.setAttribute('role', 'alert');
  });
