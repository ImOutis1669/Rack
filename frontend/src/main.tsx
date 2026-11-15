import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, UnauthorizedError } from "./api/client";
import "./index.css";
import { Feed } from "./pages/Feed";
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

  if (me.isPending) return null;
  if (me.isError) {
    return <Login onSuccess={() => void qc.invalidateQueries()} />;
  }
  const onLogout = async () => {
    await api.logout();
    qc.clear();
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <Routes>
      <Route path="/" element={<Feed onLogout={onLogout} />} />
      <Route path="/taste" element={<Taste onLogout={onLogout} />} />
      <Route path="/saved" element={<Saved onLogout={onLogout} />} />
      <Route path="/settings" element={<Settings onLogout={onLogout} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
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
