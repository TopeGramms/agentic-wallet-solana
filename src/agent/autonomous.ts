import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";

dotenv.config();

// ----- Types -----
type AgentAction = "REQUEST_AIRDROP" | "HOLD" | "LOG_STATUS";

type Decision = {
  action: AgentAction;
  reasoning: string;
};

type RuntimeConfig = {
  telegramToken: string;
  telegramChatId: string;
  geminiApiKey: string;
  geminiModel: string;
};

// ----- Runtime Config -----
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const AIRDROP_SOL = 1;
const MODEL_FALLBACKS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
];

// ----- Environment -----
function getEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function cleanChatId(chatId: string): string {
  return chatId.replace(/^['"]|['"]$/g, "").trim();
}

function loadRuntimeConfig(): RuntimeConfig {
  const telegramToken = getEnv("TELEGRAM_TOKEN", "TELEGRAM_BOT_TOKEN");
  const telegramChatIdRaw = getEnv("TELEGRAM_CHAT_ID");
  const geminiApiKey = getEnv("GEMINI_API_KEY");
  const geminiModel = getEnv("GEMINI_MODEL") || "gemini-2.5-flash-lite";

  const missing: string[] = [];
  if (!telegramToken) missing.push("TELEGRAM_TOKEN (or TELEGRAM_BOT_TOKEN)");
  if (!telegramChatIdRaw) missing.push("TELEGRAM_CHAT_ID");
  if (!geminiApiKey) missing.push("GEMINI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        "Set them in shell env or in a local .env file (never commit .env)."
    );
  }

  const safeTelegramToken = telegramToken as string;
  const safeTelegramChatIdRaw = telegramChatIdRaw as string;
  const safeGeminiApiKey = geminiApiKey as string;

  return {
    telegramToken: safeTelegramToken,
    telegramChatId: cleanChatId(safeTelegramChatIdRaw),
    geminiApiKey: safeGeminiApiKey,
    geminiModel,
  };
}

// ----- Notifications -----
async function notifyTelegram(
  bot: TelegramBot,
  telegramChatId: string,
  message: string
): Promise<void> {
  try {
    await bot.sendMessage(telegramChatId, message);
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

// ----- Gemini Model Resolver -----
async function resolveModel(
  geminiApiKey: string,
  preferredModel: string
): Promise<{ model: GenerativeModel; activeModelName: string }> {
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const candidates = Array.from(new Set([preferredModel, ...MODEL_FALLBACKS]));

  for (const name of candidates) {
    try {
      const model = genAI.getGenerativeModel({ model: name });
      await model.generateContent("Reply with exactly: OK");
      return { model, activeModelName: name };
    } catch (error) {
      const msg = (error as Error).message || "";
      const nonFatalModelError =
        msg.includes("not found") ||
        msg.includes("not supported") ||
        msg.includes("quota") ||
        msg.includes("429");
      if (!nonFatalModelError) {
        throw error;
      }
    }
  }

  throw new Error(
    `Unable to initialize a working Gemini model. Tried: ${candidates.join(", ")}`
  );
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

async function decideNextAction(
  model: GenerativeModel,
  walletAddress: string,
  balanceSol: number,
  actionHistory: string[]
): Promise<Decision> {
  const prompt = [
    "You are an autonomous Solana Devnet wallet agent.",
    `Wallet address: ${walletAddress}`,
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
async function executeDecision(
  connection: Connection,
  wallet: Keypair,
  action: AgentAction,
  balanceSol: number
): Promise<string> {
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
  const config = loadRuntimeConfig();
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = Keypair.generate();
  const bot = new TelegramBot(config.telegramToken, { polling: false });
  const actionHistory: string[] = [];

  const { model, activeModelName } = await resolveModel(
    config.geminiApiKey,
    config.geminiModel
  );

  await notifyTelegram(
    bot,
    config.telegramChatId,
    [
      "Autonomous wallet agent started.",
      `Wallet: ${wallet.publicKey.toBase58()}`,
      "Network: Solana Devnet",
      `Check interval: ${CHECK_INTERVAL_MS / 60000} minutes`,
      `Model: ${activeModelName}`,
    ].join("\n")
  );

  let cycle = 0;
  while (true) {
    try {
      cycle += 1;

      const lamports = await connection.getBalance(wallet.publicKey, "confirmed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      const decision = await decideNextAction(
        model,
        wallet.publicKey.toBase58(),
        balanceSol,
        actionHistory
      );
      const result = await executeDecision(connection, wallet, decision.action, balanceSol);

      const updatedLamports = await connection.getBalance(wallet.publicKey, "confirmed");
      const updatedBalanceSol = updatedLamports / LAMPORTS_PER_SOL;

      const historyEntry = `${new Date().toISOString()} | ${decision.action} | ${decision.reasoning}`;
      actionHistory.push(historyEntry);
      if (actionHistory.length > 25) actionHistory.shift();

      await notifyTelegram(
        bot,
        config.telegramChatId,
        [
          `Cycle #${cycle}`,
          `Decision: ${decision.action}`,
          `Reasoning: ${decision.reasoning}`,
          `Result: ${result}`,
          `Balance: ${updatedBalanceSol} SOL`,
        ].join("\n")
      );
    } catch (error) {
      await notifyTelegram(
        bot,
        config.telegramChatId,
        `Agent error: ${(error as Error).message}`
      );
    }

    await sleep(CHECK_INTERVAL_MS);
  }
}

// ----- Entrypoint -----
runAutonomousAgent().catch((error) => {
  console.error(`Fatal autonomous agent error: ${(error as Error).message}`);
  process.exit(1);
});
