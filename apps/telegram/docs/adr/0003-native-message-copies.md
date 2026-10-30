# Native Telegram copies in the author's private conversation

On 2026-10-30 the owner chose to retain independent bot-created copies in their private bot
conversation instead of provisioning a service channel. Telegram copy operations preserve ordinary
message formats and albums as the provider evolves, while rebuilding every format in the shared
wire contract would keep rejecting legitimate authored content. The provider owns opaque archive
references and private Telegram identifiers; Platform receives a bounded summary and discovered
links for authorization and target checks.

This choice requires keeping the bot-created copies while referenced. PostgreSQL backups cannot
restore deleted Telegram copies, and older native-unaware releases cannot render native snapshots.
The [communications integration](../integrations/communications-v1.md#native-archive-rollout-and-recovery)
owns lifecycle, retention, rollout and recovery. Prepared implementation acceptance remains separate
from the owner's storage-location choice.
