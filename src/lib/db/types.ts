import type { Sql, TransactionSql } from "postgres";

/** A direct PostgreSQL connection, or a transaction on one. Used by the offline CLIs and tests. */
export type Db = Sql | TransactionSql;
