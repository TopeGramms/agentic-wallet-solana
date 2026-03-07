import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";

dotenv.config();

// ----- Types -----
type AgentAction = "REQUEST_AIRDROP" | "HOLD" | "LOG_STATUS";
type DecisionSource = "RULES" | "AI" | "CACHE";

type Decision = {
  action: AgentAction;
  reasoning: string;
};

type RuntimeConfig = {
  telegramToken: string;
  telegramChatId: string;
  geminiApiKey: string;
  geminiModel: string;
  checkIntervalMs: number;
  lowBalanceSol: number;
  healthyBalanceSol: number;
  logStatusEveryCycles: number;
  airdropEnabled: boolean;
  airdropCooldownMs: number;
  aiMinIntervalMs: number;
  aiMinBalanceDeltaSol: number;
  aiEnabled: boolean;
  aiMaxCallsPerRun: number;
};

// ----- Runtime Defaults -----
const AIRDROP_SOL = 1;
const MODEL_FALLBACKS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
];

// ----- Environment Helpers -----
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

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnvInteger(name: string, fallback: number): number {
  return Math.floor(parseEnvNumber(name, fallback));
}

function parseEnvBoolean(name: string, fallback: boolean): boolean {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function loadRuntimeConfig(): RuntimeConfig {
  const telegramToken = getEnv("TELEGRAM_TOKEN", "TELEGRAM_BOT_TOKEN");
  const telegramChatIdRaw = getEnv("TELEGRAM_CHAT_ID");
  const geminiApiKey = getEnv("GEMINI_API_KEY");
  const geminiModel = getEnv("GEMINI_MODEL") || "gemini-2.5-flash-lite";
  const aiEnabled = parseEnvBoolean("AUTONOMOUS_AI_ENABLED", true);
  const aiMaxCallsPerRun = Math.max(0, parseEnvInteger("AUTONOMOUS_AI_MAX_CALLS_PER_RUN", 10));

  const missing: string[] = [];
  if (!telegramToken) missing.push("TELEGRAM_TOKEN (or TELEGRAM_BOT_TOKEN)");
  if (!telegramChatIdRaw) missing.push("TELEGRAM_CHAT_ID");
  if (aiEnabled && aiMaxCallsPerRun > 0 && !geminiApiKey) missing.push("GEMINI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}.\n` +
        "Set them in shell env or in a local .env file (never commit .env)."
    );
  }

  return {
    telegramToken: telegramToken as string,
    telegramChatId: cleanChatId(telegramChatIdRaw as string),
    geminiApiKey: geminiApiKey || "",
    geminiModel,
    checkIntervalMs: parseEnvNumber("AUTONOMOUS_CHECK_INTERVAL_MINUTES", 15) * 60 * 1000,
    lowBalanceSol: parseEnvNumber("AUTONOMOUS_LOW_BALANCE_SOL", 0.8),
    healthyBalanceSol: parseEnvNumber("AUTONOMOUS_HEALTHY_BALANCE_SOL", 1.2),
    logStatusEveryCycles: parseEnvNumber("AUTONOMOUS_LOG_STATUS_EVERY_CYCLES", 4),
    airdropEnabled: parseEnvBoolean("AUTONOMOUS_AIRDROP_ENABLED", true),
    airdropCooldownMs: parseEnvNumber("AUTONOMOUS_AIRDROP_COOLDOWN_MINUTES", 60) * 60 * 1000,
    aiMinIntervalMs: parseEnvNumber("AUTONOMOUS_AI_MIN_INTERVAL_MINUTES", 30) * 60 * 1000,
    aiMinBalanceDeltaSol: parseEnvNumber("AUTONOMOUS_AI_MIN_BALANCE_DELTA_SOL", 0.25),
    aiEnabled,
    aiMaxCallsPerRun,
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
      if (!nonFatalModelError) throw error;
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

function getRuleBasedDecision(
  balanceSol: number,
  cycle: number,
  lastAirdropAtMs: number,
  config: RuntimeConfig
): Decision | null {
  const now = Date.now();

  if (balanceSol < config.lowBalanceSol) {
    if (now - lastAirdropAtMs >= config.airdropCooldownMs) {
      return {
        action: "REQUEST_AIRDROP",
        reasoning: `Balance (${balanceSol.toFixed(4)} SOL) is below ${config.lowBalanceSol} SOL.`,
      };
    }
    return {
      action: "HOLD",
      reasoning: "Balance is low but airdrop was requested recently. Cooling down.",
    };
  }

  if (balanceSol >= config.healthyBalanceSol) {
    if (cycle % config.logStatusEveryCycles === 0) {
      return {
        action: "LOG_STATUS",
        reasoning: `Balance is healthy (${balanceSol.toFixed(4)} SOL). Periodic status log.`,
      };
    }
    return {
      action: "HOLD",
      reasoning: `Balance is healthy (${balanceSol.toFixed(4)} SOL).`,
    };
  }

  return null;
}

function shouldReuseAiDecision(
  balanceSol: number,
  lastAiAtMs: number,
  lastAiBalanceSol: number | null,
  config: RuntimeConfig
): boolean {
  if (!lastAiAtMs || lastAiBalanceSol === null) return false;
  const recent = Date.now() - lastAiAtMs < config.aiMinIntervalMs;
  const smallDelta = Math.abs(balanceSol - lastAiBalanceSol) < config.aiMinBalanceDeltaSol;
  return recent && smallDelta;
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

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 100, temperature: 0.1 },
  });
  return parseDecision(result.response.text().trim());
}

