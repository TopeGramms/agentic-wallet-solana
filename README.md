# Agentic Wallet Solana (Gemini + Telegram)

AI wallet agents on Solana Devnet using:
- `@google/generative-ai`
- `@solana/web3.js`
- `node-telegram-bot-api`

This repo includes:
- A Telegram wallet bot (`src/telegram/bot.ts`)
- A single autonomous agent (`src/agent/autonomous.ts`)
- A multi-agent simulation (`src/agent/multiAgent.ts`)

## Requirements
- Node.js 18+
- npm
- Gemini API key
- Telegram bot token

## Install
```bash
npm install
```

## Environment
Copy and fill env values:
```bash
cp .env.example .env
```

Required variables:
```env
TELEGRAM_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_numeric_chat_id_here
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
WALLET_PRIVATE_KEY=your_base58_private_key_here_or_leave_blank_to_generate
```

Notes:
- `TELEGRAM_CHAT_ID` is required for autonomous and multi-agent notification mode.
- For direct chat ID discovery, send `/start` to your bot first, then inspect updates:
```bash
curl "https://api.telegram.org/bot<TELEGRAM_TOKEN>/getUpdates"
```

## Run
Main demo:
```bash
npm start
```

Telegram wallet bot:
```bash
npx ts-node src/telegram/bot.ts
```

Autonomous agent:
```bash
npx ts-node src/agent/autonomous.ts
```

Multi-agent simulation:
```bash
npx ts-node src/agent/multiAgent.ts
```

## Build and Test
```bash
npm run build
npm test
```

## Security
- Never commit `.env`.
- `.env` is ignored by git; only `.env.example` should be tracked.
- If any secret was ever committed, rotate it immediately (Gemini key, Telegram token).

## Project Structure
```text
src/
  agent/
    WalletAgent.ts
    autonomous.ts
    multiAgent.ts
  telegram/
    bot.ts
  wallet/
    AgenticWallet.ts
  dapp/
    TestDApp.ts
  index.ts
tests/
```

## License
MIT
