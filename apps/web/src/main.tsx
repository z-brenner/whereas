import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError } from './api';
import { Layout } from './Layout';
import { Login, Setup } from './pages/Auth';
import { RequestPage } from './pages/RequestPage';
import { Requests } from './pages/Requests';
import { Settings } from './pages/Settings';
import { TemplateBuilder } from './pages/TemplateBuilder';
import { Templates } from './pages/Templates';
import './styles.css';
import { ToastProvider } from './ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<Setup />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Navigate to="/requests" replace />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/requests/:id" element={<RequestPage />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/templates/:id" element={<TemplateBuilder />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/requests" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
