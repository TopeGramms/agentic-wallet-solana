# SKILLS.md — Agentic Wallet for AI Agents

> This file is intended for AI agents to understand how to interact with this wallet system.

## Overview
This is an **agentic wallet** built on Solana (devnet) that allows AI agents to autonomously manage crypto assets, sign transactions, and interact with DeFi protocols.

---

## Available Tools / Actions

### 1. `get_balance`
Returns the current SOL balance of the wallet.
- **Input**: none
- **Output**: `{ balance: number }` in SOL

### 2. `send_sol`
Sends SOL to another wallet address.
- **Input**: `{ to_address: string, amount: number }`
- **Output**: `{ signature: string }`
- **Note**: Requires sufficient balance + gas fees (~0.000005 SOL)

### 3. `request_airdrop`
Requests a devnet airdrop. **Devnet only.**
- **Input**: `{ amount?: number }` (default: 1 SOL, max: 2 SOL)
- **Output**: `{ signature: string }`

### 4. `get_wallet_info`
Returns full wallet metadata.
- **Input**: none
- **Output**: `{ publicKey: string, balance: number }`

### 5. `get_spl_token_balance`
Gets the balance of an SPL token.
- **Input**: `{ mint_address: string }`
- **Output**: `{ balance: number }`

### 6. `send_spl_token`
Transfers SPL tokens to another address.
- **Input**: `{ mint_address: string, to_address: string, amount: number }`
- **Output**: `{ signature: string }`

---

## Security Constraints
- This wallet operates on **Solana Devnet only**
- Private keys are stored in `.env` and never exposed in responses
- The agent should always verify the recipient address before sending
- Maximum single transaction: 1 SOL (configurable)
- All transactions are logged with timestamps

---

## How to Invoke This Agent

```typescript
import { runWalletAgent } from "./src/agent/WalletAgent";
import { AgenticWallet } from "./src/wallet/AgenticWallet";

const wallet = AgenticWallet.fromPrivateKey(process.env.WALLET_PRIVATE_KEY!);
const result = await runWalletAgent("Send 0.1 SOL to <address>", wallet);
```

---

## Environment Variables Required
```
ANTHROPIC_API_KEY=your_anthropic_api_key
WALLET_PRIVATE_KEY=your_wallet_private_key (base58 encoded)
```

---

## Network
- **Chain**: Solana
- **Network**: Devnet
- **RPC**: https://api.devnet.solana.com
- **Explorer**: https://explorer.solana.com?cluster=devnet
