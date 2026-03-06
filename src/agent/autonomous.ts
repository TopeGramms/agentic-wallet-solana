import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";

dotenv.config();

// ----- Types -----
type AgentAction = "REQUEST_AIRDROP" | "HOLD" | "LOG_STATUS";

type Decision = {
  action: AgentAction;
  reasoning: string;
};

// ----- Runtime Config -----
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const AIRDROP_SOL = 1;

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

// ----- Service Clients -----
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const wallet = Keypair.generate();
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
const model = new GoogleGenerativeAI(GEMINI_API_KEY).getGenerativeModel({ model: GEMINI_MODEL });
const actionHistory: string[] = [];

// ----- Notifications -----
async function notifyTelegram(message: string): Promise<void> {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message);
  } catch (error) {
    const telegramDescription =
      (error as { response?: { body?: { description?: string } } }).response?.body
        ?.description || (error as Error).message;

    if (telegramDescription.toLowerCase().includes("chat not found")) {
      console.error(
        "Telegram notification failed: chat not found. Set TELEGRAM_CHAT_ID to a valid chat ID and send /start to the bot first."
      );
      return;
    }

    console.error("Telegram notification failed:", telegramDescription);
  }
}

// ----- Decision Engine -----
function parseDecision(text: string): Decision {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      action: "HOLD",
      reasoning: "Model response was not valid JSON. Defaulting to HOLD.",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string;
      reasoning?: string;
    };

    const action = parsed.action?.toUpperCase();
    if (action === "REQUEST_AIRDROP" || action === "HOLD" || action === "LOG_STATUS") {
      return {
        action,
        reasoning: parsed.reasoning?.trim() || "No reasoning provided.",
      };
    }
  } catch {
    return {
      action: "HOLD",
      reasoning: "Model JSON parse failed. Defaulting to HOLD.",
    };
  }

  return {
    action: "HOLD",
    reasoning: "Unsupported action from model. Defaulting to HOLD.",
  };
}

async function decideNextAction(balanceSol: number): Promise<Decision> {
  const prompt = [
    "You are an autonomous Solana Devnet wallet agent.",
    `Wallet address: ${wallet.publicKey.toBase58()}`,
    `Current balance: ${balanceSol} SOL`,
    "Allowed actions: REQUEST_AIRDROP, HOLD, LOG_STATUS.",
    "Choose one action only.",
    "Rules:",
    "- If balance is low (< 1 SOL), prefer REQUEST_AIRDROP.",
    "- If balance is healthy, prefer HOLD or LOG_STATUS.",
    "- Be conservative.",
    `Recent history: ${actionHistory.slice(-5).join(" | ") || "none"}`,
    'Return JSON only: {"action":"REQUEST_AIRDROP|HOLD|LOG_STATUS","reasoning":"..."}',
  ].join("\n");

  const result = await model.generateContent(prompt);
  return parseDecision(result.response.text().trim());
}

// ----- Action Executor -----
async function executeDecision(action: AgentAction, balanceSol: number): Promise<string> {
  switch (action) {
    case "REQUEST_AIRDROP": {
      const signature = await connection.requestAirdrop(
        wallet.publicKey,
        AIRDROP_SOL * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature, "confirmed");
      return `Requested ${AIRDROP_SOL} SOL airdrop. Tx: ${signature}`;
    }
    case "LOG_STATUS":
      return `Status logged. Current balance: ${balanceSol} SOL`;
    case "HOLD":
    default:
      return "Holding. No transaction executed.";
  }
}

// ----- Loop Utilities -----
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----- Main Autonomous Loop -----
async function runAutonomousAgent(): Promise<void> {
  await notifyTelegram(
    [
      "Autonomous wallet agent started.",
      `Wallet: ${wallet.publicKey.toBase58()}`,
      "Network: Solana Devnet",
      `Check interval: ${CHECK_INTERVAL_MS / 60000} minutes`,
      `Model: ${GEMINI_MODEL}`,
    ].join("\n")
  );

  let cycle = 0;
  while (true) {
    try {
      cycle += 1;

      const lamports = await connection.getBalance(wallet.publicKey, "confirmed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      const decision = await decideNextAction(balanceSol);
      const result = await executeDecision(decision.action, balanceSol);

      const updatedLamports = await connection.getBalance(wallet.publicKey, "confirmed");
      const updatedBalanceSol = updatedLamports / LAMPORTS_PER_SOL;

      const historyEntry = `${new Date().toISOString()} | ${decision.action} | ${decision.reasoning}`;
      actionHistory.push(historyEntry);
      if (actionHistory.length > 25) actionHistory.shift();

      await notifyTelegram(
        [
          `Cycle #${cycle}`,
          `Decision: ${decision.action}`,
          `Reasoning: ${decision.reasoning}`,
          `Result: ${result}`,
          `Balance: ${updatedBalanceSol} SOL`,
        ].join("\n")
      );
    } catch (error) {
      await notifyTelegram(`Agent error: ${(error as Error).message}`);
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}

// ----- Entrypoint -----
runAutonomousAgent().catch(async (error) => {
  const message = `Fatal autonomous agent error: ${(error as Error).message}`;
  console.error(message);
  await notifyTelegram(message);
  process.exit(1);
});
