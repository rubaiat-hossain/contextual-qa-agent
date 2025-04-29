import { config } from "dotenv";
config();

import express, { Request, Response } from "express";
import Groq from "groq-sdk";
import { randomUUID } from "crypto";
// @ts-ignore
import { ChromaClient } from "chromadb";
import { HeliconeManualLogger } from "@helicone/helpers";

const app = express();
app.use(express.json());

const chroma = new ChromaClient({ path: "http://localhost:8000" });
let collection: Awaited<ReturnType<ChromaClient["getOrCreateCollection"]>>;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://groq.helicone.ai",
  defaultHeaders: {
    "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY ?? ""}`,
  },
});

const heliconeLogger = new HeliconeManualLogger({
  apiKey: process.env.HELICONE_API_KEY,
});

async function getCurrentTime(sessionId: string, sessionName: string): Promise<string> {
  try {
    const timestamp = await heliconeLogger.logRequest(
      {
        _type: "tool",
        toolName: "getCurrentTime",
        input: {},
      },
      async (recorder) => {
        const now = new Date().toISOString();
        recorder.appendResults({ time: now });
        return now;
      },
      {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/manual-tool-log",
        "Helicone-Session-Name": sessionName,
      }
    );
    return timestamp;
  } catch (error) {
    console.error("Error in getCurrentTime tool:", error);
    throw error;
  }
}

async function retrieveFromChromaDB(query: string, sessionId: string, sessionName: string): Promise<string> {
  try {
    const document = await heliconeLogger.logRequest(
      {
        _type: "tool",
        toolName: "ChromaDBRetrieval",
        input: { query },
      },
      async (recorder) => {
        const results = await collection.query({
          queryTexts: [query],
          nResults: 1,
        });
        
        const retrievedDoc = results.documents?.[0]?.[0] ?? "No relevant knowledge found.";
        recorder.appendResults({ document: retrievedDoc });
        return retrievedDoc;
      },
      {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/knowledge-retrieval",
        "Helicone-Session-Name": sessionName,
      }
    );
    return document;
  } catch (error) {
    console.error("Error in ChromaDBRetrieval tool:", error);
    throw error;
  }
}

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

async function processMultiStepQuery(text: string): Promise<string> {
  const sessionId = randomUUID();
  const sessionName = "Multi-Step RAG Agent";
  const isTimeQuestion = /\b(what\s+time\s+is\s+it|current\s+time|time\s+now)\b/i.test(text);
  let context = "";

  if (isTimeQuestion) {
    const timestamp = await getCurrentTime(sessionId, sessionName);
    context = `Current time is ${timestamp}`;    
  } else {
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

    if (classification.includes("question")) {
      context = await retrieveFromChromaDB(text, sessionId, sessionName);
    } else {
      const timestamp = await getCurrentTime(sessionId, sessionName);
      context = `Current time is ${timestamp}`;
    }
  }

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

const PORT = process.env.PORT || 3000;
seedKnowledgeBase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`POST /analyze {"text": "your question"}`);
  });
});