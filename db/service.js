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
        embedding TEXT
      )
    `);

    persistDatabase();
    console.log("✅ SQLite database ready");
  }

  function persistDatabase() {
    const data = db.export();
    fs.writeFileSync(dbFilePath, Buffer.from(data));
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

  async function saveDocumentWithEmbedding(id, text) {
    const preparedText = trimForEmbedding(text);
    const embedding = await generateEmbedding(preparedText);

    db.run(
      `
        INSERT OR REPLACE INTO documents (id, content, embedding)
        VALUES (?, ?, ?)
      `,
      [id, preparedText, JSON.stringify(embedding)]
    );
  }

  return {
    initializeDatabase,
    persistDatabase,
    getDocuments,
    generateEmbedding,
    saveDocumentWithEmbedding,
  };
}

module.exports = {
  createDbService,
};
