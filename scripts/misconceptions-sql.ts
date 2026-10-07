/**
 * Print the SQL that seeds the `misconceptions` table from src/lib/misconceptions/registry.ts.
 * The migration 20261007001400 embeds this output; tests/db/misconceptions.test.ts fails if the two drift.
 *
 *   npx tsx scripts/misconceptions-sql.ts
 */
import { misconceptionsSql } from "../src/lib/misconceptions/registry";

process.stdout.write(misconceptionsSql());
