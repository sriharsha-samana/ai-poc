const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const Database = require("better-sqlite3");
const uuidv4 = require("uuid").v4;

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname));

const PORT = 3000;

// Create / open SQLite DB file
const db = new Database("data/rag.db");

// Create table if not exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    content TEXT,
    embedding TEXT
  )
`).run();

console.log("✅ SQLite database ready");

// Generate embedding using Ollama
async function generateEmbedding(text) {
  const response = await axios.post(
    "http://localhost:11434/api/embeddings",
    {
      model: "nomic-embed-text",
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
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Missing id or text" });
    }

    const id = uuidv4(); // Generate UUID
    const embedding = await generateEmbedding(text);

    db.prepare(`
      INSERT OR REPLACE INTO documents (id, content, embedding)
      VALUES (?, ?, ?)
    `).run(id, text, JSON.stringify(embedding));

    res.json({ message: "Document ingested successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to ingest document" });
  }
});

// Ask endpoint
app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const queryEmbedding = await generateEmbedding(question);

    const rows = db.prepare("SELECT * FROM documents").all();

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
        model: "tinyllama",
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