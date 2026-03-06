/**
 * Unit tests for chat-formatter: URLs intact, only https linkified, no line-splits in URLs.
 * Run: npm run test:formatter
 */

import { strict as assert } from "node:assert";
import {
  escapeHtml,
  isHttpsUrl,
  linkifyToHtml,
  linkifyToMarkdown,
  preserveUrlsInPlainText,
  formatBodyForChat,
} from "./chat-formatter";

function ok(cond: boolean, msg: string) {
  assert.ok(cond, msg);
}

// --- escapeHtml
assert.equal(escapeHtml("a<b>c"), "a&lt;b&gt;c", "escapeHtml escapes < and >");
assert.equal(escapeHtml('"x"'), "&quot;x&quot;", "escapeHtml escapes quotes");
assert.equal(escapeHtml("a&b"), "a&amp;b", "escapeHtml escapes &");

// --- isHttpsUrl
ok(isHttpsUrl("https://example.com/path"), "valid https URL");
ok(!isHttpsUrl("http://example.com"), "http is not allowed");
ok(!isHttpsUrl("https://example.com/path with space"), "no spaces in URL");
ok(!isHttpsUrl("javascript:alert(1)"), "no javascript");

// --- linkifyToHtml: only https, safe attributes
const html1 = linkifyToHtml("Buy here: https://example.com/product/123");
ok(html1.includes('<a href="https://example.com/product/123"'), "HTML contains safe anchor");
ok(html1.includes("rel=\"noopener noreferrer\""), "anchor has rel");
ok(!html1.includes("http://"), "no http linkified");
const xss = linkifyToHtml('Click <script>alert(1)</script> https://safe.com');
ok(xss.includes("&lt;script&gt;"), "HTML escaped around URL");
ok(xss.includes("https://safe.com"), "URL still linkified");

// --- linkifyToMarkdown
const md = linkifyToMarkdown("See https://example.com/foo");
assert.equal(md, "See [https://example.com/foo](https://example.com/foo)", "markdown link format");

// --- preserveUrlsInPlainText: URL split across lines is joined
const broken = "Buy here:\nhttps://example.com\n/page";
const fixed = preserveUrlsInPlainText(broken);
ok(fixed.includes("https://example.com/page"), "URL split across lines is joined");
const singleLine = "https://petstoredirectdev.myshopify.com/products/andis-10ft";
assert.equal(preserveUrlsInPlainText(singleLine), singleLine, "single-line URL unchanged");

// --- formatBodyForChat: URLs remain intact in body_text; URL on own line for widget auto-linkify
const withUrl = "Price: $79.99. Buy: https://shop.com/product/123";
const plain = formatBodyForChat(withUrl, "plain");
assert.ok(plain.body_text.includes("https://shop.com/product/123"), "plain body_text contains URL");
assert.ok(plain.body_text.startsWith("Price: $79.99. Buy:"), "plain body_text preserves text");
ok(plain.body_html.includes("&lt;") || plain.body_html.includes("https://"), "body_html has content");

const asHtml = formatBodyForChat(withUrl, "html");
ok(asHtml.body_html.includes("<a href="), "html format has anchor");
assert.ok(asHtml.body_text.includes("https://shop.com/product/123"), "html body_text contains URL");

const asMd = formatBodyForChat(withUrl, "markdown");
ok(asMd.body_text.includes("[https://") && asMd.body_text.includes("](https://"), "markdown body_text has markdown link");

// --- html format strips ** so widget does not sanitize our <a> tags
const withBold = "**Price**: $34.99. **Buy Now**: https://example.com/p";
const htmlBold = formatBodyForChat(withBold, "html");
ok(!htmlBold.body_html.includes("**"), "html body_html has no literal ** (markdown stripped)");
ok(htmlBold.body_html.includes("<a href="), "html body_html still has anchor");

// --- stitch broken URLs like myshopify.c\\nom
const brokenUrl = "Buy now: https://petstoredirectdev.myshopify.c\nom/products/andis-nail-clipper-for-dog-grooming";
const stitched = formatBodyForChat(brokenUrl, "html");
ok(stitched.body_html.includes("href=\"https://petstoredirectdev.myshopify.com/products/andis-nail-clipper-for-dog-grooming\""), "broken URL stitched in href");

const brokenScheme = "Go: https:\n//example.com/path";
const stitchedScheme = formatBodyForChat(brokenScheme, "html");
ok(stitchedScheme.body_html.includes("href=\"https://example.com/path\""), "broken scheme https:\\n// stitched");

// --- do NOT glue next sentence into URL (this caused 404s)
const glueBug = "Buy Now: https://petstoredirectdev.myshopify.com/products/andis-pulse-zr-ii-purple-galaxy-limited-edition-clipper\nPlease let me know if you have any other questions";
const glueFixed = formatBodyForChat(glueBug, "html");
ok(!glueFixed.body_html.includes("clipperPlease"), "url should not swallow next line text");
ok(glueFixed.body_html.includes("href=\"https://petstoredirectdev.myshopify.com/products/andis-pulse-zr-ii-purple-galaxy-limited-edition-clipper\""), "href ends at product handle");

// --- do NOT keep glued letters even if there is no whitespace
const glueNoWhitespace = "Buy Now: https://petstoredirectdev.myshopify.com/products/andis-pulse-zr-ii-purple-galaxy-limited-edition-clipperPleaseletmeknow";
const glueNoWhitespaceFixed = formatBodyForChat(glueNoWhitespace, "html");
ok(!glueNoWhitespaceFixed.body_html.includes("clipperPlease"), "no-whitespace glue removed");
ok(glueNoWhitespaceFixed.body_html.includes("href=\"https://petstoredirectdev.myshopify.com/products/andis-pulse-zr-ii-purple-galaxy-limited-edition-clipper\""), "no-whitespace href clamped to handle");

// --- no https URL in body_text is not broken
const noUrl = "Just text.";
assert.equal(formatBodyForChat(noUrl, "plain").body_text, noUrl, "no URL text unchanged");

console.log("chat-formatter tests passed.");
process.exit(0);
