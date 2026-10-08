/**
 * Print the SQL that seeds the `misconceptions` table from src/lib/misconceptions/registry.ts.
 * The newest migration that seeds `misconceptions` embeds this output (tests/db/misconceptions.test.ts fails
 * if the two drift). When the registry changes, add a NEW migration with this output; never edit an old one.
 *
 *   npx tsx scripts/misconceptions-sql.ts
 */
import { misconceptionsSql } from "../src/lib/misconceptions/registry";

process.stdout.write(misconceptionsSql());
