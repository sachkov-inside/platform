import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { AccountEmailPanel } from "@/features/account-email/ui/account-email-panel.client";

const clients = [new QueryClient(), new QueryClient()];
const attached = factAnnouncement("inside.account-email.attached");

function Fixture() {
  const [index, setIndex] = useState(0);
  const client = clients[index];
  return (
    <>
      <button
        onClick={() => {
          setIndex((index + 1) % 3);
        }}
      >
        {client ? "Следующий читатель" : "Вернуть панель"}
      </button>
      <button onClick={() => attached.announce()}>
        Сообщить о новом адресе
      </button>
      {client && (
        <QueryClientProvider key={index} client={client}>
          <AccountEmailPanel />
        </QueryClientProvider>
      )}
    </>
  );
}

Object.assign(window, {
  emailReads: () =>
    clients.map((client) =>
      client
        .getQueryCache()
        .getAll()
        .map(({ state }) => state.isInvalidated),
    ),
});

const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
createRoot(host).render(<Fixture />);
