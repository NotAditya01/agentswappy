# Proof of Promise

**One-line pitch:** Stake USDC on a personal promise; an AI agent verifies your proof with real APIs and decides whether you keep or forfeit the stake to a friend or charity.

Week 2 build for the **Rise In Agentmaxxing** hackathon. Settlement is mocked on Base Sepolia—no wallet is charged and no transaction is broadcast. Friends backing a stake with x402 micropayments is a Week 3 stub.

Built on the [agentmaxxin](https://github.com/risein) Next.js starter: Gemini tool calling, a local agent wallet, and the x402 payment helper.

## The problem

Promises are easy to make and hard to enforce. Accountability apps track habits but rarely tie outcomes to money, and they do not **judge** whether proof actually matches the claim. Proof of Promise combines **stakes**, **named beneficiaries**, and an **agent** that calls external tools (GitHub, vision, Strava) to reach a verdict—with a clear path to on-chain escrow.

## How it works

```mermaid
flowchart TD
  User[User / judge] --> UI[Next.js dashboard]
  UI -->|POST promise| API[Promise API]
  UI -->|Check proof| Check[/api/promises/:id/check]
  API --> Store[(Promises store)]
  Check --> Agent[judgePromise — Gemini]
  Agent --> GH[GitHub commits API]
  Agent --> Vision[Gemini vision]
  Agent --> Strava[Strava stub]
  Agent --> Verdict[kept / broken / pending]
  Verdict --> Settle[MockStakeSettler]
  Settle -. Week 3 .-> Chain[Base Sepolia USDC escrow]
  Friend[Friend agent] -. x402 stub .-> Back[/api/promises/:id/back]
```

1. You create a promise: description, deadline, proof type, target, stake, refund address, and beneficiary.
2. The promise is stored locally in `data/promises.json`, or on Vercel in ephemeral `/tmp` (see [Storage on Vercel](#storage-on-vercel)).
3. **Check proof** runs the agent. It may call only the tool that matches the proof type.
4. The tool returns evidence and a suggested verdict: `kept`, `broken`, or `pending`.
5. The agent records an explanation. If that verdict matches the evidence, it stands. If it does not, settlement follows the proof tool. An outage never slashes a stake.
6. `kept` or `broken` calls `settleStake()` in `agent/wallet.ts`. The receipt is marked `mocked: true` with `txHash: null`. `pending` settles nothing.

Early completion counts. A GitHub target already met is **kept** before the deadline. A missing photo is **pending** until the deadline, then **broken**. Strava is not connected yet, so it stays **pending**.

Without `GEMINI_API_KEY`, GitHub and Strava checks still run; the stored explanation reflects proof rules. Photo vision needs the key.

## Features

- **Promise dashboard** — create, list, and inspect promises with trace, verdict, and mock settlement.
- **Proof types** — GitHub commit counts, uploaded photo (Gemini vision), Strava activity (stub).
- **Agent verdict loop** — Gemini tool calling with `record_verdict` and evidence-aware fallbacks.
- **Mock stake settlement** — refund maker on **kept**, pay beneficiary on **broken**; `StakeSettler` seam for Week 3 chain logic.
- **Agent wallet** — viem wallet for future x402 signing; `payAndFetch` handles 402 flows.
- **Sample promises** — one-click demo set for judges (kept / broken / pending scenarios).
- **Vercel-ready** — Node.js API routes and writable storage on serverless via `/tmp`.

## Tech stack

| Layer | Choice |
| :--- | :--- |
| Framework | Next.js 16 (App Router), React 19 |
| Agent | Google Gemini (`@google/genai`) with tool calling |
| Chain (Week 3) | viem, Base Sepolia, USDC |
| Payments (Week 3) | x402-style `X-PAYMENT` header stub |
| UI | Tailwind CSS 4, shadcn-style components |
| Persistence | JSON file (local) / OS temp dir (Vercel) |

## Architecture and folder map

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
| `lib/store.ts` | JSON persistence (local `data/` or Vercel `/tmp`). |
| `lib/demo.ts` | Sample promise drafts for demos. |
| `data/` | Local promises and photos. Gitignored. |

`StakeSettler` is the seam for Base Sepolia. `MockStakeSettler` is the only implementation today. Swap `stakeSettler` in `agent/wallet.ts` when an escrow contract can refund the maker or pay the beneficiary.

## Local setup

Requirements: **Node.js 20+**.

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production build:

```bash
npm run build
npm start
```

## Environment variables

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | For agent wording and photos | Free key from [Google AI Studio](https://aistudio.google.com/apikey). |
| `GEMINI_MODEL` | No | Defaults to `gemini-flash-latest`. Use a model that supports tools and images. |
| `GITHUB_TOKEN` | No | Raises the unauthenticated 60 req/h GitHub limit. No scopes needed for public commits. |
| `WALLET_PRIVATE_KEY` | No | Test key only. Otherwise use **Create wallet** on the page. Never fund with real assets. |

`data/`, `.agent-wallet.json`, and `.env` are gitignored. **Never commit secrets.**

## Storage on Vercel

On Vercel, the deployment filesystem is read-only except **`/tmp`**. When `VERCEL` is set, `lib/store.ts` and the agent wallet write under `os.tmpdir()` (`proof-of-promise/`). The first read seeds the three **sample promises** if the store is empty so judges land on a demo-ready dashboard.

**Hosted data is ephemeral:** cold starts and redeploys can wipe promises, uploads, and the generated wallet. That is intentional for Week 2.

**Week 3 upgrade:** persist promises and proof blobs with **Upstash Redis** (metadata + TTL) or **Vercel Blob** (images), then point `lib/store.ts` at that backend while keeping the same `PromiseRecord` shape.

## Deploy on Vercel

1. Import this repository in [Vercel](https://vercel.com/new).
2. Set environment variables (`GEMINI_API_KEY`, optional `GITHUB_TOKEN` and `GEMINI_MODEL`).
3. Deploy. All API routes use the **Node.js** runtime (`export const runtime = "nodejs"`).
4. Open the deployment URL and run the demo script below.

**Live demo:** &lt;add URL&gt;

## Two-minute demo script

1. Start the app (local or Vercel). The banner shows whether the Gemini key is set. Sample GitHub checks work without it.
2. On Vercel, sample promises may already be loaded; locally, click **Add sample promises**. Three cards appear, newest first:
   - **Top:** at least 1 commit on `vercel/next.js` over the last 30 days, deadline yesterday → expect **kept**.
   - **Middle:** 5000 commits on `vercel/next.js` in a one-hour window, deadline yesterday → expect **broken**.
   - **Bottom:** 5 km Strava run, deadline yesterday → **pending** (integration not connected).
3. **Check proof** on the top card. Trace lists GitHub commits. Settlement shows refund 5.00 USDC to the maker (mock, no tx).
4. **Check proof** on the middle card. Verdict **broken**; settlement forfeits 10.00 USDC to Demo friend (mock).
5. **Check proof** on the Strava card. Trace says integration not connected; verdict stays **pending**, no settlement.
6. Click **Back stake** on any card. Week 3 stub explains the future x402 handshake; stake unchanged.

Optional: create a **Photo** promise, upload an image, then check (requires `GEMINI_API_KEY`).

Past deadlines are allowed so demos do not have to wait.

## Roadmap

### Week 3

1. **Escrow on Base Sepolia** — creating a promise locks test USDC; `kept` refunds `makerAddress`, `broken` pays `beneficiaryAddress`; real `txHash` on the receipt.
2. **Real payouts** — replace `MockStakeSettler` with contract calls via viem.
3. **x402 stake backing** — `POST /api/promises/:id/back` returns 402 with a price; a friend's agent pays with `payAndFetch`; verified payments increase `stakeUsdc`.
4. **Strava OAuth** — implement `ActivityProofSource` in `agent/proofs/strava.ts` with `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and refresh token.
5. **Durable storage** — Upstash Redis or Vercel Blob instead of `/tmp`.
6. **Deadline wake-up** — check open promises when time passes, not only on button click.

Stay on testnet until the escrow path is reviewed. The demo wallet is plain text on disk (or `/tmp` on Vercel).

## Judging criteria highlights

### Tools and API experimentation

- **Gemini agent loop** with constrained tools per proof type and structured `ProofCheckResult` evidence.
- **GitHub REST API** for commit verification, with optional `GITHUB_TOKEN` for rate limits.
- **Gemini vision** for image promises against a natural-language claim.
- **Strava** wired behind an `ActivityProofSource` interface (stub returns pending until OAuth lands).
- **x402-shaped** `payAndFetch` and `/back` route stub for agent-to-agent micropayments.

### Crypto integration plan

- **Today:** viem wallet on Base Sepolia, mock `StakeSettler`, settlement receipts shaped for real chain data (`network`, `asset`, `txHash` placeholder).
- **Week 3:** escrow contract on **Base Sepolia**, USDC transfers on verdict, x402-verified stake backing, testnet-only until audited.

## Troubleshooting

| Problem | What to do |
| :--- | :--- |
| The page says the Gemini key is missing | Put it in `.env` (or Vercel env) and redeploy. |
| GitHub check says 403 or 429 | Wait, or set `GITHUB_TOKEN`. API errors keep the stake **pending**. |
| A photo check stays pending | Upload an image and set `GEMINI_API_KEY`. Low confidence also stays pending. |
| Vercel data disappeared | Expected after redeploy; use sample promises or Week 3 persistent storage. |
| Port 3000 is in use | `npm run dev -- -p 3001` |
| A promise is stuck on Checking | Crashed checks retry after 90 seconds. |

## License

MIT
