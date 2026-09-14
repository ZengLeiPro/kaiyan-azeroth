import './styles/globals.css';

import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { AppErrorBoundary } from './components/patterns/app-error-boundary';
import { queryClient } from './lib/query-client';
import { initializeTheme } from './stores/theme';

// 初始化主题（在应用渲染之前）
initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
