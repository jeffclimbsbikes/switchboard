#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const dir = process.env.CLAUDE_CONFIG_DIR;
mkdirSync(dir, { recursive: true });
const creds = join(dir, "login.json");
const [group, cmd] = process.argv.slice(2);

if (group === "auth" && cmd === "status") {
  if (existsSync(creds)) {
    const c = JSON.parse(readFileSync(creds, "utf8"));
    console.log(
      JSON.stringify({
        loggedIn: true,
        loginExpiresAt: c.expiresAt,
        subscriptionType: "max",
        email: "secret@example.com",
      }),
    );
  } else {
    console.log(JSON.stringify({ loggedIn: false, authMethod: "none", loginExpiresAt: null }));
    process.exit(1);
  }
} else if (group === "auth" && cmd === "login") {
  writeFileSync(join(dir, "login.pid"), String(process.pid));
  console.log("Opening browser to sign in…");
  console.log(
    "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fake&state=abc",
  );
  process.stdout.write("Paste code here if prompted > ");
  const rl = createInterface({ input: process.stdin });
  rl.once("line", (line) => {
    if (line.trim() === "good-code#abc") {
      writeFileSync(
        creds,
        JSON.stringify({
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          accessToken: "sk-ant-oat01-SECRET",
        }),
      );
      console.log("\nLogin successful.");
      process.exit(0);
    }
    console.log(`\nCouldn't log in: bad code ${line}`);
    process.exit(1);
  });
  rl.once("close", () => process.exit(1));
} else {
  process.exit(2);
}
