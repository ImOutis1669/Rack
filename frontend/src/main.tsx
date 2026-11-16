import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, UnauthorizedError } from "./api/client";
import { PerfHud } from "./components/PerfHud";
import { Toaster } from "./components/Toast";
import "./index.css";
import { perfEnabled } from "./lib/perf";
import { installViewportFix } from "./lib/viewport";
import { Feed } from "./pages/Feed";
import { Hunts } from "./pages/Hunts";
import { Login } from "./pages/Login";
import { Saved } from "./pages/Saved";
import { Settings } from "./pages/Settings";
import { Taste } from "./pages/Taste";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (count, err) => !(err instanceof UnauthorizedError) && count < 2,
    },
  },
});

function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (me.isPending) return <div className="min-h-dvh bg-background" />;
  if (me.isError) {
    return <Login onSuccess={() => void qc.invalidateQueries()} />;
  }
  const onLogout = async () => {
    await api.logout();
    qc.clear();
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/taste" element={<Taste />} />
        <Route path="/saved" element={<Saved />} />
        <Route path="/hunts" element={<Hunts />} />
        <Route path="/settings" element={<Settings onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
      {SHOW_PERF && <PerfHud />}
    </>
  );
}

const SHOW_PERF = perfEnabled(window.location.search, (() => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
})());

installViewportFix();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
