const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const uuidv4 = require("uuid").v4;

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = 3000;
const DB_FILE = path.join(__dirname, "data", "rag.db");
const EMBEDDING_MODEL = "nomic-embed-text";
const GENERATION_MODEL = "phi3:mini";

let db;

async function initializeDatabase() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const dbFile = fs.readFileSync(DB_FILE);
    db = new SQL.Database(dbFile);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT,
      embedding TEXT
    )
  `);

  persistDatabase();
  console.log("✅ SQLite database ready");
}

function persistDatabase() {
  const data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function getDocuments() {
  const result = db.exec("SELECT id, content, embedding FROM documents");
  if (result.length === 0) {
    return [];
  }

  const queryResult = result[0];
  const idIndex = queryResult.columns.indexOf("id");
  const contentIndex = queryResult.columns.indexOf("content");
  const embeddingIndex = queryResult.columns.indexOf("embedding");

  return queryResult.values.map((row) => ({
    id: row[idIndex],
    content: row[contentIndex],
    embedding: row[embeddingIndex],
  }));
}

const dbReady = initializeDatabase();

// Generate embedding using Ollama
async function generateEmbedding(text) {
  const response = await axios.post(
    "http://localhost:11434/api/embeddings",
    {
      model: EMBEDDING_MODEL,
      prompt: text,
    }
  );

  return response.data.embedding;
}

// Cosine similarity function
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

// Ingest endpoint
app.post("/ingest", async (req, res) => {
  try {
    await dbReady;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Missing id or text" });
    }

    const id = uuidv4(); // Generate UUID
    const embedding = await generateEmbedding(text);

    db.run(
      `
      INSERT OR REPLACE INTO documents (id, content, embedding)
      VALUES (?, ?, ?)
    `,
      [id, text, JSON.stringify(embedding)]
    );

    persistDatabase();

    res.json({ message: "Document ingested successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to ingest document" });
  }
});

// Ask endpoint
app.post("/ask", async (req, res) => {
  try {
    await dbReady;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const queryEmbedding = await generateEmbedding(question);

    const rows = getDocuments();

    const scored = rows.map((row) => {
      const docEmbedding = JSON.parse(row.embedding);
      const score = cosineSimilarity(queryEmbedding, docEmbedding);
      return { content: row.content, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const topMatches = scored.slice(0, 3);
    const context = topMatches.map((m) => m.content).join("\n");

    const prompt = `
Use the following context to answer the question.

Context:
${context}

Question:
${question}

Answer:
`;

    const response = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: GENERATION_MODEL,
        prompt: prompt,
        stream: false,
      }
    );

    res.json({ answer: response.data.response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to answer question" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});