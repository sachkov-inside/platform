import type { Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { botContactRows } from "../bot-contacts/contact-access.js";
import { findPlatformContactLinks } from "../identity-linking/platform-links.js";
import { CommunicationsError } from "./communications-contract.js";
import {
  authorizeWaitlist,
  type WaitlistAuthorization,
} from "./waitlist-authorization.js";

type Broadcast = Selectable<DatabaseSchema["communication_broadcasts"]>;
export async function waitlistContacts(
  tx: Transaction<DatabaseSchema>,
  row: Broadcast,
  provider: WaitlistAuthorization,
): Promise<string[]> {
  if (row.audience.kind !== "waitlist")
    throw new CommunicationsError("malformed");
  const audience = await authorizeWaitlist(provider, {
    actorAccountRef: row.owner_account_ref,
    intakeId: row.audience.intakeId,
  });
  if (audience.status !== "ok")
    throw new CommunicationsError(
      audience.status === "denied" ? "forbidden" : "authorization_unavailable",
    );
  if (
    !audience.saleOpen ||
    !row.parts.some((p) =>
      p.content.buttons.some((b) => b.url === audience.purchaseUrl),
    )
  )
    throw new CommunicationsError("revision_conflict");
  const opening = await tx
    .selectFrom("communication_waitlist_openings")
    .selectAll()
    .where("bot_identity", "=", row.bot_identity)
    .where("intake_id", "=", row.audience.intakeId)
    .executeTakeFirst();
  if (opening && opening.broadcast_id !== row.broadcast_id)
    throw new CommunicationsError("revision_conflict");
  await tx
    .insertInto("communication_waitlist_openings")
    .values({
      bot_identity: row.bot_identity,
      intake_id: row.audience.intakeId,
      broadcast_id: row.broadcast_id,
    })
    .onConflict((c) => c.doNothing())
    .execute();
  const links = await findPlatformContactLinks(
    tx,
    row.bot_identity,
    audience.members,
  );
  const contacts: string[] = [];
  for (let offset = 0; offset < links.length; offset += 500) {
    const batch = links
      .slice(offset, offset + 500)
      .filter((link) => link !== undefined);
    if (batch.length === 0) continue;
    await sql`insert into communication_contacts(contact_id,bot_identity,telegram_user_id)
      select gen_random_uuid(),bot_identity,telegram_user_id from (${botContactRows(tx)}) b where bot_identity=${row.bot_identity}
      and telegram_user_id in (${sql.join(batch.map((link) => link.telegramUserId))})
      on conflict(bot_identity,telegram_user_id) do nothing`.execute(tx);
    const available = await tx
      .selectFrom("communication_contacts as c")
      .innerJoin(botContactRows(tx).as("b"), (j) =>
        j
          .onRef("b.bot_identity", "=", "c.bot_identity")
          .onRef("b.telegram_user_id", "=", "c.telegram_user_id"),
      )
      .select(["c.contact_id", "c.telegram_user_id"])
      .where("c.bot_identity", "=", row.bot_identity)
      .where(
        "c.telegram_user_id",
        "in",
        batch.map((link) => link.telegramUserId),
      )
      .where("c.marketing_enabled", "=", true)
      .where("c.unavailable_since", "is", null)
      .where("b.contactability", "=", "reachable")
      .forShare("c")
      .execute();
    const bindings = new Map(batch.map((link) => [link.telegramUserId, link]));
    const recipients = available.flatMap((contact) => {
      const link = bindings.get(contact.telegram_user_id);
      return link === undefined
        ? []
        : [
            {
              broadcast_id: row.broadcast_id,
              contact_id: contact.contact_id,
              account_ref: link.accountRef,
              telegram_identity_ref: link.telegramIdentityRef,
            },
          ];
    });
    if (recipients.length > 0)
      await tx
        .insertInto("communication_waitlist_recipients")
        .values(recipients)
        .execute();
    contacts.push(...recipients.map((recipient) => recipient.contact_id));
  }
  await tx
    .updateTable("communication_broadcasts")
    .set({
      waitlist_active_count: audience.active,
      waitlist_excluded_count: audience.active - contacts.length,
    })
    .where("broadcast_id", "=", row.broadcast_id)
    .execute();
  return contacts;
}

export async function previewWaitlist(
  tx: Transaction<DatabaseSchema>,
  row: Broadcast,
  provider: WaitlistAuthorization,
) {
  if (row.audience.kind !== "waitlist")
    throw new CommunicationsError("malformed");
  const audience = await authorizeWaitlist(provider, {
    actorAccountRef: row.owner_account_ref,
    intakeId: row.audience.intakeId,
  });
  if (audience.status !== "ok")
    throw new CommunicationsError(
      audience.status === "denied" ? "forbidden" : "authorization_unavailable",
    );
  const links = await findPlatformContactLinks(
    tx,
    row.bot_identity,
    audience.members,
  );
  let eligible = 0;
  for (let offset = 0; offset < links.length; offset += 500) {
    const batch = links
      .slice(offset, offset + 500)
      .filter((link) => link !== undefined);
    if (batch.length === 0) continue;
    const contacts = await tx
      .selectFrom(botContactRows(tx).as("b"))
      .leftJoin("communication_contacts as c", (j) =>
        j
          .onRef("b.bot_identity", "=", "c.bot_identity")
          .onRef("b.telegram_user_id", "=", "c.telegram_user_id"),
      )
      .select("b.telegram_user_id")
      .where("b.bot_identity", "=", row.bot_identity)
      .where(
        "b.telegram_user_id",
        "in",
        batch.map((link) => link.telegramUserId),
      )
      .where("b.contactability", "=", "reachable")
      .where((eb) =>
        eb.or([
          eb("c.marketing_enabled", "=", true),
          eb("c.contact_id", "is", null),
        ]),
      )
      .where("c.unavailable_since", "is", null)
      .execute();
    eligible += contacts.length;
  }
  return {
    broadcastId: row.broadcast_id,
    revision: row.revision,
    active: audience.active,
    eligible,
    saleOpen: audience.saleOpen,
    purchaseUrl: audience.purchaseUrl,
  };
}
