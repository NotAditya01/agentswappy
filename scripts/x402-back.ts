// Backs a promise through the x402 endpoint with a test wallet.
// Usage: PAYER_PRIVATE_KEY=0x... npx tsx scripts/x402-back.ts <base-url> <promise-id> [amount]
// Base Sepolia test USDC only.
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { signPayment, type PaymentRequirements } from "../lib/x402";

const [base, id, amount = "0.1"] = process.argv.slice(2);
const key = process.env.PAYER_PRIVATE_KEY as Hex | undefined;
if (!base || !id || !key) {
  console.error("Usage: PAYER_PRIVATE_KEY=0x... npx tsx scripts/x402-back.ts <base-url> <promise-id> [amount]");
  process.exit(1);
}

const account = privateKeyToAccount(key);
const url = `${base.replace(/\/$/, "")}/api/promises/${id}/back?amount=${amount}`;

async function main() {
  const first = await fetch(url, { method: "POST" });
  const quote = await first.json();
  console.log("first try:", first.status, JSON.stringify(quote, null, 2));
  if (first.status !== 402) return process.exit(1);

  const req = quote.accepts[0] as PaymentRequirements;
  const header = await signPayment(account, account.address, req);
  const paid = await fetch(url, { method: "POST", headers: { "X-PAYMENT": header } });
  const data = await paid.json();
  const receipt = paid.headers.get("x-payment-response");
  console.log("paid:", paid.status);
  if (receipt) console.log("payment response:", JSON.parse(atob(receipt)));
  console.log("backings:", JSON.stringify(data.backings ?? data, null, 2));
}

main();
