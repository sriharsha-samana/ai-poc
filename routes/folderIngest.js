const fs = require("fs");
const path = require("path");
const ignore = require("ignore");

const DEFAULT_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  "target",
  "bin",
  "obj",
]);

const DEFAULT_EXCLUDED_FILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "poetry.lock",
  "cargo.lock",
  "pipfile.lock",
]);

const DEFAULT_EXCLUDED_SUFFIXES = [
  ".min.js",
  ".min.css",
  ".map",
  ".log",
  ".tmp",
  ".lock",
];

function normalizeRelPath(targetPath, rootPath) {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function normalizeRepoTag(tag) {
  return String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function shouldExcludeByDefault(fullPath, entryName, isDirectory) {
  const lowerName = entryName.toLowerCase();

  if (isDirectory) {
    return DEFAULT_EXCLUDED_DIRS.has(lowerName);
  }

  if (DEFAULT_EXCLUDED_FILE_NAMES.has(lowerName)) {
    return true;
  }

  if (lowerName.startsWith(".env")) {
    return true;
  }

  const lowerPath = fullPath.toLowerCase();
  return DEFAULT_EXCLUDED_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix));
}

function createDiscoveryStats() {
  return {
    excludedByDefaultDir: 0,
    excludedByDefaultFile: 0,
    excludedByGitignoreDir: 0,
    excludedByGitignoreFile: 0,
    maxFilesReached: false,
  };
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

function stringifySafe(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function formatFailureReason(error) {
  const status = error?.response?.status;
  const statusText = error?.response?.statusText;
  const responseData = stringifySafe(error?.response?.data);
  const parts = [];

  if (status) {
    parts.push(`HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
  }

  if (responseData) {
    const compact = responseData.length > 1000 ? `${responseData.slice(0, 1000)}...` : responseData;
    parts.push(`response: ${compact}`);
  }

  if (error?.message) {
    parts.push(`message: ${error.message}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Unknown ingestion failure";
}

function getEligibleFiles(rootPath, maxFiles) {
  const matcher = loadGitignoreMatcher(rootPath);
  const results = [];
  const stack = [rootPath];
  const discoveryStats = createDiscoveryStats();

  outer: while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = normalizeRelPath(fullPath, rootPath);

      if (entry.isDirectory()) {
        if (shouldExcludeByDefault(fullPath, entry.name, true)) {
          discoveryStats.excludedByDefaultDir += 1;
          continue;
        }

        if (matcher.ignores(`${relPath}/`)) {
          discoveryStats.excludedByGitignoreDir += 1;
          continue;
        }

        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (shouldExcludeByDefault(fullPath, entry.name, false)) {
        discoveryStats.excludedByDefaultFile += 1;
        continue;
      }

      if (matcher.ignores(relPath)) {
        discoveryStats.excludedByGitignoreFile += 1;
        continue;
      }

      results.push(fullPath);
      if (results.length >= maxFiles) {
        discoveryStats.maxFilesReached = true;
        break outer;
      }
    }
  }

  return {
    files: results,
    discoveryStats,
  };
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
        maxFiles = 2000,
        chunkSize = 3000,
        chunkOverlap = 200,
        dryRun = false,
        repoTag,
      } = req.body;

      if (!folderPath) {
        return res.status(400).json({ error: "Missing required field: folderPath" });
      }

      const resolvedRoot = path.resolve(folderPath);
      if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
        return res.status(400).json({ error: "folderPath must be a valid directory" });
      }

      const safeMaxFiles = Math.max(1, Number(maxFiles) || 2000);
      const safeChunkSize = Math.max(500, Number(chunkSize) || 3000);
      const safeChunkOverlap = Math.max(0, Number(chunkOverlap) || 0);
      const safeDryRun = Boolean(dryRun);
      const safeRepoTag = normalizeRepoTag(repoTag || path.basename(resolvedRoot));

      if (!safeRepoTag) {
        return res.status(400).json({ error: "repoTag is invalid" });
      }
      const { files, discoveryStats } = getEligibleFiles(resolvedRoot, safeMaxFiles);

      let ingestedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let chunkedFileCount = 0;
      let plannedIngestCount = 0;
      let skippedEmptyOrBinaryCount = 0;
      const failures = [];
      const samplePlannedDocuments = [];

      for (const filePath of files) {
        const relPath = normalizeRelPath(filePath, resolvedRoot);

        try {
          const content = fs.readFileSync(filePath, "utf8");
          if (!content.trim() || !isLikelyTextFile(content)) {
            skippedCount += 1;
            skippedEmptyOrBinaryCount += 1;
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
              ? `file:${safeRepoTag}:${relPath}#chunk-${index + 1}`
              : `file:${safeRepoTag}:${relPath}`;
            const header = isChunked
              ? `Repository: ${safeRepoTag}\nFile: ${relPath} (chunk ${index + 1}/${chunks.length})`
              : `Repository: ${safeRepoTag}\nFile: ${relPath}`;
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
              await saveDocumentWithEmbedding(documentId, text, {
                repoTag: safeRepoTag,
              });
              ingestedCount += 1;
            }
          }
        } catch (fileError) {
          failedCount += 1;
          failures.push({ path: relPath, reason: formatFailureReason(fileError) });
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
        repoTag: safeRepoTag,
        folderPath: resolvedRoot,
        totalMatched: files.length,
        ingestedCount,
        plannedIngestCount,
        chunkedFileCount,
        chunkSize: safeChunkSize,
        chunkOverlap: Math.min(safeChunkOverlap, safeChunkSize - 1),
        appliedExtensions: "all",
        skippedCount,
        skippedReasons: {
          contentEmptyOrBinary: skippedEmptyOrBinaryCount,
          excludedByDefaultDir: discoveryStats.excludedByDefaultDir,
          excludedByDefaultFile: discoveryStats.excludedByDefaultFile,
          excludedByGitignoreDir: discoveryStats.excludedByGitignoreDir,
          excludedByGitignoreFile: discoveryStats.excludedByGitignoreFile,
          maxFilesReached: discoveryStats.maxFilesReached,
        },
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
