import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api, UnauthorizedError } from "./api/client";
import "./index.css";
import { Feed } from "./pages/Feed";
import { Login } from "./pages/Login";

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
  return (
    <Feed
      onLogout={async () => {
        await api.logout();
        qc.clear();
        void qc.invalidateQueries({ queryKey: ["me"] });
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
