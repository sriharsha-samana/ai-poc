const registerRagRoutes = require("./rag");
const registerFolderIngestRoutes = require("./folderIngest");
const registerConfluenceRoutes = require("../confluence/routes");

function registerRoutes(app, routeDependencies) {
  registerRagRoutes(app, routeDependencies);
  registerFolderIngestRoutes(app, routeDependencies);
  registerConfluenceRoutes(app, routeDependencies);
}

module.exports = registerRoutes;
