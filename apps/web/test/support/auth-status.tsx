import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStatus } from "@/_app/ui/auth-status-control.client";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Status() {
  const status = useAuthStatus();
  return (
    <>
      <output aria-label="State">{status.state}</output>
      <output aria-label="Account">{status.accountId ?? "none"}</output>
      <output aria-label="Resolved">{String(status.resolved)}</output>
      <output aria-label="Manager">{String(status.canManageMaterials)}</output>
    </>
  );
}
function App() {
  const [mounted, setMounted] = useState(true);
  return (
    <QueryClientProvider client={client}>
      <button onClick={() => window.dispatchEvent(new Event("focus"))}>
        Return focus
      </button>
      <button
        onClick={() =>
          window.dispatchEvent(
            new PageTransitionEvent("pageshow", { persisted: false }),
          )
        }
      >
        Initial pageshow
      </button>
      <button
        onClick={() =>
          window.dispatchEvent(
            new PageTransitionEvent("pageshow", { persisted: true }),
          )
        }
      >
        Restored pageshow
      </button>
      <button
        onClick={() => {
          setMounted(!mounted);
        }}
      >
        {mounted ? "Unmount" : "Mount"}
      </button>
      {mounted ? <Status /> : null}
    </QueryClientProvider>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
