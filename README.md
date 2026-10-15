# Proof of Promise

Stake USDC on a personal promise. An agent checks your proof (GitHub, photo, Strava) and decides whether you keep the stake or forfeit it to a friend or charity.

Week 2 hackathon build for Rise In Agentmaxxing. Settlement is mocked on Base Sepolia—no real transfers. Friend stake-backing via x402 is stubbed for week 3.

Forked from the agentmaxxin Next.js starter (Gemini tools, local agent wallet, x402 helper).

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

You create a promise (description, deadline, proof type, stake, addresses). **Check proof** runs the agent with one tool matching the proof type. The tool returns evidence and a suggested verdict; if the model disagrees, settlement follows the tool so outages never slash a stake. `kept` / `broken` call `settleStake()` in `agent/wallet.ts` with `mocked: true` and no `txHash`.

Promises live in `data/promises.json` locally, or under `/tmp` on Vercel (ephemeral). Without `GEMINI_API_KEY`, GitHub/Strava still run from proof rules; photos need the key.

## Setup

Node 20+.

```bash
cp .env.example .env
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) — `npm run build` / `npm start` for production.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | For agent wording + photo vision | [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | No | Default `gemini-flash-latest` |
| `GITHUB_TOKEN` | No | Public commits only; helps rate limits |
| `WALLET_PRIVATE_KEY` | No | Or use **Create wallet** on the page (testnet only) |

Do not commit `.env`, `.agent-wallet.json`, or `data/`.

## Deploy

Import on [Vercel](https://vercel.com/new), set `GEMINI_API_KEY` (and optional vars above). API routes use the Node.js runtime.

**Live demo:** &lt;add URL&gt;

On Vercel, cold starts can wipe `/tmp`; empty stores seed the three sample promises automatically.

## Demo flow

1. Open the app. Banner shows if Gemini is configured.
2. Click **Add sample promises** (or use Vercel seed). Three cards: top → kept (1 commit on `vercel/next.js`), middle → broken (5000 commits in an hour), bottom → Strava pending.
3. **Check proof** on each; trace + mock settlement on the GitHub ones.
4. **Back stake** hits the week 3 x402 stub (no payment).

Optional: create a photo promise, upload an image, check (needs `GEMINI_API_KEY`). Past deadlines are allowed on purpose for demos.

## Roadmap (week 3)

- Escrow on Base Sepolia: lock USDC on create, refund maker on kept, pay beneficiary on broken.
- Real `StakeSettler` + `txHash` on receipts.
- `POST /api/promises/:id/back` returns 402; friends pay with `payAndFetch`.
- Strava OAuth behind `agent/proofs/strava.ts`.
- Redis or Blob instead of `/tmp`.

MIT
