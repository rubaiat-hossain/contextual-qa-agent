# 🤖 Multi-Step Agent with RAG

A simple but powerful multi-step agent that demonstrates the Retrieval-Augmented Generation (RAG) pattern with Groq and Helicone integration.

## ✨ Features

- 🧠 Multi-step reasoning process
- 📚 Simple knowledge base integration
- 🔍 Query classification
- ⏱️ Tool usage (knowledge retrieval and current time)
- 📊 Detailed Helicone session tracking
- 🌐 Simple REST API interface

## 🛠️ Setup

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Groq API key
- Helicone API key

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

## 🚀 Running the Server

Start the server with:

```bash
npx tsx main.ts
```

The server will be running at http://localhost:3000.

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
- "What time is it?"

### Health Check

```bash
curl http://localhost:3000/health
```

## 🧩 How It Works

The agent follows a 4-step process:

1. **🔍 Classification**: Determines if the query is a question or general statement
2. **🔎 Knowledge Retrieval or Tool Use**: Retrieves information or executes a tool
3. **🤔 Reasoning**: Develops a plan for answering based on retrieved information
4. **💬 Response Generation**: Creates a helpful, natural response

All steps are tracked in Helicone for observability with session paths:
- `/classify`
- `/knowledge-retrieval` or `/tool-execution`
- `/reasoning`
- `/final-response`

## 📊 Helicone Integration

This project includes detailed Helicone logging with:
- Session tracking
- Tool usage logging
- Custom properties for filtering and analysis

Visit your Helicone dashboard to view detailed analytics on your agent's performance.

## 📄 License

MIT
