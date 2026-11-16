import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { SessionProvider } from './app/session';
import { AiProvider } from './shared/aiContext';
import { ConfirmProvider, ToastProvider } from './shared/ui';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <SessionProvider>
            <AiProvider>
              <App />
            </AiProvider>
          </SessionProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
