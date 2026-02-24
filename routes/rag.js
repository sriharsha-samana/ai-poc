const axios = require("axios");
const uuidv4 = require("uuid").v4;

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

function registerRagRoutes(
  app,
  {
    dbReady,
    persistDatabase,
    saveDocumentWithEmbedding,
    getDocuments,
    generateEmbedding,
    generationModel,
    ollamaBaseUrl = "http://localhost:11434",
  }
) {
  app.post("/ingest", async (req, res) => {
    try {
      await dbReady;
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Missing id or text" });
      }

      const id = uuidv4();
      await saveDocumentWithEmbedding(id, text);

      persistDatabase();

      res.json({ message: "Document ingested successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to ingest document" });
    }
  });

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

      const response = await axios.post(`${ollamaBaseUrl}/api/generate`, {
        model: generationModel,
        prompt,
        stream: false,
      });

      res.json({ answer: response.data.response });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to answer question" });
    }
  });
}

module.exports = registerRagRoutes;
