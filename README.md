# 📚 Simple Local RAG System (Node.js + Ollama + SQLite)

A minimal Retrieval-Augmented Generation (RAG) system built locally
using:

-   Node.js (Express)
-   Ollama (LLM + Embedding model)
-   SQLite (file-based vector storage)
-   Simple HTML frontend with loading state

This project demonstrates the complete AI application lifecycle:

Ingest → Embed → Store → Retrieve → Generate → Respond

------------------------------------------------------------------------

# 🏗 Architecture Overview

User → Frontend → Node API\
↓\
SQLite (rag.db file)\
↓\
Ollama (Embeddings + LLM)

No Docker. No external database server.

------------------------------------------------------------------------

# 📦 Prerequisites

## 1️⃣ Install Node.js

https://nodejs.org/

Verify: node -v\
npm -v

## 2️⃣ Install Ollama

https://ollama.com

Verify: ollama --version

## 3️⃣ Pull Required Models

ollama pull phi3:mini\
ollama pull nomic-embed-text

------------------------------------------------------------------------

# 🚀 Setup Instructions

## 1️⃣ Create Project

mkdir local-rag\
cd local-rag\
npm init -y

## 2️⃣ Install Dependencies

npm install express axios sql.js

## 3️⃣ Add Files

Create:

-   server.js\
-   index.html

------------------------------------------------------------------------

# 🧠 Backend (server.js)

Features:

-   Stores embeddings in SQLite (`rag.db`)
-   Computes cosine similarity manually
-   Retrieves top 3 matching documents
-   Sends context to LLM
-   Returns final generated answer

Start server:

node server.js

Server runs at:

http://localhost:3000

------------------------------------------------------------------------

# 📥 Ingest Documents

POST /ingest

Example JSON:

{ "id": "doc1", "text": "The sun is a star at the center of the solar
system." }

Optional repo-scoped ingest:

{ "text": "...", "repoTag": "my-repo" }

## Ingest an Entire Confluence Space

POST /ingest/confluence-space

Example JSON (Confluence Cloud - email + API token):

{
	"baseUrl": "https://your-company.atlassian.net",
	"spaceKey": "ENG",
	"email": "you@company.com",
	"apiToken": "your_api_token",
	"pageSize": 25,
	"maxPages": 200
}

Example JSON (Bearer token):

{
	"baseUrl": "https://confluence.company.com",
	"spaceKey": "ENG",
	"bearerToken": "your_bearer_token"
}

Notes:

-   Page content is extracted from Confluence storage HTML and converted to plain text.
-   Document IDs are stable per page: `confluence:<spaceKey>:<pageId>`.
-   Existing entries for the same page are updated on re-ingest.

## Ingest a Local Folder (Code + Text)

POST /ingest/folder

Example JSON:

{
	"folderPath": "/absolute/path/to/your/project",
	"repoTag": "my-repo",
	"extensions": [".js", ".ts", ".md", ".json", ".py"],
	"maxFiles": 2000,
	"chunkSize": 8000,
	"chunkOverlap": 500,
	"dryRun": true
}

Notes:

-   The endpoint automatically respects `.gitignore` from the target folder.
-   Ignored files/folders (for example `node_modules/`, `dist/`, `.env`) are skipped.
-   It also skips common non-useful files by default (lock files, sourcemaps, minified bundles, logs, build dirs).
-   Large files are automatically split into chunks to improve retrieval quality.
-   Chunk document IDs use `file:<relative-path>#chunk-<n>`.
-   Set `dryRun: true` to preview matched files/chunks without writing embeddings.
-   Use `repoTag` to isolate one repository from another in later `/ask` calls.

------------------------------------------------------------------------

# ❓ Ask Questions

POST /ask

Example JSON:

{ "question": "What is the sun?" }

Repo-scoped query:

{ "question": "How is auth implemented?", "repoTag": "my-repo" }

Direct model query (skip local RAG context completely):

{ "question": "Explain transformers simply", "skipRag": true }

Flow:

1.  Question → Embedded using Ollama\
2.  All stored embeddings loaded from SQLite\
3.  Cosine similarity computed in Node\
4.  Top matches selected\
5.  Context + Question sent to LLM\
6.  Final answer returned

If `skipRag: true` is provided, steps 1–5 are skipped and the question is sent directly to the generation model.

------------------------------------------------------------------------

# 💾 Database

A file named:

rag.db

Will be created automatically in your project folder.

This file stores:

-   Document ID\
-   Document text\
-   Embedding vector (JSON format)

------------------------------------------------------------------------

# 🧪 How To Run

1️⃣ Start Ollama

ollama serve

2️⃣ Start Node

npm run dev

3️⃣ Open browser

http://localhost:3000

For production-style run (no hot reload), use:

npm start

------------------------------------------------------------------------

# ⚙️ Configuration

You can customize runtime behavior using environment variables:

-   `PORT` (default: `3000`)
-   `DB_FILE_PATH` (default: `./data/rag.db`)
-   `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
-   `OLLAMA_EMBED_MODEL` (default: `nomic-embed-text`)
-   `OLLAMA_GEN_MODEL` (default: `phi3:mini`)
-   `MAX_INGEST_CHARS` (default: `12000`)

Example:

PORT=4000 OLLAMA_GEN_MODEL=phi3:mini node server.js

Tip:

Copy `.env.example` to `.env` and adjust values for your environment.
The app auto-loads `.env` at startup.

------------------------------------------------------------------------

# 🧠 Models Used

## LLM: phi3:mini

-   Lightweight
-   Fast
-   Good for local machines

## Embedding Model: nomic-embed-text

-   Converts text → vector embeddings
-   Used for similarity search

------------------------------------------------------------------------

# 📊 What This Project Demonstrates

✔ Manual embedding generation\
✔ Storing embeddings in SQLite\
✔ Implementing cosine similarity\
✔ Building a vector search system from scratch\
✔ Understanding how RAG works internally\
✔ Local AI application deployment

------------------------------------------------------------------------

# 🎯 When To Use This Architecture

Best for:

-   Learning RAG
-   Small datasets (\<10k documents)
-   Local development
-   Windows servers without Docker

Not ideal for:

-   Millions of vectors
-   High-performance ANN indexing
-   Distributed systems

------------------------------------------------------------------------

# 🔥 What You Built

You now understand:

-   What embeddings are
-   How vector search works
-   What a vector database really does
-   How RAG systems are architected
-   How AI apps are built end-to-end

This is real AI infrastructure knowledge.
