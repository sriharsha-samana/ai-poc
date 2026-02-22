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

npm install express axios body-parser better-sqlite3

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

------------------------------------------------------------------------

# ❓ Ask Questions

POST /ask

Example JSON:

{ "question": "What is the sun?" }

Flow:

1.  Question → Embedded using Ollama\
2.  All stored embeddings loaded from SQLite\
3.  Cosine similarity computed in Node\
4.  Top matches selected\
5.  Context + Question sent to LLM\
6.  Final answer returned

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

node server.js

3️⃣ Open browser

http://localhost:3000

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
