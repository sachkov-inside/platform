import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { AccountEmailPanel } from "./account-email-panel.client";

const attached = factAnnouncement("inside.account-email.attached");
async function announceAttachment() {
  const delivered = new Promise<string>((resolve) => {
    const unsubscribe = attached.subscribe((id) => {
      unsubscribe();
      resolve(id);
    });
  });
  const id = attached.announce();
  await expect(await delivered).toBe(id);
}

function EmailReaders({
  clients,
}: {
  readonly clients: readonly QueryClient[];
}) {
  const [index, setIndex] = useState(0);
  const client = clients[index];
  return (
    <>
      <button
        onClick={() => {
          setIndex((index + 1) % (clients.length + 1));
        }}
      >
        {client ? "Следующий читатель" : "Вернуть панель"}
      </button>
      {client && (
        <QueryClientProvider key={index} client={client}>
          <AccountEmailPanel />
        </QueryClientProvider>
      )}
    </>
  );
}

const meta = {
  title: "Patterns/Account/Sign-in email announcements",
  component: AccountEmailPanel,
} satisfies Meta<typeof AccountEmailPanel>;
export default meta;

let clients: QueryClient[];
let pending: ReturnType<typeof Promise.withResolvers<Response>>;
let reads: number;

export const AnAnnouncementJoinsThePendingRead: StoryObj<typeof meta> = {
  beforeEach: () => {
    clients = [new QueryClient(), new QueryClient()];
    pending = Promise.withResolvers<Response>();
    reads = 0;
    const restore = fetchBeforeRender(async (input) => {
      if (input !== "/api/account/email")
        throw new Error("Unexpected email request");
      reads += 1;
      if (reads === 2) return pending.promise;
      return Response.json({
        ok: true,
        email: `reader${String(reads)}@example.org`,
      });
    })();
    return () => {
      pending.resolve(new Response(null, { status: 503 }));
      restore();
      for (const client of clients) client.clear();
    };
  },
  play: async ({ mount, canvasElement }) => {
    await mount(<EmailReaders clients={clients} />);
    const canvas = within(canvasElement);
    await canvas.findByText("reader1@example.org");
    await announceAttachment();
    await waitFor(() => expect(reads).toBe(2));
    await announceAttachment();
    pending.resolve(Response.json({ ok: true, email: "attached@example.org" }));
    await canvas.findByText("attached@example.org");
    await expect(reads).toBe(2);
    const next = canvas.getByRole("button", { name: "Следующий читатель" });
    await userEvent.click(next);
    await canvas.findByText("reader3@example.org");
    await announceAttachment();
    await canvas.findByText("reader4@example.org");
    await userEvent.click(next);
    await announceAttachment();
    await expect(reads).toBe(4);
    for (const client of clients) {
      const queries = client.getQueryCache().getAll();
      await expect(queries).toHaveLength(1);
      await expect(queries[0]?.state.isInvalidated).toBe(false);
    }
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть панель" }),
    );
    await canvas.findByText("reader5@example.org");
  },
};
