import { QuickPanel } from "./components/quick-panel";
import { MainWindow } from "./components/main-window";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { trpc, initializeTrpcClient, getTrpcClient } from "./api";
import { useState, useEffect } from "react";
import { QueryClient } from "@tanstack/react-query";
import { ReplayWindow } from "./components/replay-window";

const router = createBrowserRouter([
  {
    path: "/main-window",
    element: <MainWindow />,
  },
  {
    path: "/quick-panel",
    element: <QuickPanel />,
  },
  {
    path: "/replay-window",
    element: <ReplayWindow />,
  },
]);

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    initializeTrpcClient()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/80 text-white p-4">
        <div className="text-center">
          <p className="text-red-400 font-medium">Failed to connect to server</p>
          <p className="text-sm text-gray-400 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const client = getTrpcClient();
  if (!ready || !client) {
    return (
      <div className="flex items-center justify-center h-screen bg-black/80 text-white">
        <div className="text-center">
          <p className="text-gray-400">Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <RouterProvider router={router} />
    </trpc.Provider>
  );
}
