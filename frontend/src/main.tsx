import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { LazyMotion } from "motion/react";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, UnauthorizedError } from "./api/client";
import { PerfHud } from "./components/PerfHud";
import { Toaster } from "./components/Toast";
import "./index.css";
import { perfEnabled } from "./lib/perf";
import { installViewportFix } from "./lib/viewport";
import { Feed } from "./pages/Feed";

// The feed is the home screen and loads with the app; other pages load when first opened.
const Hunts = lazy(() => import("./pages/Hunts").then((m) => ({ default: m.Hunts })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Saved = lazy(() => import("./pages/Saved").then((m) => ({ default: m.Saved })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Taste = lazy(() => import("./pages/Taste").then((m) => ({ default: m.Taste })));
const Blank = () => <div className="min-h-dvh bg-background" />;
const loadMotionFeatures = () => import("./lib/motionFeatures").then((m) => m.default);

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
    return (
      <Suspense fallback={<Blank />}>
        <Login onSuccess={() => void qc.invalidateQueries()} />
      </Suspense>
    );
  }
  const onLogout = async () => {
    await api.logout();
    qc.clear();
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <>
      <Suspense fallback={<Blank />}>
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/taste" element={<Taste />} />
        <Route path="/saved" element={<Saved />} />
        <Route path="/hunts" element={<Hunts />} />
        <Route path="/settings" element={<Settings onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
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
      <LazyMotion features={loadMotionFeatures} strict>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LazyMotion>
    </QueryClientProvider>
  </StrictMode>,
);
