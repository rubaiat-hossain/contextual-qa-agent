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

// Processing logic for the multi-step query
async function processMultiStepQuery(text: string): Promise<string> {
  // Create a unique session ID for tracking in Helicone
  const sessionId = randomUUID();
  const sessionName = "Multi-Step Sentiment Agent";

  // Initialize Groq client with Helicone
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || "",
    baseURL: "https://groq.helicone.ai",
    defaultHeaders: {
      "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY || ""}`,
    },
  });

  // Step 1: Classify query intent
  console.log("Step 1: Classifying intent");
  const classify = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "user",
          content: `Classify the following text as either "question" or "general": "${text}"`,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 50,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Name": sessionName,
        "Helicone-Session-Path": "/classify",
      },
    }
  );

  const classification = classify.choices?.[0]?.message?.content?.toLowerCase() || "general";
  console.log(`  Classification: ${classification}`);

  // Step 2: Handle based on classification
  console.log("Step 2: Generating result based on classification");
  let result = "";

  if (classification.includes("question")) {
    // Better keyword extraction and matching
    const inputText = text.toLowerCase();
    console.log(`  Looking for keywords in: "${inputText}"`);
    
    // Check for explicit keywords
    if (inputText.includes("ai") || inputText.includes("artificial intelligence")) {
      result = knowledgeBase["ai"];
      console.log(`  Found match: "ai"`);
    } else if (inputText.includes("helicone")) {
      result = knowledgeBase["helicone"];
      console.log(`  Found match: "helicone"`);
    } else if (inputText.includes("rag") || inputText.includes("retrieval")) {
      result = knowledgeBase["rag"];
      console.log(`  Found match: "rag"`);
    } else {
      result = "No relevant knowledge found.";
      console.log(`  No matches found in knowledge base`);
    }
  } else {
    // Use current time
    result = `Current time is ${getCurrentTime()}`;
  }
  console.log(`  Result: ${result}`);

  // Manually log tool result
  console.log("Step 3: Logging tool result");
  await groq.chat.completions.create(
    {
      messages: [
        {
          role: "user",
          content: `Manual tool log: ${result}`,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.0,
      max_tokens: 10,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Name": sessionName,
        "Helicone-Session-Path": "/tool-output",
      },
    }
  );

  // Step 4: Generate final output
  console.log("Step 4: Generating final response");
  const finalReply = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "user",
          content: `Using the following context, generate a friendly response: "${result}"`,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.5,
      max_tokens: 300,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Name": sessionName,
        "Helicone-Session-Path": "/final-response",
      },
    }
  );

  return finalReply.choices?.[0]?.message?.content || "No final response.";
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

// Root endpoint with instructions
app.get("/", (req: Request, res: Response) => {
  res.send(`
    <html>
      <head><title>Multi-Step Sentiment + Knowledge Agent</title></head>
      <body>
        <h1>Multi-Step Sentiment + Knowledge Agent</h1>
        <h2>Available Endpoints:</h2>
        <ul>
          <li><strong>Analyze:</strong> POST to /analyze with {"text": "your query"}</li>
          <li><strong>Health Check:</strong> GET /health</li>
        </ul>
        <h3>Example curl command:</h3>
        <pre>curl -X POST http://localhost:3000/analyze -H "Content-Type: application/json" -d '{"text": "what is ai?"}'</pre>
      </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`- POST /analyze with {"text": "your query"}`);
  console.log(`- GET /health for server status`);
  console.log(`- GET / for documentation`);
  console.log(`\nExample curl command:`);
  console.log(`curl -X POST http://localhost:3000/analyze -H "Content-Type: application/json" -d '{"text": "what is ai?"}'`);
});