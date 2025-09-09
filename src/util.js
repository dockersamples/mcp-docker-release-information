/*
 * For full disclaimer, most of this file was written by AI.
 */

/**
 * Extract the last N releases (newest first) from the Docker Desktop release notes markdown.
 * @param {string} markdown
 * @param {number} n
 * @returns {string}
 */
export function parseReleases(markdown, n = 6) {
  // Normalize line endings
  const md = markdown.replace(/\r\n?/g, "\n");

  // Split by top-level "## <version>" headings; keep the heading in each chunk
  const blocks = [];
  const re = /^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s+|\Z)/gm;
  let match;
  while ((match = re.exec(md)) !== null) {
    const versionHeading = match[1].trim(); // e.g., "4.45.0"
    const body = match[2];

    // Version is usually the whole heading, but trim any trailing text just in case
    const version =
      (versionHeading.match(/^\s*([0-9]+\.[0-9]+\.[0-9]+)\b/) || [, ""])[1] ||
      versionHeading;

    // Date from Hugo shortcode: {{< release-date date="YYYY-MM-DD" >}}
    const dateMatch = body.match(
      /\{\{<\s*release-date\s+date="([^"]+)"\s*>\}\}/,
    );
    const date = dateMatch ? dateMatch[1] : null;

    // Remove known install shortcodes and the date shortcode lines
    let details = body
      .replace(/\{\{<\s*release-date[^>]*>\}\}\s*\n?/g, "")
      .replace(/\{\{<\s*desktop-install[^>]*>\}\}\s*\n?/g, "")
      .replace(/\{\{<\s*desktop-install-v2[^>]*>\}\}\s*\n?/g, "");

    // Trim excessive top/bottom whitespace
    details = details.trim();

    // Optional: collapse >!NOTE or >!WARNING markers to simple blockquotes for readability
    details = details.replace(/^>\s*\[!\w+\]\s*$/gm, ">"); // line with admonition header
    // Also strip trailing whitespace
    details = details.replace(/[ \t]+$/gm, "");

    blocks.push({ version, date, details });
  }

  // The document is newest-first; take the first N
  return blocks
    .slice(0, n)
    .map((r) => {
      const header = `## ${r.version}${r.date ? ` — ${r.date}` : ""}`;
      // Keep headings and bullet lists; strip leading extra blank lines
      const body = r.details.replace(/^\s+/, "");
      return `${header}\n${body}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Parse the Security Announcements markdown and return the latest N items.
 * Assumes sections start with "## " and contain a "_Last updated ..._" line.
 * @param {string} markdown
 * @param {number} [limit=6]
 * @returns {string}
 */
export function parseSecurityAnnouncements(markdown, limit = 6) {
  const src = String(markdown || "").replace(/\r\n?/g, "\n");

  // Split into sections by top-level "## " headings, capturing blocks until next "## " or EOF
  const blocks = [];
  const re = /^##\s+([^\n]+?)\s*\n([\s\S]*?)(?=^##\s+|\Z)/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const title = m[1].trim();
    let body = m[2].trim();

    // Strip page-level shortcodes / boilerplate we don't want inside details
    body = body.replace(/\{\{<\s*rss-button[^>]*>\}\}\s*\n?/gi, "").trim();

    // Extract the "_Last updated ..._" line
    const lastUpdatedLine = body.match(/^_Last updated\s+(.+?)_$/im);
    let lastUpdatedRaw = null;
    let lastUpdatedISO = null;
    if (lastUpdatedLine) {
      lastUpdatedRaw = lastUpdatedLine[1].trim();
      lastUpdatedISO = toISODateLoose(lastUpdatedRaw);
      // remove the line from details
      body = body.replace(lastUpdatedLine[0], "").trim();
    }

    // Product / version extraction from title (best-effort)
    // Examples:
    // "Docker Desktop 4.44.3 security update: CVE-2025-9074"
    // "Docker Security Advisory: Multiple Vulnerabilities in runc, BuildKit, and Moby"
    const { product, version } = extractProductAndVersion(title);

    // Collect CVE IDs mentioned anywhere in the section
    const cves = Array.from(
      new Set((title + "\n" + body).match(/CVE-\d{4}-\d{4,7}/gi) || []),
    ).sort();

    // Clean common site-specific shortcodes/admonitions
    body = body
      .replace(/^\s*>\s*\[!\w+\]\s*$/gim, ">") // collapse admonition headers to basic quote
      .replace(/[ \t]+$/gm, "")
      .trim();

    blocks.push({
      title,
      lastUpdatedISO,
      lastUpdatedRaw,
      product,
      version,
      cves,
      detailsMarkdown: body,
    });
  }

  // Sort newest first using lastUpdatedISO when available, else keep original order
  const withDate = blocks
    .filter((b) => !!b.lastUpdatedISO)
    .sort((a, b) =>
      (b.lastUpdatedISO || "").localeCompare(a.lastUpdatedISO || ""),
    );
  const withoutDate = blocks.filter((b) => !b.lastUpdatedISO);
  return formatAnnouncementsForLLM(
    [...withDate, ...withoutDate].slice(0, limit),
  );
}

/**
 * Format announcements for an LLM.
 * @param {SecurityAnnouncement[]} ann
 * @param {{mode?: "json"|"text", includeMarkdown?: boolean}} [opts]
 * @returns {string}
 */
function formatAnnouncementsForLLM(ann) {
  const lines = [];

  for (const a of ann) {
    const header = `\n## ${a.title}${a.lastUpdatedISO ? ` — updated ${a.lastUpdatedISO}` : ""}`;
    lines.push(header);
    if (a.product || a.version || (a.cves && a.cves.length)) {
      const metaBits = [];
      if (a.product) metaBits.push(`Product: ${a.product}`);
      if (a.version) metaBits.push(`Version: ${a.version}`);
      if (a.cves.length) metaBits.push(`CVEs: ${a.cves.join(", ")}`);
      lines.push(metaBits.map((s) => `- ${s}`).join("\n"));
    }
    lines.push("Details:");
    lines.push(indent(a.detailsMarkdown, 2));
  }
  return lines.join("\n");
}

