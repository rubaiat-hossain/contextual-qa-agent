import { config } from "dotenv";
config();

import express, { Request, Response } from "express";
import Groq from "groq-sdk";
import { randomUUID } from "crypto";
// @ts-ignore
import { ChromaClient } from "chromadb";

// Initialize Express
const app = express();
app.use(express.json());

// Initialize ChromaDB client (server mode)
const chroma = new ChromaClient({ path: "http://localhost:8000" }); // correct path!
let collection: Awaited<ReturnType<ChromaClient["getOrCreateCollection"]>>;

// Global Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://groq.helicone.ai",
  defaultHeaders: {
    "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY ?? ""}`,
  },
});

// Helper: Get current time
function getCurrentTime(): string {
  return new Date().toISOString();
}

// Helper: Log tool use manually to Helicone
async function logTool(
  toolName: string,
  input: Record<string, any>,
  output: Record<string, any>,
  sessionId: string,
  sessionPath: string,
  sessionName: string
): Promise<void> {
  await groq.chat.completions.create(
    {
      messages: [
        {
          role: "user",
          content: `Tool: ${toolName}\nInput: ${JSON.stringify(input)}\nOutput: ${JSON.stringify(output)}`,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0,
      max_tokens: 5,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": sessionPath,
        "Helicone-Session-Name": sessionName,
        "Helicone-Property-ToolName": toolName,
        "Helicone-Property-ToolType": toolName.includes("Retrieval") ? "retrieval" : "function",
      },
    }
  );
}

// Seed ChromaDB with knowledge if empty
async function seedKnowledgeBase() {
  collection = await chroma.getOrCreateCollection({ name: "knowledge" });

  const count = await collection.count();
  if (count === 0) {
    console.log("📚 Seeding ChromaDB knowledge base...");
    await collection.add({
      ids: ["ai", "helicone", "rag", "observability", "mcp", "llmops"],
      metadatas: [
        { topic: "AI" },
        { topic: "Helicone" },
        { topic: "RAG" },
        { topic: "Observability" },
        { topic: "Model Context Protocol" },
        { topic: "LLMOps" },
      ],
      documents: [
        "Artificial Intelligence (AI) is the simulation of human-like intelligence by machines to perform tasks like learning, reasoning, and problem-solving.",
        "Helicone is a developer platform for monitoring and debugging AI agents and LLM applications. It provides observability into prompts, costs, latency, and session flows.",
        "Retrieval-Augmented Generation (RAG) is an AI framework that retrieves external information and injects it into the prompt for better, more factual responses.",
        "Observability in AI refers to the practice of understanding, monitoring, and debugging model behavior by tracking key metrics like latency, cost, token usage, and session traces.",
        "Model Context Protocol (MCP) allows AI agents to connect external tools, APIs, or services dynamically at runtime using a standard protocol for enhanced capabilities.",
        "LLMOps refers to operational practices around managing, monitoring, scaling, and debugging large language models in production environments.",
      ],
    });
    
    console.log("✅ Knowledge base seeded.");
  }
}

// Main Multi-Step Agent
async function processMultiStepQuery(text: string): Promise<string> {
  const sessionId = randomUUID();
  const sessionName = "Multi-Step RAG Agent";

  console.log(`🚀 New Query: "${text}"`);

  // Step 1: Classify
  const classify = await groq.chat.completions.create(
    {
      messages: [
        { role: "system", content: "Respond ONLY with 'question' or 'general'." },
        { role: "user", content: `Classify: "${text}"` },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 10,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/classify",
        "Helicone-Session-Name": sessionName,
      },
    }
  );

  const classification = classify.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "general";

  // Step 2: Retrieval or Tool Use
  let context = "";

  if (classification.includes("question")) {
    const results = await collection.query({
      queryTexts: [text],
      nResults: 1,
    });

    context = results.documents?.[0]?.[0] ?? "No relevant knowledge found.";
    await logTool("ChromaDBRetrieval", { query: text }, { result: context }, sessionId, "/knowledge-retrieval", sessionName);
  } else {
    const time = getCurrentTime();
    context = `Current time is ${time}`;
    await logTool("GetCurrentTime", {}, { time }, sessionId, "/tool-execution", sessionName);
  }

  // Step 3: Reasoning
  const reasoning = await groq.chat.completions.create(
    {
      messages: [
        { role: "system", content: "You are a reasoning assistant." },
        { role: "user", content: `Context: "${context}". Reason about how to answer "${text}".` },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 200,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/reasoning",
        "Helicone-Session-Name": sessionName,
      },
    }
  );

  const reasoningOutput = reasoning.choices?.[0]?.message?.content ?? "";

  // Step 4: Final Output
  const finalReply = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "system",
          content: `Friendly assistant.\nContext: "${context}".\nReasoning: "${reasoningOutput}".`,
        },
        { role: "user", content: text },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.5,
      max_tokens: 500,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/final-response",
        "Helicone-Session-Name": sessionName,
      },
    }
  );

  return finalReply.choices?.[0]?.message?.content ?? "No final response.";
}

// Express Routes
app.post("/analyze", async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: "Missing text" });
    return;
  }

  try {
    const result = await processMultiStepQuery(text);
    res.json({ response: result });
  } catch (err: unknown) {
    console.error("API Error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal Server Error" });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start Server
const PORT = process.env.PORT || 3000;
seedKnowledgeBase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`POST /analyze {"text": "your question"}`);
  });
});
