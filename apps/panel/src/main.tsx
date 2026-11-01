/**
 * Modified by WowRouter.
 * The screens, styles, and components under src/ are derived from Antirion
 * (https://github.com/eliasbiondo/antirion), Copyright 2026 Elias Biondo, Apache-2.0.
 * The brand mark and product name are WowRouter's.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '@/styles/globals.css';
import { App } from '@/App';

document.documentElement.style.setProperty('--font-hanken', '"Hanken Grotesk Variable", sans-serif');
document.documentElement.style.setProperty('--font-jetbrains', '"JetBrains Mono Variable", ui-monospace, monospace');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
