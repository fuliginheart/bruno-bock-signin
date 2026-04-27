#!/usr/bin/env node
/**
 * scripts/hash-pin.ts
 * CLI helper: read a PIN from argv or stdin and print its scrypt hash.
 * Used by install.ps1 to bake the admin PIN into .env.local without
 * shipping plaintext into a config file.
 *
 * Usage:
 *   tsx scripts/hash-pin.ts 123456
 *   echo 123456 | tsx scripts/hash-pin.ts
 */
import { hashPin } from "../src/server/pin";

async function readPin(): Promise<string> {
  const fromArg = process.argv[2];
  if (fromArg && fromArg.length > 0) return fromArg;

  // If stdin is a TTY, prompt the user instead of hanging silently.
  if (process.stdin.isTTY) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    return new Promise((resolve) => {
      rl.question("Enter PIN: ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  // Piped input — read all of stdin.
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const pin = await readPin();
  if (!pin) {
    process.stderr.write("No PIN provided.\n");
    process.exit(2);
  }
  process.stdout.write(hashPin(pin));
}

void main().catch((err) => {
  process.stderr.write(`hash-pin error: ${(err as Error).message}\n`);
  process.exit(1);
});
