# 🤖 Multi-Step Agent with ChromaDB RAG

A powerful multi-step agent that implements Retrieval-Augmented Generation (RAG) using ChromaDB, Groq, and Helicone for comprehensive observability.

## ✨ Features

- 🧠 Multi-step reasoning process
- 📚 ChromaDB vector database integration
- 🔍 Query classification
- 🚀 Automatic knowledge base seeding
- ⏱️ Tool usage (knowledge retrieval and current time)
- 📊 Detailed Helicone session tracking
- 🌐 Simple REST API interface

## 🛠️ Setup

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Groq API key
- Helicone API key
- ChromaDB (running on port 8000)

### Installation

1. **Clone the repository**

```bash
git clone https://your-repository-url.git
cd multi-step-agent
```

2. **Install dependencies**

```bash
npm install
```

3. **Create a `.env` file with your API keys**

```
GROQ_API_KEY=your_groq_api_key
HELICONE_API_KEY=your_helicone_api_key
```

4. **Start ChromaDB**

You need a running ChromaDB instance. You can start one with Docker:

```bash
docker run -p 8000:8000 ghcr.io/chroma-core/chroma:latest
```

## 🚀 Running the Server

Start the server with:

```bash
npx tsx main.ts
```

The server will be running at http://localhost:3000, and will automatically seed ChromaDB with initial knowledge if the collection is empty.

## 📝 API Usage

### Query the Agent

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "what is ai?"}'
```

### Sample Queries

- "What is AI?"
- "Tell me about Helicone"
- "What is RAG?"
- "What is the Model Context Protocol?"
- "What time is it?"

### Health Check

```bash
curl http://localhost:3000/health
```

## 🧩 How It Works

The agent follows a 4-step process:

1. **🔍 Classification**: Determines if the query is a question or general statement
2. **🔎 Knowledge Retrieval or Tool Use**: 
   - For questions: Retrieves information from ChromaDB
   - For general queries: Gets current time
3. **🤔 Reasoning**: Develops a plan for answering based on retrieved information
4. **💬 Response Generation**: Creates a helpful, natural response

All steps are tracked in Helicone for observability with session paths:
- `/classify`
- `/knowledge-retrieval`
- `/reasoning`
- `/final-response`

## 📊 Helicone Integration

This project includes detailed Helicone logging with:
- Session tracking
- Tool usage logging
- Custom properties for filtering and analysis

Visit your Helicone dashboard to view detailed analytics on your agent's performance.

## 💾 ChromaDB Knowledge Base

The system automatically seeds ChromaDB with initial knowledge about:
- AI fundamentals
- Helicone platform
- RAG architecture
- Observability in AI
- Model Context Protocol (MCP)
- LLMOps

You can extend the knowledge base by modifying the `seedKnowledgeBase()` function.

## 📄 License

MIT
