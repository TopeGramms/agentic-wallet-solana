# 🤖 Agentic Wallet for AI Agents — Solana Devnet

> Built for the **Superteam Nigeria DeFi Developer Challenge**

An autonomous wallet system that allows AI agents to programmatically create wallets, sign transactions, hold SOL/SPL tokens, and interact with DeFi protocols on Solana — all without human intervention.

---

## ✨ Features

- ✅ **Programmatic wallet creation** — generate Solana keypairs on the fly
- ✅ **Autonomous transaction signing** — AI agent signs & sends transactions
- ✅ **SOL & SPL token support** — hold and transfer any Solana token
- ✅ **dApp interaction** — connect and interact with test protocols
- ✅ **AI-powered agent loop** — Claude AI drives all wallet decisions
- ✅ **Devnet ready** — full prototype running on Solana devnet

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│              AI Agent (Claude)           │
│  - Receives natural language instructions│
│  - Decides which wallet tools to call    │
│  - Autonomous agentic loop               │
└────────────────┬────────────────────────┘
                 │ Tool calls
┌────────────────▼────────────────────────┐
│           AgenticWallet Core             │
│  - Keypair generation & management       │
│  - SOL transfers                         │
│  - SPL token transfers                   │
│  - Balance queries                       │
└────────────────┬────────────────────────┘
                 │ Transactions
┌────────────────▼────────────────────────┐
│         Solana Devnet Network            │
│  - Transaction confirmation              │
│  - dApp/Protocol interaction             │
└─────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- npm or yarn
- Anthropic API key

### Installation

```bash
git clone https://github.com/yourusername/agentic-wallet-solana
cd agentic-wallet-solana
npm install
```

### Environment Setup

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
WALLET_PRIVATE_KEY=  # leave blank to auto-generate
```

### Run the Demo

```bash
npm start
```

---

## 🧠 How It Works

1. **Wallet Creation** — A Solana keypair is generated programmatically
2. **Funding** — On devnet, SOL is acquired via faucet airdrop
3. **Agent Instruction** — You give the AI agent a natural language instruction
4. **Tool Execution** — The agent autonomously selects and calls wallet tools
5. **Transaction** — Transactions are signed and submitted to Solana devnet
6. **Confirmation** — Results are returned to the agent for next decision

---

## 📁 Project Structure

```
agentic-wallet/
├── src/
│   ├── wallet/
│   │   └── AgenticWallet.ts    # Core wallet logic
│   ├── agent/
│   │   └── WalletAgent.ts      # AI agent + tool definitions
│   ├── dapp/
│   │   └── TestDApp.ts         # dApp interaction layer
│   └── index.ts                # Entry point / demo
├── tests/
│   └── test.ts                 # Test suite
├── SKILLS.md                   # Agent-readable skills file
├── .env.example
├── package.json
└── README.md
```

---

## 🔐 Security Considerations

- Private keys are **never** hardcoded — always loaded from `.env`
- The agent operates within defined tool boundaries only
- All transactions require explicit tool invocation (no arbitrary code execution)
- Rate limiting and amount caps can be configured
- Operates on **devnet only** by default — mainnet requires explicit config change

---

## 🧪 Testing

```bash
npm test
```

---

## 🌐 View on Explorer

After running, check your transactions at:
```
https://explorer.solana.com/address/<YOUR_WALLET_PUBLIC_KEY>?cluster=devnet
```

---

## 📄 License

MIT — open source as required by the bounty.

---

## 👤 Author

Built for Superteam Nigeria — DeFi Developer Challenge 2026
