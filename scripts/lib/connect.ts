import postgres, { type Sql } from "postgres";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

/** Direct PostgreSQL connection for the offline CLIs (never used by the running web app). */
export function connectFromEnv(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (see .env.example).");
    process.exit(1);
  }
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Minimal flag parsing: `--flag`, `--key=value` and positional arguments. */
export function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("--")) positional.push(arg);
    else {
      const [key, ...rest] = arg.slice(2).split("=");
      flags.set(key!, rest.length > 0 ? rest.join("=") : true);
    }
  }
  return {
    flags,
    positional,
    has: (name: string) => flags.has(name),
    value: (name: string) => flags.get(name),
  };
}