// ----- Action Executor -----
async function executeDecision(
  connection: Connection,
  wallet: Keypair,
  action: AgentAction,
  balanceSol: number,
  airdropEnabled: boolean
): Promise<string> {
  switch (action) {
    case "REQUEST_AIRDROP": {
      if (!airdropEnabled) {
        return "Airdrop disabled by config. Holding.";
      }
      try {
        const signature = await connection.requestAirdrop(
          wallet.publicKey,
          AIRDROP_SOL * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(signature, "confirmed");
        return `Requested ${AIRDROP_SOL} SOL airdrop. Tx: ${signature}`;
      } catch (error) {
        return `Airdrop failed: ${(error as Error).message}`;
      }
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

  let aiCallCount = 0;
  let lastAirdropAtMs = 0;
  let lastAiAtMs = 0;
  let lastAiBalanceSol: number | null = null;
  let cachedAiDecision: Decision | null = null;

  let model: GenerativeModel | null = null;
  let activeModelName = "disabled";

  if (config.aiEnabled && config.aiMaxCallsPerRun > 0) {
    const resolved = await resolveModel(config.geminiApiKey, config.geminiModel);
    model = resolved.model;
    activeModelName = resolved.activeModelName;
  }

  await notifyTelegram(
    bot,
    config.telegramChatId,
    [
      "Autonomous wallet agent started.",
      `Wallet: ${wallet.publicKey.toBase58()}`,
      "Network: Solana Devnet",
      `Check interval: ${Math.round(config.checkIntervalMs / 60000)} minutes`,
      `Model: ${activeModelName}`,
      "Decision mode: rules-first with AI fallback",
      `Airdrop enabled: ${config.airdropEnabled ? "yes" : "no"}`,
      `AI enabled: ${config.aiEnabled ? "yes" : "no"}`,
      `AI max calls per run: ${config.aiMaxCallsPerRun}`,
    ].join("\n")
  );

  let cycle = 0;
  while (true) {
    try {
      cycle += 1;

      const lamports = await connection.getBalance(wallet.publicKey, "confirmed");
      const balanceSol = lamports / LAMPORTS_PER_SOL;

      let decisionSource: DecisionSource = "RULES";
      let decision = getRuleBasedDecision(balanceSol, cycle, lastAirdropAtMs, config);

      if (!decision) {
        if (shouldReuseAiDecision(balanceSol, lastAiAtMs, lastAiBalanceSol, config) && cachedAiDecision) {
          decisionSource = "CACHE";
          decision = {
            action: cachedAiDecision.action,
            reasoning: `${cachedAiDecision.reasoning} (reused to save API quota)`,
          };
        } else if (model && config.aiEnabled && aiCallCount < config.aiMaxCallsPerRun) {
          decisionSource = "AI";
          decision = await decideNextAction(
            model,
            wallet.publicKey.toBase58(),
            balanceSol,
            actionHistory
          );
          aiCallCount += 1;
          lastAiAtMs = Date.now();
          lastAiBalanceSol = balanceSol;
          cachedAiDecision = decision;
        } else {
          decisionSource = "RULES";
          decision = {
            action: "HOLD",
            reasoning: "AI disabled or AI call budget exhausted. Holding for safety.",
          };
        }
      }

      const result = await executeDecision(
        connection,
        wallet,
        decision.action,
        balanceSol,
        config.airdropEnabled
      );
      if (decision.action === "REQUEST_AIRDROP" && !result.startsWith("Airdrop failed")) {
        lastAirdropAtMs = Date.now();
      }

      const updatedLamports = await connection.getBalance(wallet.publicKey, "confirmed");
      const updatedBalanceSol = updatedLamports / LAMPORTS_PER_SOL;

      const historyEntry = `${new Date().toISOString()} | ${decisionSource} | ${decision.action} | ${decision.reasoning}`;
      actionHistory.push(historyEntry);
      if (actionHistory.length > 25) actionHistory.shift();

      await notifyTelegram(
        bot,
        config.telegramChatId,
        [
          `Cycle #${cycle}`,
          `Source: ${decisionSource}`,
          `Decision: ${decision.action}`,
          `Reasoning: ${decision.reasoning}`,
          `Result: ${result}`,
          `Balance: ${updatedBalanceSol} SOL`,
          `AI calls so far: ${aiCallCount}`,
          `AI budget remaining: ${Math.max(0, config.aiMaxCallsPerRun - aiCallCount)}`,
        ].join("\n")
      );
    } catch (error) {
      await notifyTelegram(
        bot,
        config.telegramChatId,
        `Agent error: ${(error as Error).message}`
      );
    }

    await sleep(config.checkIntervalMs);
  }
}

// ----- Entrypoint -----
runAutonomousAgent().catch((error) => {
  console.error(`Fatal autonomous agent error: ${(error as Error).message}`);
  process.exit(1);
});