/* ----------------------------- Helpers ------------------------------ */

function extractProductAndVersion(title) {
  // Heuristics for product + version from the H2 title.
  // Try "Docker Desktop 4.44.3 ..." first:
  const m = title.match(/^(Docker\s+\w+)\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  if (m) {
    return { product: m[1].trim(), version: m[2] };
  }
  // Try generic "... v1.2.3" or "... 1.2.3"
  const m2 = title.match(
    /^(.*?)[\s:,-]*v?([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?:\b|[^0-9])/i,
  );
  if (m2) {
    return {
      product:
        m2[1]
          .trim()
          .replace(/[:\-–]+$/, "")
          .trim() || null,
      version: m2[2],
    };
  }
  // No obvious version -> keep product if present like "Docker Desktop ..." or "Docker Security Advisory ..."
  const m3 = title.match(/^(Docker(?:\s+\w+)*)(?::|\s|$)/i);
  return { product: m3 ? m3[1].trim() : null, version: null };
}

function toISODateLoose(raw) {
  if (!raw) return null;

  // Normalize "July, 2024" -> "July 2024"
  const cleaned = raw.replace(/\s*,\s*(\d{4})/, " $1").trim();

  // ISO yyyy-mm-dd in text? return directly
  const iso = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  // Month DD, YYYY
  const long = cleaned.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/);
  if (long) {
    const [, mon, dd, yyyy] = long;
    const mm = monthToNum(mon);
    if (mm)
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  // Month YYYY (no day) -> pick 01
  const monthYear = cleaned.match(/\b([A-Za-z]+)\s+(\d{4})\b/);
  if (monthYear) {
    const [, mon, yyyy] = monthYear;
    const mm = monthToNum(mon);
    if (mm) return `${yyyy}-${String(mm).padStart(2, "0")}-01`;
  }

  // Fallback to Date.parse (best-effort)
  const t = Date.parse(cleaned);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }
  return null;
}

function monthToNum(name) {
  const m = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return m[String(name).toLowerCase()] || null;
}

function indent(text, spaces = 2) {
  const pad = " ".repeat(spaces);
  return String(text)
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");
}
