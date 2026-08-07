import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { SettingsProvider } from './contexts/SettingsContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

declare global {
  interface Window {
    electronAPI?: {
      getUserDataPath: () => Promise<string>
      dbWrite: (filename: string, data: Uint8Array) => Promise<boolean>
      dbRead: (filename: string) => Promise<Uint8Array | null>
      platform: string
    }
  }
}
const APP_VERSION = "1.0.0";

const saved = localStorage.getItem("app_version");

if (saved !== APP_VERSION) {
  console.log("[APP] New version detected — clearing cache");

  // clear everything
  localStorage.clear();
  indexedDB.deleteDatabase("transformer_offline_db");

  // unregister service worker
  navigator.serviceWorker?.getRegistrations?.().then((regs) => {
    regs.forEach((r) => r.unregister());
  });

  localStorage.setItem("app_version", APP_VERSION);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Prevent redundant refetching when switching tabs
      retry: 1, // Minimize retry attempts to speed up offline feedback
      staleTime: 1000 * 60 * 5, // Cache data for 5 minutes by default
      gcTime: 1000 * 60 * 30, // Keep inactive data in memory for 30 mins
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <App />
);
