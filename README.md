# Agentic Wallet Solana (Superteam Nigeria Bounty)

TypeScript-based agentic wallet system on **Solana Devnet** with autonomous AI agents and Telegram control.

Repository: `https://github.com/TopeGramms/agentic-wallet-solana`

## What Was Built
- 3 autonomous wallet agents:
  - `Agent-Alpha` (Gemini)
  - `Agent-Beta` (Groq)
  - `Agent-Gamma` (Mistral)
- Each agent manages its **own wallet state** and decision lifecycle.
- Decision model: **rules-first, AI fallback**.
- Telegram command interface:
  - `/alpha`, `/beta`, `/gamma`, `/status`, `/report`
- Scheduled autonomous reporting at **8am and 8pm** (with startup reporting support).
- Live deployment on Render.

## Bounty Requirement Coverage
### 1) Agentic wallet capabilities
This implementation demonstrates that the wallet system can:
- Create wallets programmatically via Solana `Keypair.generate()`.
- Sign transactions automatically without manual signature prompts.
- Hold SOL on Solana Devnet and query balances.
- Interact with a dApp simulation (`src/dapp/TestDApp.ts`).

### 2) Deep dive: wallet architecture and agent interaction
#### Wallet design
- `src/wallet/AgenticWallet.ts` is the wallet abstraction layer.
- It wraps keypair creation/import, RPC connection, balance retrieval, transfers, and airdrops.
- `src/agent/WalletAgent.ts` consumes wallet capabilities for LLM-driven tasks.

#### Agent architecture
- `src/agent/multiAgent.ts`
  - Multi-agent runtime with isolated in-memory state per agent.
  - Separate AI provider per agent.
  - Rule engine drives decisions first; model calls are fallback.
  - Telegram command handlers + scheduled reports.
- `src/agent/autonomous.ts`
  - Single autonomous agent loop with conservative controls.

#### Clear separation of concerns
- Wallet operations: `src/wallet/AgenticWallet.ts`
- Agent orchestration/decision logic: `src/agent/*.ts`
- Telegram interaction layer: `src/telegram/bot.ts` and bot logic inside `src/agent/multiAgent.ts`
- dApp simulation: `src/dapp/TestDApp.ts`

#### Security and key management
- Secrets are loaded from environment variables only.
- `.env` is gitignored; `.env.example` is the template.
- Private keys are never intended to be hardcoded in source.
- Devnet-only operations reduce real-funds risk during prototype stage.
- Airdrop controls, cooldowns, and backoff logic are included to avoid faucet abuse.

### 3) Setup and run instructions
See sections below for local setup and Render deployment.

### 4) Scalability
- Supports multiple independent agents simultaneously.
- Each agent maintains isolated wallet/action state.
- Architecture is compatible with adding more agents/providers by extending agent config.

## Functional Demonstration
Typical flow:
1. Start service.
2. Telegram `/start` initializes interaction.
3. `/report` triggers full autonomous run for all agents.
4. `/alpha`, `/beta`, `/gamma` provides agent-specific responses and status.
5. Scheduled autonomous updates run at 8am and 8pm.

For judging/demo, this gives:
- autonomous wallet behavior,
- independent multi-agent state,
- and real-time Telegram observability.
## Screenshots 
<img width="828" height="1792" alt="image" src="https://github.com/user-attachments/assets/adf61617-7744-4f91-af2c-217fc8d204f5" />

<img width="828" height="1792" alt="image" src="https://github.com/user-attachments/assets/b720e5fd-9990-4ff1-ba4a-6e82c917b926" />

![image](https://github.com/user-attachments/assets/6dc1fc05-d970-4ba2-bde8-731d55c65c54)

![image](https://github.com/user-attachments/assets/44763d2c-77e5-428b-955a-61aaba1fd9c9)

## Core Files
- `src/wallet/AgenticWallet.ts` (`agenticWallet.ts` in bounty wording)
- `src/agent/WalletAgent.ts` (`walletAgent.ts`)
- `src/dapp/TestDApp.ts` (`testDApp.ts`)
- `src/agent/multiAgent.ts`
- `src/agent/autonomous.ts`

## Prerequisites
- Node.js 18+
- npm
- Telegram bot token
- Solana devnet connectivity
- API keys for providers you enable:
  - Gemini
  - Groq
  - Mistral

## Local Setup
1. Install dependencies:
```bash
npm install
```

2. Create env file:
```bash
cp .env.example .env
```

3. Fill required variables in `.env`.

4. Run one of the runtimes:
```bash
npx ts-node src/telegram/bot.ts
```
```bash
npx ts-node src/agent/multiAgent.ts
```
```bash
npx ts-node src/agent/autonomous.ts
```

## Environment Variables (Summary)
Required core:
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY` (if Gemini-enabled paths are used)
- `GROQ_API_KEY` (if Groq-enabled paths are used)
- `MISTRAL_API_KEY` (if Mistral-enabled paths are used)

Common controls:
- `MULTI_AGENT_AI_ENABLED`
- `MULTI_AGENT_AIRDROP_ENABLED`
- `AUTONOMOUS_AI_ENABLED`
- `AUTONOMOUS_AIRDROP_ENABLED`
- `MULTI_AGENT_REPORT_ON_START`
- `TELEGRAM_USE_WEBHOOK`
- `TELEGRAM_WEBHOOK_URL`
- `TELEGRAM_WEBHOOK_PATH`

## Render Deployment
### Recommended (Web Service + Webhook Mode)
Service config:
- Build Command: `npm install && npm run build`
- Start Command: `node dist/agent/multiAgent.js`

Set env:
```env
TELEGRAM_USE_WEBHOOK=true
TELEGRAM_WEBHOOK_URL=https://<your-service>.onrender.com
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
PORT=10000
```

Then register/verify Telegram webhook:
```bash
https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=https://<your-service>.onrender.com/telegram/webhook
```
```bash
https://api.telegram.org/bot<TELEGRAM_TOKEN>/getWebhookInfo
```

## Build and Test
```bash
npm run build
npm test
```

## Notes for Judges
- This is intentionally built and tested on **Devnet**.
- The system is designed as a realistic prototype: autonomous behavior + guardrails + observability.
- It demonstrates core agentic wallet primitives expected for production-oriented architecture, while remaining transparent about devnet constraints.

## License
MIT
