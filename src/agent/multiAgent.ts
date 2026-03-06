import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";

dotenv.config();

// ----- Types -----
type AgentAction = "REQUEST_AIRDROP" | "HOLD" | "LOG_STATUS";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ----- Environment -----
const TELEGRAM_TOKEN = requireEnv("TELEGRAM_TOKEN");
const TELEGRAM_CHAT_ID = requireEnv("TELEGRAM_CHAT_ID");
const GEMINI_API_KEY = requireEnv("GEMINI_API_KEY");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const CHECK_INTERVAL_MS = 3 * 60 * 1000;

// ----- Agent Definitions -----
const AGENTS = [
  {
    id: "Agent-Alpha",
    goal: "Maintain a healthy SOL balance above 0.5 SOL at all times",
    emoji: "ALPHA",
  },
  {
    id: "Agent-Beta",
    goal: "Monitor wallet and log status every cycle without taking risky actions",
    emoji: "BETA",
  },
  {
    id: "Agent-Gamma",
    goal: "Be conservative - only act when balance drops below 0.2 SOL",
    emoji: "GAMMA",
  },
];

// ----- Service Clients -----
const model = new GoogleGenerativeAI(GEMINI_API_KEY).getGenerativeModel({ model: GEMINI_MODEL });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// ----- Notifications -----
async function notifyTelegram(message: string): Promise<void> {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message);
  } catch (error) {
    console.error("Telegram error:", (error as Error).message);
  }
}

// ----- Decision Utilities -----
function parseAction(raw: string | undefined): AgentAction {
  const value = (raw || "").toUpperCase();
  if (value === "REQUEST_AIRDROP" || value === "LOG_STATUS") return value;
  return "HOLD";
}

// ----- Per-Agent Cycle -----
async function agentTick(
  agentConfig: (typeof AGENTS)[number],
  keypair: Keypair,
  connection: Connection,
  cycleCount: number
): Promise<void> {
  const balance = (await connection.getBalance(keypair.publicKey, "confirmed")) / LAMPORTS_PER_SOL;

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

  let action: AgentAction = "HOLD";
  let reasoning = "Default hold";

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { action?: string; reasoning?: string };
      action = parseAction(parsed.action);
      reasoning = parsed.reasoning || reasoning;
    } catch {
      action = "HOLD";
    }
  }

  let actionResult = "";
  if (action === "REQUEST_AIRDROP") {
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      actionResult = "Airdrop successful";
    } catch (error) {
      actionResult = `Airdrop failed: ${(error as Error).message}`;
    }
  } else {
    actionResult = action === "LOG_STATUS" ? `Balance logged: ${balance} SOL` : "Holding position";
  }

  await notifyTelegram(
    `${agentConfig.emoji} ${agentConfig.id} - Cycle #${cycleCount}\n` +
      `Goal: ${agentConfig.goal}\n` +
      `Balance: ${balance} SOL\n` +
      `Decision: ${action}\n` +
      `Reason: ${reasoning}\n` +
      `Result: ${actionResult}`
  );
}

// ----- Main Multi-Agent Loop -----
async function runMultiAgent(): Promise<void> {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const agentWallets = AGENTS.map(() => Keypair.generate());

  await notifyTelegram(
    "Multi-agent system started.\n\n" +
      AGENTS.map(
        (agent, i) =>
          `${agent.emoji} ${agent.id}\nWallet: ${agentWallets[i].publicKey.toBase58()}\nGoal: ${agent.goal}`
      ).join("\n\n")
  );

  for (let cycleCount = 1; cycleCount <= 20; cycleCount += 1) {
    await Promise.all(
      AGENTS.map((agentConfig, i) =>
        agentTick(agentConfig, agentWallets[i], connection, cycleCount).catch((error) =>
          console.error(`${agentConfig.id} error:`, (error as Error).message)
        )
      )
    );

    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
  }

  await notifyTelegram("Multi-agent session complete.");
}

// ----- Entrypoint -----
runMultiAgent().catch((error) => console.error("Fatal multi-agent error:", (error as Error).message));
