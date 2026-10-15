# Proof of Promise

Week 2 build for the Rise In Agentmaxxing hackathon. A person states a promise and stakes USDC. An agent checks the proof with tools and decides whether the promise was kept. A kept stake is refunded to the maker. A broken stake goes to a named friend or charity.

Settlement is mocked. No wallet is charged and no transaction is broadcast. Friends backing a stake with x402 micropayments is a Week 3 stub.

Built on the [agentmaxxin](https://github.com/risein) Next.js starter: Gemini tool calling, a local agent wallet, and the x402 payment helper.

## How a check works

1. You create a promise: description, deadline, proof type, target, stake, refund address, and beneficiary.
2. The promise is stored in `data/promises.json` on this machine.
3. **Check proof** runs the agent. It may call only the tool that matches the proof type.
4. The tool returns evidence and a suggested verdict: `kept`, `broken`, or `pending`.
5. The agent records an explanation. If that verdict matches the evidence, it stands. If it does not, settlement follows the proof tool and the explanation says why. An outage never slashes a stake.
6. `kept` or `broken` calls `settleStake()` in `agent/wallet.ts`. The receipt is marked `mocked: true` with `txHash: null`. `pending` settles nothing.

Early completion counts. A GitHub target that is already met is kept even before the deadline. A missing photo is pending until the deadline, then broken. Strava is not connected, so it stays pending.

Without `GEMINI_API_KEY`, GitHub and Strava still check, and the stored explanation says the proof rules decided. Photo vision needs the key.

## Architecture

```mermaid
flowchart LR
  UI[Dashboard] --> API[Promise API]
  API --> Store[(data/promises.json)]
  API --> Agent[judgePromise]
  Agent --> GH[GitHub REST API]
  Agent --> Vision[Gemini vision]
  Agent --> Strava[Strava stub]
  API --> Settle[MockStakeSettler]
  Settle -. Week 3 .-> Chain[Base Sepolia USDC]
  Friend[Friend agent] -. x402 stub .-> Back[/api/promises/:id/back]
```

| Path | Role |
| :--- | :--- |
| `app/page.tsx` | Dashboard: create a promise, see status, trace, and settlement. |
| `app/api/promises/route.ts` | List and create promises. |
| `app/api/promises/[id]/check/route.ts` | Run the verdict and mock settlement. |
| `app/api/promises/[id]/proof/route.ts` | Upload or read a photo. |
| `app/api/promises/[id]/back/route.ts` | Week 3 x402 stub. Accepts no payment. |
| `app/api/wallet/route.ts` | Create and read the agent wallet. |
| `agent/agent.ts` | Gemini loop and `judgePromise`. |
| `agent/tools.ts` | `check_github_commits`, `check_image_proof`, `check_strava_activity`, `record_verdict`. |
| `agent/proofs/github.ts` | Public GitHub commits API. Optional `GITHUB_TOKEN`. |
| `agent/proofs/image.ts` | Gemini vision over the uploaded photo. |
| `agent/proofs/strava.ts` | `ActivityProofSource` interface. Week 2 always returns not connected. |
| `agent/wallet.ts` | Wallet, x402 `payAndFetch`, `StakeSettler`, and `StakeBacker`. |
| `lib/store.ts` | JSON file persistence. |
| `data/` | Local promises and photos. Gitignored. |

`StakeSettler` is the seam for Base Sepolia. `MockStakeSettler` is the only implementation today. Swap `stakeSettler` in `agent/wallet.ts` when an escrow contract can refund the maker or pay the beneficiary.

## Setup

Requirements: Node.js 20 or newer.

```bash
cp .env.example .env
npm install
```

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | For agent wording and photos | Free key from [Google AI Studio](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | No | Defaults to `gemini-flash-latest`. Use a model that can call tools and read images. |
| `GITHUB_TOKEN` | No | Raises the unauthenticated 60 request/hour GitHub limit. No scopes needed for public commits. |
| `WALLET_PRIVATE_KEY` | No | Test key only. Otherwise use **Create wallet** on the page. Never fund it with real assets. |

`data/` and `.agent-wallet.json` are gitignored. Do not commit `.env`.

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build
npm start
```

## Two-minute demo

1. Start the app. The banner tells you if the Gemini key is missing. Sample GitHub checks still work.
2. Click **Add sample promises**. Three cards appear:
   - At least 1 commit on `vercel/next.js` over the last 30 days, deadline yesterday.
   - 5000 commits on `vercel/next.js` inside a one-hour window, deadline yesterday.
   - A 5 km Strava run, deadline yesterday.
3. **Check proof** on the first card. The trace lists GitHub commits. The verdict is kept. The settlement says refund 5.00 USDC to the maker, mock, no transaction.
4. **Check proof** on the second card. The verdict is broken. The settlement forfeits 10.00 USDC to Demo friend. Still no transaction.
5. **Check proof** on the Strava card. The trace says the integration is not connected. The verdict stays pending and there is no settlement.
6. Click **Back stake** on any card. The Week 3 stub explains the future x402 handshake. The stake does not change.

Optional photo path: create a promise with proof type Photo, upload an image, then check it. Vision needs `GEMINI_API_KEY`.

Past deadlines are allowed so a demo does not have to wait.

## Week 3 roadmap

1. Escrow on Base Sepolia. Creating a promise locks test USDC. Replace `MockStakeSettler.settle` so `kept` transfers to `makerAddress`, `broken` transfers to `beneficiaryAddress`, and the receipt carries a real `txHash`.
2. x402 stake backing. `POST /api/promises/:id/back` returns 402 with a price. A friend's agent pays with `payAndFetch`. `verifyPayment` checks the signature and `X402StakeBacker` increases `stakeUsdc`.
3. Strava OAuth. Implement `ActivityProofSource.isConnected` and `check` in `agent/proofs/strava.ts` using `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and a refresh token. Until then the stub must keep returning pending.
4. A deadline wake-up so open promises are checked when the time passes, instead of only when someone clicks the button.
5. Stay on testnet until the escrow path has been reviewed. This demo wallet is plain text on disk.

## Troubleshooting

| Problem | What to do |
| :--- | :--- |
| The page says the Gemini key is missing | Put it in `.env` and restart `npm run dev`. |
| GitHub check says 403 or 429 | Wait, or set `GITHUB_TOKEN` and restart. The stake stays pending on an API error. |
| A photo check stays pending | Upload an image and set `GEMINI_API_KEY`. A low-confidence reading also stays pending. |
| Port 3000 is in use | `npm run dev -- -p 3001` |
| A promise is stuck on Checking | A crashed check is retried after 90 seconds. |

## License

MIT
