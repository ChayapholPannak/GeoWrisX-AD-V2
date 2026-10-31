import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { thTH } from '@clerk/localizations';
import App from './App.jsx';
import SetupNotice from './components/SetupNotice.jsx';
import { isClerkConfigured, publishableKey } from './lib/clerk.js';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isClerkConfigured ? (
      <ClerkProvider
        publishableKey={publishableKey}
        localization={thTH}
        afterSignOutUrl="/"
      >
        <App />
      </ClerkProvider>
    ) : (
      <SetupNotice />
    )}
  </React.StrictMode>,
);
