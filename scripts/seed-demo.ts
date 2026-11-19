// Creates a clearly-labeled DEMO workspace with fictional athletes.
//   npm run seed:demo -- [email] [password]
import { getDb } from "../src/lib/db";
import { createDemoWorkspace } from "../src/lib/onboarding";

async function main() {
  const email = process.argv[2] ?? "demo@rc.local";
  const password = process.argv[3] ?? "demo-password";
  const db = await getDb();
  if (await db.get("SELECT id FROM users WHERE email = ?", [email])) {
    console.log(`Demo user ${email} already exists.`);
    return;
  }
  await createDemoWorkspace(db, email, password);
  console.log(`Demo workspace created. Sign in with ${email} / ${password}`);
  console.log("All athletes in this workspace are FICTIONAL and labeled DEMO.");
}

main();
