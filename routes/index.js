const registerRagRoutes = require("./rag");
const registerConfluenceRoutes = require("../confluence/routes");

function registerRoutes(app, routeDependencies) {
  registerRagRoutes(app, routeDependencies);
  registerConfluenceRoutes(app, routeDependencies);
}

module.exports = registerRoutes;
