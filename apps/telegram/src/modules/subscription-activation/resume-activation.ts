import type {Transaction} from "kysely";
import type {DatabaseSchema} from "../../database/database.js";
import type {LinkEffects} from "../identity-linking/link-effects.js";
/** Linking wakes every preserved Product intent without restarting completed activation. */
export async function resumeLinkedActivation(tx:Transaction<DatabaseSchema>,link:Parameters<LinkEffects["accountLinked"]>[1]):Promise<void> {
 await tx.updateTable("activation_attempts").set({due_at:link.linkedAt})
 .where("bot_identity","=",link.botIdentity).where("identity_ref","=",link.telegramIdentityRef)
 .where("state","in",["needs_account","pending","retry"]).execute();
}
