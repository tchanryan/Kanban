import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/app.css';
import { ConfirmationHost } from './services/confirm';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ConfirmationHost />
  </StrictMode>,
);
