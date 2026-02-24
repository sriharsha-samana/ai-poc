const axios = require("axios");

function buildConfluenceAuthHeaders({ email, apiToken, bearerToken }) {
  if (bearerToken) {
    return {
      Authorization: `Bearer ${bearerToken}`,
    };
  }

  if (email && apiToken) {
    const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return {
      Authorization: `Basic ${credentials}`,
    };
  }

  return {};
}

function normalizeConfluenceBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function getConfluenceApiCandidates(baseUrl) {
  const normalized = normalizeConfluenceBaseUrl(baseUrl);
  const candidates = [`${normalized}/wiki/rest/api`, `${normalized}/rest/api`];
  return [...new Set(candidates)];
}

function decodeHtmlEntities(text) {
  const namedEntities = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };

  return text
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => namedEntities[entity] || entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToPlainText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function fetchConfluenceSpacePages({
  baseUrl,
  spaceKey,
  authHeaders,
  pageSize,
  maxPages,
}) {
  const apiCandidates = getConfluenceApiCandidates(baseUrl);
  let lastError;

  for (const apiBase of apiCandidates) {
    try {
      const pages = [];
      let start = 0;

      while (true) {
        const response = await axios.get(`${apiBase}/content`, {
          headers: authHeaders,
          params: {
            spaceKey,
            type: "page",
            status: "current",
            expand: "body.storage,version",
            limit: pageSize,
            start,
          },
          timeout: 30000,
        });

        const results = response.data.results || [];
        for (const page of results) {
          pages.push(page);
          if (maxPages && pages.length >= maxPages) {
            return pages;
          }
        }

        const hasNext = Boolean(response.data?._links?.next);
        if (!hasNext || results.length === 0) {
          break;
        }

        start += pageSize;
      }

      return pages;
    } catch (error) {
      lastError = error;
      if (error.response && [400, 401, 403].includes(error.response.status)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Failed to fetch Confluence pages");
}

async function ingestConfluenceSpace({
  baseUrl,
  spaceKey,
  email,
  apiToken,
  bearerToken,
  pageSize = 25,
  maxPages,
  saveDocumentWithEmbedding,
}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const safeMaxPages = maxPages ? Math.max(Number(maxPages), 1) : undefined;

  const pages = await fetchConfluenceSpacePages({
    baseUrl,
    spaceKey,
    authHeaders: buildConfluenceAuthHeaders({ email, apiToken, bearerToken }),
    pageSize: safePageSize,
    maxPages: safeMaxPages,
  });

  if (pages.length === 0) {
    return {
      message: "No pages found in the specified Confluence space",
      spaceKey,
      ingestedCount: 0,
      failedCount: 0,
      totalFetched: 0,
    };
  }

  let ingestedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const page of pages) {
    try {
      const pageText = htmlToPlainText(page.body?.storage?.value || "");
      const title = page.title || "Untitled";
      const webUiPath = page._links?.webui || "";
      const pageUrl = webUiPath
        ? `${normalizeConfluenceBaseUrl(baseUrl)}${webUiPath}`
        : normalizeConfluenceBaseUrl(baseUrl);
      const content = `Title: ${title}\nURL: ${pageUrl}\n\n${pageText}`;

      if (!pageText) {
        failedCount += 1;
        failures.push({
          pageId: page.id,
          title,
          reason: "Page has no text content",
        });
        continue;
      }

      const documentId = `confluence:${spaceKey}:${page.id}`;
      await saveDocumentWithEmbedding(documentId, content);
      ingestedCount += 1;
    } catch (pageError) {
      failedCount += 1;
      failures.push({
        pageId: page.id,
        title: page.title,
        reason: pageError.message,
      });
    }
  }

  return {
    message: "Confluence space ingestion completed",
    spaceKey,
    totalFetched: pages.length,
    ingestedCount,
    failedCount,
    failures: failures.slice(0, 25),
  };
}

module.exports = {
  ingestConfluenceSpace,
};
