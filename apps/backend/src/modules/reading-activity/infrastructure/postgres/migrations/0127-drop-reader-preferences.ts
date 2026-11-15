export const name = "0127_drop_reader_preferences";

/**
 * Contract step of the retired reading modes (#2119, #2140). Since v82 no application version
 * reads or writes the saved mode, and the owner no longer needs a rollback to v81. Irreversible:
 * the saved modes are dropped without migration, as the specification decided.
 */
export const statement = `
drop table reading_activity.reader_preferences;
`;
