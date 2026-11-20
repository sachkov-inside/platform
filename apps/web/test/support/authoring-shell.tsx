import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AuthoringShell } from "@/widgets/authoring-shell/ui/authoring-shell.client";
import { withNextNavigation } from "./next-navigation";
import "../../app/globals.css";

if (location.search === "?menu") {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Missing fixture root");
  createRoot(root).render(
    withNextNavigation(
      <PathnameContext.Provider value="/authoring/topics">
        <QueryClientProvider client={new QueryClient()}>
          <AuthoringShell>
            <main id="authoring-content">Проверка меню</main>
          </AuthoringShell>
        </QueryClientProvider>
      </PathnameContext.Provider>,
    ),
  );
  // Allow two complete React click transactions before the pending native change is delivered.
  document.addEventListener("fixture-click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement)
      flushSync(() => {
        target.click();
      });
  });
} else {
  const frame = document.createElement("iframe");
  frame.title = "Админка";
  frame.style.cssText = "width:390px;height:844px;border:0";
  frame.src = "?menu";
  document.body.append(frame);
}
