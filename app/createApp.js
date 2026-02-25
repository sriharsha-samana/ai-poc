const express = require("express");
const path = require("path");
const registerRoutes = require("../routes");
const { createDbService } = require("../db/service");
const { getConfig } = require("../config");

function createApp() {
  const app = express();
  const projectRoot = path.resolve(__dirname, "..");
  const config = getConfig(projectRoot);

  app.use(express.json());
  app.use(express.static(projectRoot));

  const {
    initializeDatabase,
    persistDatabase,
    getDocuments,
    getRepoTags,
    getIngestedFilePaths,
    generateEmbedding,
    saveDocumentWithEmbedding,
  } = createDbService({
    dbFilePath: config.dbFilePath,
    embeddingModel: config.models.embedding,
    maxIngestChars: config.maxIngestChars,
    ollamaBaseUrl: config.ollamaBaseUrl,
  });

  const dbReady = initializeDatabase();

  registerRoutes(app, {
    dbReady,
    persistDatabase,
    saveDocumentWithEmbedding,
    getDocuments,
    getRepoTags,
    getIngestedFilePaths,
    generateEmbedding,
    generationModel: config.models.generation,
    ollamaBaseUrl: config.ollamaBaseUrl,
  });

  return {
    app,
    port: config.port,
  };
}

module.exports = {
  createApp,
};
