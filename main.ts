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

// Manual tool tracking function to log tool usage to Helicone
async function logToolUse(
  groq: Groq, 
  toolName: string, 
  input: any, 
  output: any,
  sessionId: string,
  sessionName: string,
  sessionPath: string
): Promise<void> {
  // Log the tool usage by making a small API call to Groq via Helicone
  await groq.chat.completions.create(
    {
      messages: [
        {
          role: "user",
          content: `Tool usage: ${toolName}
Input: ${JSON.stringify(input)}
Output: ${JSON.stringify(output)}`,
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
        "Helicone-Session-Path": sessionPath,
      },
    }
  );
}

// Processing logic for the multi-step query
async function processMultiStepQuery(text: string): Promise<string> {
  // Create a unique session ID for tracking in Helicone
  const sessionId = randomUUID();
  const sessionName = "Multi-Step Agent";

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

  // Step 2: Knowledge Retrieval or Tool Use
  console.log("Step 2: Knowledge Retrieval or Tool Use");
  let result = "";

  if (classification.includes("question")) {
    // Look for keywords in the knowledge base
    const inputText = text.toLowerCase();
    console.log(`  Looking for keywords in: "${inputText}"`);
    
    let toolOutput;
    
    // Check for explicit keywords
    if (inputText.includes("ai") || inputText.includes("artificial intelligence")) {
      result = knowledgeBase["ai"];
      toolOutput = { found: true, keyword: "ai", value: knowledgeBase["ai"] };
      console.log(`  Found match: "ai"`);
    } else if (inputText.includes("helicone")) {
      result = knowledgeBase["helicone"];
      toolOutput = { found: true, keyword: "helicone", value: knowledgeBase["helicone"] };
      console.log(`  Found match: "helicone"`);
    } else if (inputText.includes("rag") || inputText.includes("retrieval")) {
      result = knowledgeBase["rag"];
      toolOutput = { found: true, keyword: "rag", value: knowledgeBase["rag"] };
      console.log(`  Found match: "rag"`);
    } else {
      result = "No relevant knowledge found.";
      toolOutput = { found: false, message: "No relevant knowledge found." };
      console.log(`  No matches found in knowledge base`);
    }
    
    // Log tool usage to Helicone
    await logToolUse(
      groq, 
      "knowledgeBaseLookup", 
      { query: text }, 
      toolOutput,
      sessionId,
      sessionName,
      "/knowledge-retrieval"
    );
  } else {
    // Get current time
    const time = getCurrentTime();
    result = `Current time is ${time}`;
    
    // Log tool usage to Helicone
    await logToolUse(
      groq, 
      "getCurrentTime", 
      {}, 
      { time: time },
      sessionId,
      sessionName,
      "/get-time"
    );
  }
  
  console.log(`  Result: ${result}`);

  // Step 3: Reasoning about the response
  console.log("Step 3: Reasoning about the response");
  const reasoning = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "user",
          content: `Based on this context: "${result}", reason step by step about how to answer the user's query: "${text}"`,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.3,
      max_tokens: 200,
    },
    {
      headers: {
        "Helicone-Session-Id": sessionId,
        "Helicone-Session-Name": sessionName,
        "Helicone-Session-Path": "/reasoning",
      },
    }
  );

  const reasoningOutput = reasoning.choices?.[0]?.message?.content || "";
  console.log(`  Reasoning: ${reasoningOutput}`);

  // Step 4: Generate final output
  console.log("Step 4: Generating final response");
  const finalReply = await groq.chat.completions.create(
    {
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that provides accurate and friendly responses.
Here is some retrieved context: "${result}"
Here is some reasoning about how to respond: "${reasoningOutput}"`,
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
        "Helicone-Session-Name": sessionName,
        "Helicone-Session-Path": "/final-response",
      },
    }
  );

  const finalResponse = finalReply.choices?.[0]?.message?.content || "No final response.";
  console.log(`  Final response: ${finalResponse}`);

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

// Root endpoint with instructions
app.get("/", (req: Request, res: Response) => {
  res.send(`
    <html>
      <head><title>Enhanced Multi-Step Agent</title></head>
      <body>
        <h1>Enhanced Multi-Step Agent</h1>
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