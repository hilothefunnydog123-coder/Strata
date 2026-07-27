import "server-only";
import { createDb, schema } from "@assent/db";

// One shared server-side database handle for the web app.
let cached: ReturnType<typeof createDb> | null = null;
export function db() {
  if (!cached) cached = createDb();
  return cached.db;
}
export { schema };
