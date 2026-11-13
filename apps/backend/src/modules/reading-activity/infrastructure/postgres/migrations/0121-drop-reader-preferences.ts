export const name = "0121_drop_reader_preferences";

/** The reading modes were retired (#2119); saved modes are dropped, not carried over. */
export const statement = `
drop table reading_activity.reader_preferences;
`;
