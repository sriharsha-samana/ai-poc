const axios = require("axios");
const uuidv4 = require("uuid").v4;

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (normA * normB);
}

function isContextLengthError(error) {
  const responseError = error?.response?.data?.error;
  const message = typeof responseError === "string" ? responseError : error?.message;
  return typeof message === "string" && message.toLowerCase().includes("exceeds the context length");
}

function buildPrompt(context, question) {
  return `
Use the following context to answer the question.

Context:
${context}

Question:
${question}

Answer:
`;
}

function buildDirectPrompt(question) {
  return `
Answer the following question.

Question:
${question}

Answer:
`;
}

async function generateDirectAnswer({ question, generationModel, ollamaBaseUrl }) {
  const prompt = buildDirectPrompt(question);
  const response = await axios.post(`${ollamaBaseUrl}/api/generate`, {
    model: generationModel,
    prompt,
    stream: false,
  });

  return response.data.response;
}

async function generateAnswerWithContextFallback({
  scored,
  question,
  generationModel,
  ollamaBaseUrl,
}) {
  const maxMatches = Math.min(6, scored.length);
  let contextLimit = Math.min(3, maxMatches);
  let maxCharsPerDoc = 2500;
  const minCharsPerDoc = 400;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const context = scored
      .slice(0, contextLimit)
      .map((item) => item.content.slice(0, maxCharsPerDoc))
      .join("\n\n");

    try {
      const prompt = buildPrompt(context, question);
      const response = await axios.post(`${ollamaBaseUrl}/api/generate`, {
        model: generationModel,
        prompt,
        stream: false,
      });

      return response.data.response;
    } catch (error) {
      const canRetry = isContextLengthError(error) && (contextLimit > 1 || maxCharsPerDoc > minCharsPerDoc);
      if (!canRetry) {
        throw error;
      }

      if (maxCharsPerDoc > minCharsPerDoc) {
        maxCharsPerDoc = Math.max(minCharsPerDoc, Math.floor(maxCharsPerDoc * 0.7));
      } else if (contextLimit > 1) {
        contextLimit -= 1;
      }
    }
  }

  throw new Error("Unable to generate answer within model context limits");
}

function registerRagRoutes(
  app,
  {
    dbReady,
    persistDatabase,
    saveDocumentWithEmbedding,
    getDocuments,
    getRepoTags,
    generateEmbedding,
    generationModel,
    ollamaBaseUrl = "http://localhost:11434",
  }
) {
  app.get("/repo-tags", async (req, res) => {
    try {
      await dbReady;
      const repoTags = getRepoTags();
      res.json({ repoTags });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list repo tags" });
    }
  });

  app.post("/ingest", async (req, res) => {
    try {
      await dbReady;
      const { text, repoTag } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Missing id or text" });
      }

      const id = uuidv4();
      await saveDocumentWithEmbedding(id, text, { repoTag });

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
      const { question, repoTag, skipRag = false } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Missing question" });
      }

      if (skipRag) {
        const answer = await generateDirectAnswer({
          question,
          generationModel,
          ollamaBaseUrl,
        });

        return res.json({ answer });
      }

      const queryEmbedding = await generateEmbedding(question);
      const rows = getDocuments({ repoTag });

      if (rows.length === 0) {
        return res.status(404).json({
          error: repoTag
            ? `No documents found for repoTag '${repoTag}'`
            : "No documents found. Ingest content first.",
        });
      }

      const scored = rows.map((row) => {
        const docEmbedding = JSON.parse(row.embedding);
        const score = cosineSimilarity(queryEmbedding, docEmbedding);
        return { content: row.content, score };
      });

      scored.sort((a, b) => b.score - a.score);

      const answer = await generateAnswerWithContextFallback({
        scored,
        question,
        generationModel,
        ollamaBaseUrl,
      });

      res.json({ answer });
    } catch (err) {
      console.error(err);
      const contextError = isContextLengthError(err);
      res.status(500).json({
        error: contextError
          ? "Failed to answer question due to model context length limits"
          : "Failed to answer question",
      });
    }
  });
}

module.exports = registerRagRoutes;
