"""Finite source-owned vocabulary for private PG oracle failure projection."""

ORACLE_BASE_REASONS=(
    'oracle_input','oracle_values_decode','oracle_values_envelope','oracle_values_row','oracle_values_labels','oracle_values_number',
    'oracle_timestamps_decode','oracle_timestamps_envelope','oracle_timestamps_row','oracle_timestamps_labels','oracle_timestamps_number',
    'oracle_join','oracle_identity','oracle_cohort','oracle_availability_order','oracle_complete_time','oracle_complete_identity',
    'oracle_age','oracle_expected','oracle_value_mismatch','oracle_stale','oracle_unavailable','oracle_malformed_unknown')

ORACLE_JOIN_REASONS=('oracle_join_family_presence','oracle_join_scope_version',
                     'oracle_join_stamp_zero','oracle_join_stamp_future')
# One immutable mapping owns the optional stale projection, never primary admission.
ORACLE_STALE_PROJECTIONS=(
    (('availability','unknown'),'oracle_stale_availability'),
    (('healthy','match'),'oracle_stale_healthy_sample_match'),
    (('healthy','different'),'oracle_stale_healthy_sample_different'),
    (('healthy','unknown'),'oracle_stale_healthy_sample_unknown'))
ORACLE_REASONS=(*ORACLE_BASE_REASONS,*ORACLE_JOIN_REASONS,*(reason for _,reason in ORACLE_STALE_PROJECTIONS))
