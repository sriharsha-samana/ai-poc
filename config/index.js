const path = require("path");
const dotenv = require("dotenv");

let envLoaded = false;

function ensureEnvLoaded(projectRoot) {
  if (envLoaded) {
    return;
  }

  dotenv.config({ path: path.join(projectRoot, ".env") });
  envLoaded = true;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getConfig(projectRoot = path.resolve(__dirname, "..")) {
  ensureEnvLoaded(projectRoot);

  return {
    port: toPositiveInt(process.env.PORT, 3000),
    dbFilePath:
      process.env.DB_FILE_PATH || path.join(projectRoot, "data", "rag.db"),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    models: {
      embedding: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
      generation: process.env.OLLAMA_GEN_MODEL || "phi3:mini",
    },
    maxIngestChars: toPositiveInt(process.env.MAX_INGEST_CHARS, 12000),
  };
}

module.exports = {
  getConfig,
};
