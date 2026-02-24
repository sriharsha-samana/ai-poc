const { createApp } = require("./app/createApp");

const { app, port } = createApp();

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});