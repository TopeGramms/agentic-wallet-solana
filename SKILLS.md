# SKILLS.md - Agent Capability Manifest

This document defines what AI agents can do in this Solana Devnet agentic wallet system and how they should interact with it.

## System Identity
- Project: `agentic-wallet-solana`
- Network: Solana Devnet
- Runtime: TypeScript/Node.js
- Interface: Telegram bot + scheduled autonomous loops
- Goal: autonomous wallet monitoring and low-risk devnet operations

## Core Capabilities
The system supports agentic wallet behavior across three independent agents:
- `Agent-Alpha` (`Gemini`) - maintain wallet balance above target threshold.
- `Agent-Beta` (`Groq`) - monitor wallet and report status every cycle.
- `Agent-Gamma` (`Mistral`) - act only when balance drops below low threshold.

Each agent:
- Creates/owns an isolated wallet (`Keypair.generate()` or configured key).
- Reads wallet balance from Solana Devnet.
- Makes autonomous decisions with rules-first logic and AI fallback.
- Executes actions and reports outcomes to Telegram.

## Supported Agent Decisions
Agents must return one of these actions:
- `REQUEST_AIRDROP`
- `HOLD`
- `LOG_STATUS`

Optional reasoning text should explain why the action was selected.

## Wallet Operations Available
Wallet operations are separated from agent reasoning and should be called via wallet classes/modules:
- `create_wallet` - create a new keypair wallet.
- `get_wallet_address` - return public key.
- `get_balance` - return SOL balance.
- `request_airdrop` - request devnet SOL (subject to faucet limits and cooldown logic).
- `send_sol` - transfer SOL and return signature.

## Telegram Command Surface
Human-triggered bot commands:
- `/alpha` - run/report Alpha agent state.
- `/beta` - run/report Beta agent state.
- `/gamma` - run/report Gamma agent state.
- `/status` - show multi-agent summary.
- `/report` - force full report cycle now.

Autonomous behavior:
- Scheduled reports at 8am and 8pm.
- Optional interval-based cycles in autonomous and multi-agent runtimes.

## Agent Interaction Contract
When an AI model is used for decisioning, the expected output format is:

```json
{
  "action": "REQUEST_AIRDROP | HOLD | LOG_STATUS",
  "reasoning": "short explanation"
}
```

Execution flow:
1. Load agent context (wallet address, current balance, thresholds, cooldown state).
2. Apply deterministic rules first.
3. If rules are inconclusive and AI is enabled, call provider model.
4. Validate action against allowed enum.
5. Execute wallet action if required.
6. Post result and reasoning to Telegram.

## Security and Key Handling Rules
- Never hardcode API keys or private keys in source files.
- Keep `.env` out of git; commit only `.env.example`.
- Treat all private keys as secrets even on devnet.
- Validate destination addresses before transfers.
- Respect faucet cooldown/backoff and action limits.
- Log decisions and transaction signatures for auditability.

## Required Environment Variables
Minimum runtime secrets/config:
- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `MISTRAL_API_KEY`

Common feature flags:
- `MULTI_AGENT_AI_ENABLED`
- `AUTONOMOUS_AI_ENABLED`
- `MULTI_AGENT_AIRDROP_ENABLED`
- `AUTONOMOUS_AIRDROP_ENABLED`
- `MULTI_AGENT_CYCLES`

Webhook deployment (Render web service mode):
- `TELEGRAM_USE_WEBHOOK`
- `TELEGRAM_WEBHOOK_URL`
- `TELEGRAM_WEBHOOK_PATH`
- `PORT`

## File Map for Agents and Integrators
- `src/wallet/AgenticWallet.ts` - wallet primitives and transaction operations.
- `src/agent/WalletAgent.ts` - wallet-agent execution bridge.
- `src/agent/multiAgent.ts` - three-agent orchestration, provider routing, Telegram command handling.
- `src/agent/autonomous.ts` - standalone autonomous runtime.
- `src/dapp/TestDApp.ts` - test protocol/dApp interaction example.
- `src/telegram/bot.ts` - Telegram conversational bot runtime.

## Operational Constraints
- Devnet-only prototype for bounty demonstration.
- Faucet reliability/rate limits can temporarily block airdrops.
- AI providers may rate-limit on free tiers; decision flow must remain functional with rules-only fallback.
