/**
 * Formats message body for Gorgias Chat Widget delivery.
 * Ensures URLs can be rendered as clickable links (plain, HTML, or markdown)
 * and that URLs are not broken by line wrapping in body_text.
 */

/** Match https URLs only (security: no javascript:, data:, etc.) — single line */
const HTTPS_URL_REGEX = /https:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * URL characters as defined by RFC 3986 (roughly). Used to stitch URLs that
 * get broken by newlines/whitespace in AI responses (e.g. "myshopify.c\nom/...").
 */
const URL_CHAR_REGEX = /[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/;

/**
 * Fix common Shopify "products/<handle>" URL corruption where text is appended
 * without a delimiter (e.g. ".../products/andis-clipperPleaseletme...").
 *
 * If we detect a Shopify product URL, we clamp the handle to `[a-z0-9-]+` and
 * only keep a suffix if it starts with URL delimiters like `?` or `#`.
 */
function clampShopifyProductUrl(url: string): string {
  const m = url.match(/^(https:\/\/[^/]+\/products\/)(.*)$/i);
  if (!m) return url;
  const prefix = m[1] ?? "";
  const rest = m[2] ?? "";
  if (!prefix || !rest) return url;

  let i = 0;
  while (i < rest.length && /[a-z0-9-]/.test(rest[i] ?? "")) i += 1;
  const handle = rest.slice(0, i);
  const suffix = rest.slice(i);
  if (!handle) return url;

  // Keep only valid URL suffix delimiters
  if (!suffix) return `${prefix}${handle}`;
  const first = suffix[0] ?? "";
  if (first === "?" || first === "#" || first === "/") return `${prefix}${handle}${suffix}`;
  // If suffix starts with letters (e.g. "Please"), it's almost certainly glued text; drop it.
  return `${prefix}${handle}`;
}

/**
 * Strip markdown that can cause the Shopify chat widget to sanitize or ignore body_html.
 * Literal "**" in HTML may trigger aggressive stripping; we keep only safe tags we add (<a>).
 */
function stripMarkdownForWidget(text: string): string {
  return text
    .replace(/\*\*([^*]*)\*\*/g, "$1") // **bold** → bold
    .replace(/\*([^*]*)\*/g, "$1")     // *italic* → italic
    .replace(/^#+\s+/gm, "")           // # heading → heading
    .trim();
}

/**
 * Normalize URL that was split across lines: replace newlines inside URL with space.
 * Matches https://... up to next newline that starts a new "token" (space or start of line after newline).
 */
function normalizeMultilineUrl(url: string): string {
  return url.replace(/\s+/g, " ").trim();
}

/**
 * Stitch URLs that are broken by whitespace/newlines by removing whitespace
 * *inside* https://... sequences, while leaving other whitespace intact.
 */
function stitchBrokenHttpsUrls(text: string): string {
  let out = "";
  let i = 0;
  const startRe = /https\s*:\s*\/\//gi; // matches https://, https:\n//, etc.
  startRe.lastIndex = 0;
  while (i < text.length) {
    startRe.lastIndex = i;
    const m = startRe.exec(text);
    if (!m || typeof m.index !== "number") {
      out += text.slice(i);
      break;
    }
    const idx = m.index;
    out += text.slice(i, idx);
    let j = idx + m[0].length;
    let url = "https://";
    // We start in host until we hit / ? #
    let inHost = true;
    while (j < text.length) {
      const ch = text[j] ?? "";
      if (URL_CHAR_REGEX.test(ch)) {
        if (inHost && (ch === "/" || ch === "?" || ch === "#")) inHost = false;
        url += ch;
        j += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        // Skip whitespace only if the next non-whitespace char can be part of a URL
        let k = j;
        while (k < text.length && /\s/.test(text[k] ?? "")) k += 1;
        const next = k < text.length ? (text[k] ?? "") : "";
        if (!next) break;
        // Never stitch into markdown/bullets/etc.
        if (/[*#\-\u2022]/.test(next)) break;

        if (inHost) {
          // Host can include letters/digits/dots/hyphens, so allow stitching across whitespace
          if (/[A-Za-z0-9.-]/.test(next)) {
            j = k;
            continue;
          }
          break;
        }

        // After host: only stitch if it looks like we broke mid-URL token, not into a new sentence.
        // - Always allow if next starts a URL delimiter
        if (/[/?#&%=._~-]/.test(next)) {
          j = k;
          continue;
        }
        // - Allow lowercase/digit continuation (common in Shopify handles) but NOT Uppercase words like "Please"
        if (/[a-z0-9]/.test(next)) {
          j = k;
          continue;
        }
        break;
      }
      break;
    }
    out += clampShopifyProductUrl(url);
    i = j;
  }
  return out;
}

/**
 * Escapes text for safe use inside HTML (no tags).
 * Does not alter URLs; use linkify* for that.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns true if the string is a valid https URL (no spaces, no dangerous protocols).
 */
export function isHttpsUrl(url: string): boolean {
  const t = url.trim();
  return t.startsWith("https://") && !/\s/.test(t);
}

/**
 * Replaces https URLs in text with safe <a href="...">...</a>.
 * Escapes non-URL text. Only https URLs are linkified.
 * Uses target="_blank" so links open in a new tab (matches Gorgias widget behavior).
 * Strips trailing punctuation from URLs so "https://example.com/product." → clean link + "." after.
 */
export function linkifyToHtml(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(HTTPS_URL_REGEX.source, "gi");
  while ((m = re.exec(text)) !== null) {
    let url = m[0];
    if (!isHttpsUrl(url)) continue;
    const trailingPunc = url.match(/[.,;:!?]+$/)?.[0] ?? "";
    const cleanUrl = trailingPunc ? url.slice(0, -trailingPunc.length) : url;
    if (!cleanUrl || !isHttpsUrl(cleanUrl)) continue;
    parts.push(escapeHtml(text.slice(lastIndex, m.index)));
    parts.push(
      `<a href="${escapeHtml(cleanUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanUrl)}</a>${trailingPunc}`
    );
    lastIndex = m.index + url.length;
  }
  parts.push(escapeHtml(text.slice(lastIndex)));
  return parts.join("");
}

/**
 * Replaces https URLs in text with markdown links [url](url).
 */
export function linkifyToMarkdown(text: string): string {
  return text.replace(HTTPS_URL_REGEX, (url) => {
    if (!isHttpsUrl(url)) return url;
    return `[${url}](${url})`;
  });
}

/**
 * Ensures body_text does not have URLs broken by newlines (widget may not auto-linkify across lines).
 * Joins lines that look like URL continuation (e.g. path on next line) into one line.
 * Puts each URL on its own line so widgets that auto-linkify "URL on newline" can show clickable links when they render body_text.
 */
export function preserveUrlsInPlainText(text: string): string {
  // First, stitch broken URLs like "myshopify.c\nom/..." back into a single https://... sequence
  let joined = stitchBrokenHttpsUrls(text);
  // Join "https://domain" + newline + "/path" so URL is on one line
  joined = joined.replace(/(https:\/\/[^\s]+)\s*\n\s*(\/[^\s]*)/gi, (_, prefix, path) =>
    `${prefix}${path}`
  );
  joined = joined.replace(HTTPS_URL_REGEX, (url) => normalizeMultilineUrl(url));
  // Ensure each URL is on its own line (helps widgets that auto-linkify URLs on newline when showing body_text)
  return joined.replace(/([^\n])(https:\/\/[^\s<>"{}|\\^`[\]]+)/gi, "$1\n$2");
}

export type ChatLinkFormat = "plain" | "html" | "markdown";

export interface FormattedChatBody {
  /** Plain text for body_text (and body); URLs preserved for auto-linkify. */
  body_text: string;
  /** HTML for body_html. If linkFormat is 'html', contains <a> tags for https URLs. */
  body_html: string;
}

/**
 * Format Abacus response for Gorgias chat payload.
 * - plain: body_html is escaped only (no links); body_text has URLs preserved (no mid-URL newlines).
 * - html: body_html includes safe <a href="https://..."> for https URLs.
 * - markdown: body_text has [url](url); body_html is escaped (widget may render markdown from body_text).
 */
export function formatBodyForChat(body: string, linkFormat: ChatLinkFormat): FormattedChatBody {
  const preserved = preserveUrlsInPlainText(body);
  let body_text: string;
  let bodyHtml: string;
  switch (linkFormat) {
    case "html":
      body_text = preserved;
      // Strip ** and * so body_html has no literal markdown; widget may otherwise strip our <a> tags
      const stitchedForHtml = stitchBrokenHttpsUrls(body);
      const cleanForHtml = stripMarkdownForWidget(stitchedForHtml);
      bodyHtml = linkifyToHtml(cleanForHtml);
      // Single <p> with <br>: widget may strip <a> when there are many <p> tags; smoke test used few paragraphs
      bodyHtml = `<p>${bodyHtml.replace(/\n/g, "<br>")}</p>`;
      break;
    case "markdown":
      body_text = linkifyToMarkdown(preserved);
      bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");
      bodyHtml = `<p>${bodyHtml}</p>`;
      break;
    default:
      body_text = preserved;
      bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");
      bodyHtml = `<p>${bodyHtml}</p>`;
  }
  return { body_text, body_html: bodyHtml };
}
