const fs = require("fs");
const path = require("path");
const ignore = require("ignore");

const DEFAULT_EXTENSIONS = [
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".cpp",
  ".c",
  ".h",
  ".cs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".html",
  ".css",
  ".scss",
  ".sql",
  ".sh",
  ".xml",
  ".toml",
  ".ini",
  ".conf",
  ".env",
];

function normalizeRelPath(targetPath, rootPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function loadGitignoreMatcher(rootPath) {
  const gitignorePath = path.join(rootPath, ".gitignore");
  const matcher = ignore();

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    matcher.add(content);
  }

  return matcher;
}

function isLikelyTextFile(content) {
  return !content.includes("\u0000");
}

function chunkText(content, chunkSize, chunkOverlap) {
  if (!content || content.length <= chunkSize) {
    return [content];
  }

  const chunks = [];
  const safeOverlap = Math.min(Math.max(chunkOverlap, 0), chunkSize - 1);
  const step = Math.max(1, chunkSize - safeOverlap);

  for (let start = 0; start < content.length; start += step) {
    const end = Math.min(content.length, start + chunkSize);
    const chunk = content.slice(start, end);
    if (!chunk) {
      continue;
    }

    chunks.push(chunk);
    if (end >= content.length) {
      break;
    }
  }

  return chunks;
}

function getEligibleFiles(rootPath, extensionSet, maxFiles) {
  const matcher = loadGitignoreMatcher(rootPath);
  const results = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = normalizeRelPath(fullPath, rootPath);

      if (entry.isDirectory()) {
        if (matcher.ignores(`${relPath}/`)) {
          continue;
        }

        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (matcher.ignores(relPath)) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!extensionSet.has(ext)) {
        continue;
      }

      results.push(fullPath);
      if (results.length >= maxFiles) {
        return results;
      }
    }
  }

  return results;
}

function registerFolderIngestRoutes(
  app,
  { dbReady, saveDocumentWithEmbedding, persistDatabase }
) {
  app.post("/ingest/folder", async (req, res) => {
    try {
      await dbReady;

      const {
        folderPath,
        extensions = DEFAULT_EXTENSIONS,
        maxFiles = 2000,
        chunkSize = 8000,
        chunkOverlap = 500,
        dryRun = false,
      } = req.body;

      if (!folderPath) {
        return res.status(400).json({ error: "Missing required field: folderPath" });
      }

      const resolvedRoot = path.resolve(folderPath);
      if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        return res.status(400).json({ error: "folderPath must be a valid directory" });
      }

      const safeMaxFiles = Math.max(1, Number(maxFiles) || 2000);
      const safeChunkSize = Math.max(500, Number(chunkSize) || 8000);
      const safeChunkOverlap = Math.max(0, Number(chunkOverlap) || 0);
      const safeDryRun = Boolean(dryRun);
      const extensionSet = new Set(
        (Array.isArray(extensions) && extensions.length > 0
          ? extensions
          : DEFAULT_EXTENSIONS
        ).map((ext) => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
      );

      const files = getEligibleFiles(resolvedRoot, extensionSet, safeMaxFiles);

      let ingestedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let chunkedFileCount = 0;
      let plannedIngestCount = 0;
      const failures = [];
      const samplePlannedDocuments = [];

      for (const filePath of files) {
        const relPath = normalizeRelPath(filePath, resolvedRoot);

        try {
          const content = fs.readFileSync(filePath, "utf8");
          if (!content.trim() || !isLikelyTextFile(content)) {
            skippedCount += 1;
            continue;
          }

          const chunks = chunkText(content, safeChunkSize, safeChunkOverlap);
          if (chunks.length > 1) {
            chunkedFileCount += 1;
          }

          for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            const isChunked = chunks.length > 1;
            const documentId = isChunked
              ? `file:${relPath}#chunk-${index + 1}`
              : `file:${relPath}`;
            const header = isChunked
              ? `File: ${relPath} (chunk ${index + 1}/${chunks.length})`
              : `File: ${relPath}`;
            const text = `${header}\n\n${chunk}`;

            if (safeDryRun) {
              plannedIngestCount += 1;
              if (samplePlannedDocuments.length < 25) {
                samplePlannedDocuments.push({
                  id: documentId,
                  path: relPath,
                  chunk: isChunked ? `${index + 1}/${chunks.length}` : "1/1",
                });
              }
            } else {
              await saveDocumentWithEmbedding(documentId, text);
              ingestedCount += 1;
            }
          }
        } catch (fileError) {
          failedCount += 1;
          failures.push({ path: relPath, reason: fileError.message });
        }
      }

      if (!safeDryRun) {
        persistDatabase();
      }

      res.json({
        message: safeDryRun
          ? "Folder dry run completed"
          : "Folder ingestion completed",
        dryRun: safeDryRun,
        folderPath: resolvedRoot,
        totalMatched: files.length,
        ingestedCount,
        plannedIngestCount,
        chunkedFileCount,
        chunkSize: safeChunkSize,
        chunkOverlap: Math.min(safeChunkOverlap, safeChunkSize - 1),
        skippedCount,
        failedCount,
        samplePlannedDocuments,
        failures: failures.slice(0, 25),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Failed to ingest folder",
        details: err.message,
      });
    }
  });
}

module.exports = registerFolderIngestRoutes;
