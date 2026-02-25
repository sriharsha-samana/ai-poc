const axios = require("axios");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

function createDbService({
  dbFilePath,
  embeddingModel,
  maxIngestChars = 12000,
  ollamaBaseUrl = "http://localhost:11434",
}) {
  let db;

  function isContextLengthError(error) {
    const responseError = error?.response?.data?.error;
    const message = typeof responseError === "string" ? responseError : error?.message;
    return typeof message === "string" && message.toLowerCase().includes("exceeds the context length");
  }

  function columnExists(tableName, columnName) {
    const tableInfo = db.exec(`PRAGMA table_info(${tableName})`);
    if (!tableInfo.length) {
      return false;
    }

    const columns = tableInfo[0].values.map((row) => row[1]);
    return columns.includes(columnName);
  }

  async function initializeDatabase() {
    fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

    const SQL = await initSqlJs();
    if (fs.existsSync(dbFilePath)) {
      const dbFile = fs.readFileSync(dbFilePath);
      db = new SQL.Database(dbFile);
    } else {
      db = new SQL.Database();
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT,
        embedding TEXT,
        repo_tag TEXT
      )
    `);

    if (!columnExists("documents", "repo_tag")) {
      db.run("ALTER TABLE documents ADD COLUMN repo_tag TEXT");
    }

    persistDatabase();
    console.log("✅ SQLite database ready");
  }

  function persistDatabase() {
    const data = db.export();
    fs.writeFileSync(dbFilePath, Buffer.from(data));
  }

  function getDocuments(options = {}) {
    const { repoTag } = options;
    const hasScope = typeof repoTag === "string" && repoTag.trim().length > 0;

    const query = hasScope
      ? "SELECT id, content, embedding, repo_tag FROM documents WHERE repo_tag = ?"
      : "SELECT id, content, embedding, repo_tag FROM documents";
    const result = hasScope ? db.exec(query, [repoTag.trim()]) : db.exec(query);

    if (result.length === 0) {
      return [];
    }

    const queryResult = result[0];
    const idIndex = queryResult.columns.indexOf("id");
    const contentIndex = queryResult.columns.indexOf("content");
    const embeddingIndex = queryResult.columns.indexOf("embedding");
    const repoTagIndex = queryResult.columns.indexOf("repo_tag");

    return queryResult.values.map((row) => ({
      id: row[idIndex],
      content: row[contentIndex],
      embedding: row[embeddingIndex],
      repoTag: repoTagIndex >= 0 ? row[repoTagIndex] : null,
    }));
  }

  function getRepoTags() {
    const result = db.exec(
      "SELECT DISTINCT repo_tag FROM documents WHERE repo_tag IS NOT NULL AND TRIM(repo_tag) <> '' ORDER BY repo_tag"
    );

    if (result.length === 0) {
      return [];
    }

    return result[0].values.map((row) => row[0]);
  }

  function trimForEmbedding(text) {
    if (!text || text.length <= maxIngestChars) {
      return text;
    }

    return text.slice(0, maxIngestChars);
  }

  async function generateEmbedding(text) {
    const response = await axios.post(`${ollamaBaseUrl}/api/embeddings`, {
      model: embeddingModel,
      prompt: text,
    });

    return response.data.embedding;
  }

  async function generateEmbeddingWithFallback(text) {
    let candidateText = text;
    const minLength = 400;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const embedding = await generateEmbedding(candidateText);
        return { embedding, textUsed: candidateText };
      } catch (error) {
        const canRetry = isContextLengthError(error) && candidateText.length > minLength;
        if (!canRetry) {
          throw error;
        }

        candidateText = candidateText.slice(0, Math.max(minLength, Math.floor(candidateText.length * 0.6)));
      }
    }

    const embedding = await generateEmbedding(candidateText);
    return { embedding, textUsed: candidateText };
  }

  async function saveDocumentWithEmbedding(id, text, options = {}) {
    const repoTag = typeof options.repoTag === "string" ? options.repoTag.trim() : null;
    const preparedText = trimForEmbedding(text);
    const { embedding, textUsed } = await generateEmbeddingWithFallback(preparedText);

    db.run(
      `
        INSERT OR REPLACE INTO documents (id, content, embedding, repo_tag)
        VALUES (?, ?, ?, ?)
      `,
      [id, textUsed, JSON.stringify(embedding), repoTag || null]
    );
  }

  return {
    initializeDatabase,
    persistDatabase,
    getDocuments,
    getRepoTags,
    generateEmbedding,
    saveDocumentWithEmbedding,
  };
}

module.exports = {
  createDbService,
};
