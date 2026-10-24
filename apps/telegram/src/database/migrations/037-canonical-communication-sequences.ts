import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

/** Drain old writers and keep the pre-contract backup. Recovery is restore plus forward migration. */
export const canonicalCommunicationSequencesMigration: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`
      alter table communication_funnels rename to communication_sequences;
      alter table communication_sequences rename column funnel_id to sequence_id;
      alter table communication_enrollments rename to communication_participations;
      alter table communication_participations rename column enrollment_id to participation_id;
      alter table communication_participations rename column funnel_id to sequence_id;
      alter table communication_participations rename column enrolled_at to participated_at;
      alter table communication_publications rename column funnel_id to sequence_id;
      alter table communication_sources rename column funnel_id to sequence_id;
      alter table communication_step_ids rename column funnel_id to sequence_id;
      alter table communication_entries rename column funnel_id to sequence_id;
      alter table communication_deliveries rename column funnel_id to sequence_id;

      create table communication_historical_author_state (
        source_table text not null, source_key jsonb not null, original jsonb not null,
        primary key (source_table, source_key)
      );
      insert into communication_historical_author_state
        select 'communication_sequences', jsonb_build_object('sequenceId', sequence_id), to_jsonb(row)
        from communication_sequences row;
      insert into communication_historical_author_state
        select 'communication_author_sessions', jsonb_build_object('bot',bot_identity,'user',telegram_user_id), to_jsonb(row)
        from communication_author_sessions row;
      insert into communication_historical_author_state
        select 'communication_author_drafts', jsonb_build_object('bot',bot_identity,'owner',owner_account_ref,'draft',draft_id), to_jsonb(row)
        from communication_author_drafts row;
      insert into communication_historical_author_state
        select 'communication_author_compositions', jsonb_build_object('bot',bot_identity,'owner',owner_account_ref,'destination',destination_id), to_jsonb(row)
        from communication_author_compositions row;

      create function pg_temp.canonical_sequence_author_state(value jsonb) returns jsonb language plpgsql strict as $$
      declare result jsonb; item record; canonical text;
      begin
        if jsonb_typeof(value) = 'array' then
          select coalesce(jsonb_agg(pg_temp.canonical_sequence_author_state(element) order by ordinal), '[]'::jsonb)
            into result from jsonb_array_elements(value) with ordinality as elements(element,ordinal);
          return result;
        elsif jsonb_typeof(value) <> 'object' then return value;
        end if;
        result := '{}'::jsonb;
        for item in select key, val from jsonb_each(value) as items(key,val) loop
          canonical := case item.key when 'funnelId' then 'sequenceId' when 'funnelIds' then 'sequenceIds'
            when 'funnel' then 'sequence' when 'funnels' then 'sequences' when 'funnelAuthor' then 'sequenceAuthor' else item.key end;
          if item.key in ('kind','target','batch') and jsonb_typeof(item.val) = 'string' then
            if item.val #>> '{}' = 'funnel' then item.val := '"sequence"'::jsonb;
            elsif item.val #>> '{}' = 'funnels' then item.val := '"sequences"'::jsonb;
            elsif item.val #>> '{}' like 'f:%' then item.val := to_jsonb('seq:' || substring(item.val #>> '{}' from 3));
            elsif item.val #>> '{}' in ('batch:funnel','compose:funnel','compose:edit-funnel','sequence:funnel') then
              item.val := to_jsonb(replace(item.val #>> '{}','funnel','sequence'));
            end if;
          end if;
          result := result || jsonb_build_object(canonical,pg_temp.canonical_sequence_author_state(item.val));
        end loop;
        return result;
      end $$;
      update communication_sequences set draft=pg_temp.canonical_sequence_author_state(draft);
      update communication_author_sessions set state=pg_temp.canonical_sequence_author_state(state);
      alter table communication_author_drafts drop constraint communication_author_drafts_kind_check;
      update communication_author_drafts set kind=case kind when 'funnel' then 'sequence' else kind end,
        snapshot=pg_temp.canonical_sequence_author_state(snapshot);
      alter table communication_author_drafts add constraint communication_author_drafts_kind_check check(kind in ('broadcast','sequence','intro'));
      update communication_author_compositions set state=pg_temp.canonical_sequence_author_state(state);
      -- Publications, published snapshots, operation receipts, deliveries, pending outbox messages and
      -- entry:/step: dedup keys stay exact. Current readers use the passive historical decoder.
    `.execute(db);
  },
  down() {
    return Promise.reject(
      new Error(
        "Incompatible communication contract: restore the pre-contract backup with dispatch held, then migrate forward",
      ),
    );
  },
};
