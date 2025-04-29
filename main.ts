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
    const startTime = Date.now();
    const now = new Date().toISOString();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localTime = new Date().toLocaleString();
    
    const toolOutput = {
      timestamp: now,
      metadata: {
        timezone: timezone,
        localTime: localTime,
        unix_timestamp: Math.floor(Date.now() / 1000),
        tool_version: "1.0.3",
        execution_duration_ms: Date.now() - startTime
      }
    };
    
    await groq.chat.completions.create(
      {
        messages: [
          {
            role: "user",
            content: `Tool: getCurrentTime\nInput: {}\nOutput: ${JSON.stringify(toolOutput, null, 2)}`,
          },
        ],
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0,
        max_tokens: 5,
      },
      {
        headers: {
          "Helicone-Session-Id": sessionId,
          "Helicone-Session-Path": "/manual-tool-log",
          "Helicone-Session-Name": sessionName,
          "Helicone-Property-ToolName": "getCurrentTime",
          "Helicone-Property-ToolType": "function",
          "Helicone-Property-QueryType": "time-request",
          "Helicone-Property-ToolInfo": "ISO timestamp generator",
          "Helicone-Property-ExecutionTime": now,
          "Helicone-Property-ExecutionDuration": `${Date.now() - startTime}ms`,
          "Helicone-Property-Timezone": timezone,
          "Helicone-Property-ToolVersion": "1.0.3"
        },
      }
    );
    
    return now;
  } catch (error) {
    console.error("Error in getCurrentTime tool:", error);
    throw error;
  }
}

async function retrieveFromChromaDB(query: string, sessionId: string, sessionName: string): Promise<string> {
  try {
    const startTime = Date.now();
    
    const results = await collection.query({
      queryTexts: [query],
      nResults: 3,
    });
    
    const matches = results.documents?.[0] || [];
    const distances = results.distances?.[0] || [];
    const ids = results.ids?.[0] || [];
    
    const document = matches[0] ?? "No relevant knowledge found.";
    
    const toolOutput = {
      document: document,
      metadata: {
        query: query,
        matches_count: matches.length,
        top_matches: matches.map((doc, i) => ({
          id: ids[i],
          text: doc,
          relevance_score: distances[i] ? (1 - distances[i]) : 0
        })),
        execution_duration_ms: Date.now() - startTime,
        db_name: "knowledge",
        tool_version: "1.0.3"
      }
    };
    
    await groq.chat.completions.create(
      {
        messages: [
          {
            role: "user",
            content: `Tool: ChromaDBRetrieval\nInput: ${JSON.stringify({ query })}\nOutput: ${JSON.stringify(toolOutput, null, 2)}`,
          },
        ],
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0,
        max_tokens: 5,
      },
      {
        headers: {
          "Helicone-Session-Id": sessionId,
          "Helicone-Session-Path": "/knowledge-retrieval",
          "Helicone-Session-Name": sessionName,
          "Helicone-Property-ToolName": "ChromaDBRetrieval",
          "Helicone-Property-ToolType": "retrieval",
          "Helicone-Property-QueryType": "knowledge-request",
          "Helicone-Property-ToolInfo": "Vector database lookup",
          "Helicone-Property-ExecutionTime": new Date().toISOString(),
          "Helicone-Property-ExecutionDuration": `${Date.now() - startTime}ms`,
          "Helicone-Property-MatchCount": matches.length.toString(),
          "Helicone-Property-DBName": "knowledge",
          "Helicone-Property-ToolVersion": "1.0.3"
        },
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
  }
}

async function processMultiStepQuery(text: string): Promise<string> {
  const startTime = Date.now();
  const sessionId = randomUUID();
  const runId = `run_${randomUUID().substring(0, 8)}`;
  const sessionName = "Multi-Step RAG Agent";
  const isTimeQuestion = /\b(what\s+time\s+is\s+it|current\s+time|time\s+now)\b/i.test(text);
  
  let context = "";
  let stepsTaken = [];

  if (isTimeQuestion) {
    stepsTaken.push("time_detection");
    const time = await getCurrentTime(sessionId, sessionName);
    context = `Current time is ${time}`;
    stepsTaken.push("time_retrieval");
  } else {
    stepsTaken.push("query_classification");
    
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
          "Helicone-Property-Step": "classification",
          "Helicone-Property-QueryText": text.substring(0, 100),
          "Helicone-Property-RunId": runId,
          "Helicone-Property-StepNumber": "1"
        },
      }
    );

    const classification = classify.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "general";
    
    if (classification.includes("question")) {
      stepsTaken.push("knowledge_retrieval");
      context = await retrieveFromChromaDB(text, sessionId, sessionName);
    } else {
      stepsTaken.push("time_fallback");
      const time = await getCurrentTime(sessionId, sessionName);
      context = `Current time is ${time}`;
    }
  }

  stepsTaken.push("reasoning");
  
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
        "Helicone-Property-Step": "reasoning",
        "Helicone-Property-Context": context.substring(0, 100),
        "Helicone-Property-RunId": runId,
        "Helicone-Property-StepNumber": "2"
      },
    }
  );

  const reasoningOutput = reasoning.choices?.[0]?.message?.content ?? "";
  stepsTaken.push("response_generation");
  
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
        "Helicone-Property-Step": "response",
        "Helicone-Property-QueryType": isTimeQuestion ? "time" : "knowledge",
        "Helicone-Property-RunId": runId,
        "Helicone-Property-StepNumber": "3",
        "Helicone-Property-ExecutionPath": stepsTaken.join(","),
        "Helicone-Property-TotalDuration": `${Date.now() - startTime}ms`
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
    const startTime = Date.now();
    const result = await processMultiStepQuery(text);
    const duration = Date.now() - startTime;
    
    res.json({ 
      response: result,
      metadata: {
        processing_time_ms: duration,
        timestamp: new Date().toISOString(),
        query_length: text.length
      }
    });
  } catch (err: unknown) {
    console.error("Error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal Server Error" });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;
seedKnowledgeBase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
});