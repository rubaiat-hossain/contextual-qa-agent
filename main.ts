import { config } from "dotenv";
config();

import express, { Request, Response } from "express";
import Groq from "groq-sdk";
import { randomUUID } from "crypto";

// Initialize Express
const app = express();
app.use(express.json());

// Knowledge base for RAG (static)
const knowledgeBase: Record<string, string> = {
  "ai": "Artificial Intelligence is the simulation of human intelligence processes by machines, especially computer systems.",
  "helicone": "Helicone is an observability platform that helps developers monitor and debug LLM applications.",
  "rag": "Retrieval-Augmented Generation (RAG) combines retrieval of external knowledge with text generation to produce more accurate results."
};

// Get current time helper
function getCurrentTime(): string {
  return new Date().toISOString();
}

// Enhanced tool logging function
async function logTool(
  groq: Groq, 
  toolName: string, 
  input: Record<string, any>, 
  output: Record<string, any>,
  sessionId: string,
  sessionPath: string
): Promise<void> {
  // Log tool execution with detailed information
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
      temperature: 0.0,
      max_tokens: 5,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": sessionPath,
        "Helicone-Property-ToolName": toolName,
        "Helicone-Property-ToolType": toolName.includes("knowledge") ? "retrieval" : "function"
      },
    }
  );
}

// Processing logic for the multi-step query
async function processMultiStepQuery(text: string): Promise<string> {
  // Create a unique session ID for tracking in Helicone
  const sessionId = randomUUID();
  const sessionName = "Multi-Step Agent";

  console.log(`Processing query: "${text}"`);

  // Initialize Groq client with Helicone
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || "",
    baseURL: "https://groq.helicone.ai",
    defaultHeaders: {
      "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY || ""}`,
      "Helicone-Session-Name": sessionName,
    },
  });

  // Step 1: Classify query intent
  console.log("Step 1: Classifying intent");
  const classify = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "system",
          content: "You are a query classifier. Respond with ONLY ONE WORD: either 'question' or 'general'."
        },
        {
          role: "user",
          content: `Classify the following text as either "question" or "general": "${text}"`
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 10,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/classify",
        "Helicone-Property-Query-Length": text.length.toString()
      },
    }
  );

  // Clean classification result - only take the first word and remove any special characters
  const rawClassification = classify.choices?.[0]?.message?.content || "";
  const classification = rawClassification.toLowerCase().trim().split(/\s+/)[0].replace(/[^a-z]/g, "");
  console.log(`  Classification: ${classification}`);

  // Step 2: Knowledge Retrieval or Tool Use
  console.log("Step 2: Knowledge Retrieval or Tool Use");
  let result = "";

  if (classification.includes("question")) {
    // Better keyword extraction and matching
    const inputText = text.toLowerCase();
    console.log(`  Looking for keywords in: "${inputText}"`);
    
    let retrievalResult: Record<string, any> = {
      found: false,
      query: text
    };
    
    // Check for explicit keywords
    if (inputText.includes("ai") || inputText.includes("artificial intelligence")) {
      result = knowledgeBase["ai"];
      retrievalResult = { found: true, keyword: "ai", value: knowledgeBase["ai"] };
      console.log(`  Found match: "ai"`);
    } else if (inputText.includes("helicone")) {
      result = knowledgeBase["helicone"];
      retrievalResult = { found: true, keyword: "helicone", value: knowledgeBase["helicone"] };
      console.log(`  Found match: "helicone"`);
    } else if (inputText.includes("rag") || inputText.includes("retrieval")) {
      result = knowledgeBase["rag"];
      retrievalResult = { found: true, keyword: "rag", value: knowledgeBase["rag"] };
      console.log(`  Found match: "rag"`);
    } else {
      result = "No relevant knowledge found.";
      retrievalResult = { found: false, message: "No relevant knowledge found." };
      console.log(`  No matches found in knowledge base`);
    }
    
    // Log knowledge retrieval
    await logTool(
      groq, 
      "knowledgeBaseLookup", 
      { query: text }, 
      retrievalResult,
      sessionId,
      "/knowledge-retrieval"
    );
  } else {
    // Get current time
    const time = getCurrentTime();
    result = `Current time is ${time}`;
    
    // Log getCurrentTime tool
    await logTool(
      groq, 
      "getCurrentTime", 
      {}, 
      { time: time },
      sessionId,
      "/tool-execution"
    );
  }
  
  console.log(`  Result: ${result}`);

  // Step 3: Reasoning about the response
  console.log("Step 3: Reasoning about the response");
  const reasoning = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "system",
          content: "You are a reasoning assistant."
        },
        {
          role: "user",
          content: `Based on this context: "${result}", reason step by step about how to answer the user's query: "${text}"`
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 200,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/reasoning",
        "Helicone-Property-HasContext": result !== "No relevant knowledge found." ? "true" : "false"
      },
    }
  );

  const reasoningOutput = reasoning.choices?.[0]?.message?.content || "";
  console.log(`  Reasoning complete`);

  // Step 4: Generate final output
  console.log("Step 4: Generating final response");
  const finalReply = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that provides accurate and friendly responses.
Here is some retrieved context: "${result}"
Here is some reasoning about how to respond: "${reasoningOutput}"`
        },
        {
          role: "user",
          content: text,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.5,
      max_tokens: 500,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Path": "/final-response",
        "Helicone-Property-Classification": classification,
        "Helicone-Property-HasKnowledge": result !== "No relevant knowledge found." ? "true" : "false"
      },
    }
  );

  const finalResponse = finalReply.choices?.[0]?.message?.content || "No final response.";
  console.log(`  Final response complete`);

  return finalResponse;
}

// REST API route handler
const analyzeHandler = async (req: Request, res: Response): Promise<void> => {
  const { text } = req.body as { text?: string };
  
  if (!text) {
    res.status(400).json({ error: "Missing text parameter" });
    return;
  }
  
  try {
    const finalResponse = await processMultiStepQuery(text);
    res.json({ response: finalResponse });
  } catch (err: unknown) {
    console.error("API Error:", err);
    res.status(500).json({ 
      error: "Internal server error",
      message: err instanceof Error ? err.message : String(err)
    });
  }
};

// Register REST API routes
app.post("/analyze", analyzeHandler);

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ 
    status: "ok",
    endpoints: {
      analyze: "POST /analyze with {\"text\": \"your query\"}"
    }
  });
});

// Simple root endpoint
app.get("/", (req: Request, res: Response) => {
  res.send(`
    <h1>Multi-Step Agent API</h1>
    <p>Use this API with a POST request to /analyze with {"text": "your query"}</p>
    <code>curl -X POST http://localhost:3000/analyze -H "Content-Type: application/json" -d '{"text": "what is ai?"}'</code>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`- POST /analyze with {"text": "your query"}`);
  console.log(`- GET /health for server status`);
  console.log(`\nExample curl command:`);
  console.log(`curl -X POST http://localhost:3000/analyze -H "Content-Type: application/json" -d '{"text": "what is ai?"}'`);
});