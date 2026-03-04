import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";
import MiscPlugin from "@solana-agent-kit/plugin-misc";
import { Keypair, Connection, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from "node-telegram-bot-api";
import bs58 from "bs58";
import * as dotenv from "dotenv";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// ─── Agent personalities / goals ──────────────────────────────────────────
const AGENTS = [
  {
    id: "Agent-Alpha",
    goal: "Maintain a healthy SOL balance above 0.5 SOL at all times",
    emoji: "🔵",
  },
  {
    id: "Agent-Beta",
    goal: "Monitor wallet and log status every cycle without taking risky actions",
    emoji: "🟢",
  },
  {
    id: "Agent-Gamma",
    goal: "Be conservative - only act when balance drops below 0.2 SOL",
    emoji: "🟡",
  },
];

async function notifyTelegram(message: string): Promise<void> {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("Telegram error:", e);
  }
}

// ─── Single agent tick ────────────────────────────────────────────────────
async function agentTick(
  agentConfig: typeof AGENTS[0],
  keypair: Keypair,
  connection: Connection,
  cycleCount: number
): Promise<void> {
  const balance = (await connection.getBalance(keypair.publicKey)) / LAMPORTS_PER_SOL;

  const prompt = `You are ${agentConfig.id}, an autonomous Solana wallet agent.
Your goal: ${agentConfig.goal}
Current balance: ${balance} SOL
Cycle: #${cycleCount}

Respond ONLY with JSON:
{
  "action": "REQUEST_AIRDROP or HOLD or LOG_STATUS",
  "reasoning": "brief reason"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  let action = "HOLD";
  let reasoning = "Default hold";

  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    action = parsed.action;
    reasoning = parsed.reasoning;
  }

  // Execute
  let actionResult = "";
  if (action === "REQUEST_AIRDROP") {
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      actionResult = `Airdrop successful!`;
    } catch (e) {
      actionResult = `Airdrop failed: ${(e as Error).message}`;
    }
  } else {
    actionResult = action === "LOG_STATUS" ? `Balance logged: ${balance} SOL` : "Holding position";
  }

  // Report to Telegram
  await notifyTelegram(
    `${agentConfig.emoji} *${agentConfig.id}* — Cycle #${cycleCount}\n` +
    `🎯 Goal: ${agentConfig.goal}\n` +
    `💰 Balance: ${balance} SOL\n` +
    `🧠 Decision: ${action}\n` +
    `💭 Reason: ${reasoning}\n` +
    `📋 Result: ${actionResult}`
  );

  console.log(`${agentConfig.emoji} ${agentConfig.id}: ${action} — ${reasoning}`);
}

// ─── Run all agents ────────────────────────────────────────────────────────
async function runMultiAgent(): Promise<void> {
  console.log("🤖 Starting Multi-Agent System...");

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Create a wallet for each agent
  const agentWallets = AGENTS.map(() => Keypair.generate());

  await notifyTelegram(
    `🚀 *Multi-Agent System Started!*\n\n` +
    AGENTS.map((a, i) =>
      `${a.emoji} *${a.id}*\n` +
      `📍 \`${agentWallets[i].publicKey.toBase58()}\`\n` +
      `🎯 ${a.goal}`
    ).join("\n\n") +
    `\n\n_3 agents running independently on Solana Devnet!_`
  );

  let cycleCount = 0;

  while (cycleCount < 20) {
    cycleCount++;
    console.log(`\n🔄 === Cycle ${cycleCount} ===`);

    // Run all agents in parallel
    await Promise.all(
      AGENTS.map((agentConfig, i) =>
        agentTick(agentConfig, agentWallets[i], connection, cycleCount)
          .catch(e => console.error(`${agentConfig.id} error:`, e))
      )
    );

    console.log(`⏳ Waiting ${CHECK_INTERVAL_MS / 1000}s...`);
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
  }

  await notifyTelegram("🏁 *Multi-agent session complete!* All agents finished their cycles.");
}

runMultiAgent().catch(console.error);
