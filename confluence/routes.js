const { ingestConfluenceSpace } = require("./service");

function registerConfluenceRoutes(
  app,
  { dbReady, saveDocumentWithEmbedding, persistDatabase }
) {
  app.post("/ingest/confluence-space", async (req, res) => {
    try {
      await dbReady;

      const { baseUrl, spaceKey, email, apiToken, bearerToken, pageSize, maxPages } =
        req.body;

      if (!baseUrl || !spaceKey) {
        return res.status(400).json({
          error: "Missing required fields: baseUrl, spaceKey",
        });
      }

      if (!bearerToken && !(email && apiToken)) {
        return res.status(400).json({
          error: "Provide either bearerToken or both email and apiToken",
        });
      }

      const result = await ingestConfluenceSpace({
        baseUrl,
        spaceKey,
        email,
        apiToken,
        bearerToken,
        pageSize,
        maxPages,
        saveDocumentWithEmbedding,
      });

      persistDatabase();
      res.json(result);
    } catch (err) {
      console.error(err);

      const statusCode = err.response?.status || 500;
      if (statusCode >= 400 && statusCode < 500) {
        return res.status(statusCode).json({
          error:
            "Failed to fetch Confluence content. Check URL, space key, and credentials.",
          details: err.response?.data || err.message,
        });
      }

      res.status(500).json({
        error: "Failed to ingest Confluence space",
        details: err.message,
      });
    }
  });
}

module.exports = registerConfluenceRoutes;
