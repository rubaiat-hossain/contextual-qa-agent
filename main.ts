import { config } from "dotenv";
config();

import express, { Request, Response } from "express";
import Groq from "groq-sdk";
import { randomUUID } from "crypto";

// Initialize Express
const app = express();
app.use(express.json());

// Knowledge base for RAG
const knowledgeBase: Record<string, string> = {
  "ai": "Artificial Intelligence is the simulation of human intelligence processes by machines, especially computer systems.",
  "helicone": "Helicone is an observability platform that helps developers monitor and debug LLM applications.",
  "rag": "Retrieval-Augmented Generation (RAG) combines retrieval of external knowledge with text generation to produce more accurate results."
};

// Global Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://groq.helicone.ai",
  defaultHeaders: {
    "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY || ""}`,
  },
});

// Helper: Get current time
function getCurrentTime(): string {
  return new Date().toISOString();
}

// Helper: Log tool use manually
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
          content: `Tool: ${toolName}
Input: ${JSON.stringify(input)}
Output: ${JSON.stringify(output)}`,
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
        "Helicone-Property-ToolType": toolName.includes("knowledge") ? "retrieval" : "function",
      },
    }
  );
}

// Main multi-step agent logic
async function processMultiStepQuery(text: string): Promise<string> {
  const sessionId = randomUUID();
  const sessionName = "Multi-Step Agent";

  console.log(`Processing query: "${text}"`);

  // Step 1: Classify
  console.log("Step 1: Classifying intent");
  const classify = await groq.chat.completions.create(
    {
      messages: [
        { role: "system", content: "You are a query classifier. Respond ONLY 'question' or 'general'." },
        { role: "user", content: `Classify this: "${text}"` },
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

  const classification = classify.choices?.[0]?.message?.content?.trim().toLowerCase() || "general";
  console.log(`  Classification: ${classification}`);

  // Step 2: Retrieval or tool use
  let result = "";
  if (classification.includes("question")) {
    const input = text.toLowerCase();
    let retrievalResult: Record<string, any> = { found: false, query: text };

    if (input.includes("ai") || input.includes("artificial intelligence")) {
      result = knowledgeBase["ai"];
      retrievalResult = { found: true, keyword: "ai", value: knowledgeBase["ai"] };
    } else if (input.includes("helicone")) {
      result = knowledgeBase["helicone"];
      retrievalResult = { found: true, keyword: "helicone", value: knowledgeBase["helicone"] };
    } else if (input.includes("rag") || input.includes("retrieval")) {
      result = knowledgeBase["rag"];
      retrievalResult = { found: true, keyword: "rag", value: knowledgeBase["rag"] };
    } else {
      result = "No relevant knowledge found.";
    }

    await logTool("knowledgeBaseLookup", { query: text }, retrievalResult, sessionId, "/knowledge-retrieval", sessionName);
  } else {
    const time = getCurrentTime();
    result = `Current time is ${time}`;
    await logTool("getCurrentTime", {}, { time }, sessionId, "/tool-execution", sessionName);
  }

  console.log(`  Result: ${result}`);

  // Step 3: Reasoning
  console.log("Step 3: Reasoning");
  const reasoning = await groq.chat.completions.create(
    {
      messages: [
        { role: "system", content: "You are a reasoning assistant." },
        { role: "user", content: `Given this: "${result}", explain step by step how to answer "${text}"` },
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

  const reasoningOutput = reasoning.choices?.[0]?.message?.content || "";

  // Step 4: Final Response
  console.log("Step 4: Final Response");
  const finalReply = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "system",
          content: `You are a friendly assistant. Context: "${result}". Reasoning: "${reasoningOutput}"`,
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

  const finalResponse = finalReply.choices?.[0]?.message?.content || "No final response.";
  console.log(`  Final response ready.`);

  return finalResponse;
}

// REST endpoint
app.post("/analyze", async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: "Missing text" });
    return;
  }

  try {
    const result = await processMultiStepQuery(text);
    res.json({ response: result });
  } catch (err: any) {
    console.error("API Error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`Test: curl -X POST http://localhost:${PORT}/analyze -H "Content-Type: application/json" -d '{"text": "what is ai?"}'`);
});
