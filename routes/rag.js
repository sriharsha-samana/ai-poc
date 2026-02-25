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

function getUpstreamStatus(error) {
  return Number(error?.response?.status) || null;
}

function isStreamContextRetryError(error) {
  return isContextLengthError(error) || getUpstreamStatus(error) === 400;
}

function isUpstreamConnectionError(error) {
  return error?.code === "ECONNREFUSED";
}

function isCanceledError(error) {
  return error?.code === "ERR_CANCELED";
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

function normalizePathForMatch(input) {
  return String(input || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

function getDocumentPathFromId(id) {
  const value = String(id || "");
  if (!value.startsWith("file:")) {
    return "";
  }

  const withoutPrefix = value.slice("file:".length);
  const firstColonIndex = withoutPrefix.indexOf(":");
  if (firstColonIndex < 0) {
    return "";
  }

  const withChunk = withoutPrefix.slice(firstColonIndex + 1);
  const hashIndex = withChunk.indexOf("#");
  return hashIndex >= 0 ? withChunk.slice(0, hashIndex) : withChunk;
}

function filterRowsByFilePath(rows, filePath) {
  const normalizedFilter = normalizePathForMatch(filePath);
  if (!normalizedFilter) {
    return rows;
  }

  return rows.filter((row) => {
    const docPath = normalizePathForMatch(getDocumentPathFromId(row.id));
    return docPath === normalizedFilter || docPath.endsWith(`/${normalizedFilter}`);
  });
}

function buildContext(scored, contextLimit = 3, maxCharsPerDoc = 2500) {
  return scored
    .slice(0, Math.min(contextLimit, scored.length))
    .map((item) => item.content.slice(0, maxCharsPerDoc))
    .join("\n\n");
}

function scoreRows(rows, queryEmbedding) {
  const scored = rows.map((row) => {
    const docEmbedding = JSON.parse(row.embedding);
    const score = cosineSimilarity(queryEmbedding, docEmbedding);
    return { content: row.content, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
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

async function streamAnswer({ prompt, generationModel, ollamaBaseUrl, res }) {
  const abortController = new AbortController();
  const upstream = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    {
      model: generationModel,
      prompt,
      stream: true,
    },
    {
      responseType: "stream",
      signal: abortController.signal,
    }
  );

  const handleClose = () => {
    abortController.abort();
    if (typeof upstream.data?.destroy === "function") {
      upstream.data.destroy();
    }
  };

  res.on("close", handleClose);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    await new Promise((resolve, reject) => {
    let buffer = "";

    upstream.data.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const data = JSON.parse(trimmed);
          if (typeof data.response === "string" && data.response.length > 0) {
            res.write(data.response);
          }
        } catch (parseError) {
          continue;
        }
      }
    });

    upstream.data.on("end", () => {
      const trimmed = buffer.trim();
      if (trimmed) {
        try {
          const data = JSON.parse(trimmed);
          if (typeof data.response === "string" && data.response.length > 0) {
            res.write(data.response);
          }
        } catch (parseError) {
          // Ignore trailing parse errors
        }
      }

      if (!res.writableEnded) {
        res.end();
      }
      resolve();
    });

      upstream.data.on("error", (streamError) => {
        if (!res.writableEnded) {
          res.end();
        }
        reject(streamError);
      });
    });
  } finally {
    res.off("close", handleClose);
  }
}

async function streamAnswerWithContextFallback({
  scored,
  question,
  generationModel,
  ollamaBaseUrl,
  res,
}) {
  const maxMatches = Math.min(6, scored.length);
  let contextLimit = Math.min(3, maxMatches);
  let maxCharsPerDoc = 2500;
  const minCharsPerDoc = 400;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const context = buildContext(scored, contextLimit, maxCharsPerDoc);
    const prompt = buildPrompt(context, question);

    try {
      await streamAnswer({
        prompt,
        generationModel,
        ollamaBaseUrl,
        res,
      });
      return;
    } catch (error) {
      const canRetry =
        !res.headersSent &&
        isStreamContextRetryError(error) &&
        (contextLimit > 1 || maxCharsPerDoc > minCharsPerDoc);

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

  throw new Error("Unable to stream answer within model context limits");
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
      const { question, repoTag, filePath, skipRag = false } = req.body;

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
      const allRows = getDocuments({ repoTag });
      const rows = filterRowsByFilePath(allRows, filePath);

      if (rows.length === 0) {
        if (filePath) {
          return res.status(404).json({
            error: `No documents found for file '${filePath}'. Ensure the file is ingested and repo scope is correct.`,
          });
        }

        return res.status(404).json({
          error: repoTag
            ? `No documents found for repoTag '${repoTag}'`
            : "No documents found. Ingest content first.",
        });
      }

      const scored = scoreRows(rows, queryEmbedding);

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

  app.post("/ask/stream", async (req, res) => {
    try {
      await dbReady;
      const { question, repoTag, filePath, skipRag = false } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Missing question" });
      }

      if (skipRag) {
        const prompt = buildDirectPrompt(question);
        await streamAnswer({
          prompt,
          generationModel,
          ollamaBaseUrl,
          res,
        });
        return;
      }

      const queryEmbedding = await generateEmbedding(question);
      const allRows = getDocuments({ repoTag });
      const rows = filterRowsByFilePath(allRows, filePath);

      if (rows.length === 0) {
        if (filePath) {
          return res.status(404).json({
            error: `No documents found for file '${filePath}'. Ensure the file is ingested and repo scope is correct.`,
          });
        }

        return res.status(404).json({
          error: repoTag
            ? `No documents found for repoTag '${repoTag}'`
            : "No documents found. Ingest content first.",
        });
      }

      const scored = scoreRows(rows, queryEmbedding);
      await streamAnswerWithContextFallback({
        scored,
        question,
        generationModel,
        ollamaBaseUrl,
        res,
      });
    } catch (err) {
      console.error(err);
      if (isCanceledError(err)) {
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      if (!res.headersSent) {
        const contextError = isContextLengthError(err);
        const upstreamStatus = getUpstreamStatus(err);
        const upstreamConnectionError = isUpstreamConnectionError(err);
        res.status(500).json({
          error: contextError
            ? "Failed to answer question due to model context length limits"
            : upstreamConnectionError
              ? "Failed to stream answer: Ollama is not reachable at configured OLLAMA_BASE_URL"
            : `Failed to stream answer${upstreamStatus ? ` (upstream status ${upstreamStatus})` : ""}`,
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

module.exports = registerRagRoutes;
