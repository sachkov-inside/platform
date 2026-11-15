export const name = "0127_drop_reader_preferences";

/**
 * Contract step of the retired reading modes (#2119, #2140). The application stopped reading and
 * writing the saved mode in v82 (#2118); on 2026-11-15 the owner ruled out a rollback to v81 or
 * earlier. Irreversible: the saved modes are dropped without migration, as the specification
 * decided.
 */
export const statement = `
drop table reading_activity.reader_preferences;
`;
