import "dotenv/config";
import { ensureDigestSchedule } from "./workspaceSchedule";

// Run in the project-owner environment ONLY after the callback version is published:
// pnpm tsx server/setupDigestSchedule.ts --published
if (!process.argv.includes("--published")) {
  console.error("Publish the callback version first; then rerun with --published to confirm.");
  process.exit(1);
}
ensureDigestSchedule().then(result => {
  console.log("Shared digest schedule registered:", JSON.stringify(result));
  process.exit(0);
}).catch(error => {
  console.error("Digest setup failed; no registration should be assumed:", error);
  process.exit(1);
});
