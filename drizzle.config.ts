import { defineConfig } from "drizzle-kit";

// drizzle-kit only generates SQL here. Applying migrations is the app's job, on
// launch, through electron/main/db/migrate.ts. See .claude/rules/data.md.
export default defineConfig({
	dialect: "sqlite",
	schema: "./electron/main/db/schema/*.ts",
	out: "./electron/main/db/migrations",
	strict: true,
	verbose: true,
});
