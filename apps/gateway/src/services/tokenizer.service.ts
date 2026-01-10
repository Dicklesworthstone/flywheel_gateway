/**
 * Tokenizer Service - Token counting for context budget management.
 *
 * Provides efficient token estimation for Claude models.
 * Uses a heuristic-based approach that's fast and reasonably accurate.
 */

/**
 * Average characters per token for Claude models.
 * Claude uses a BPE tokenizer similar to GPT; ~4 chars per token on average.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Adjustment factor for code content (tends to have more tokens per char).
 */
const CODE_ADJUSTMENT = 0.85;

/**
 * Adjustment factor for structured content (JSON, XML).
 */
const STRUCTURED_ADJUSTMENT = 0.75;

/**
 * Count tokens in a string.
 *
 * Uses a fast heuristic-based approach. For Claude models, this is
 * typically accurate within 10% of the actual token count.
 *
 * @param text - Text to count tokens for
 * @returns Estimated token count
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  // Base estimate from character count
  let estimate = text.length / CHARS_PER_TOKEN;

  // Adjust for content type
  if (looksLikeCode(text)) {
    estimate /= CODE_ADJUSTMENT;
  } else if (looksLikeStructured(text)) {
    estimate /= STRUCTURED_ADJUSTMENT;
  }

  // Add overhead for whitespace and special characters
  const whitespaceRatio = (text.match(/\s/g)?.length ?? 0) / text.length;
  if (whitespaceRatio > 0.2) {
    estimate *= 1 + (whitespaceRatio - 0.2) * 0.5;
  }

  return Math.ceil(estimate);
}

/**
 * Count tokens for multiple strings.
 *
 * @param texts - Array of texts
 * @returns Total token count
 */
export function countTokensMultiple(texts: string[]): number {
  return texts.reduce((sum, text) => sum + countTokens(text), 0);
}

/**
 * Truncate text to fit within a token budget.
 *
 * @param text - Text to truncate
 * @param maxTokens - Maximum tokens allowed
 * @param ellipsis - String to append when truncating
 * @returns Truncated text
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  ellipsis: string = "...",
): string {
  if (!text) return text;
  if (maxTokens <= 0) return "";

  const currentTokens = countTokens(text);
  if (currentTokens <= maxTokens) return text;

  // Estimate characters to keep
  const ellipsisTokens = countTokens(ellipsis);
  if (ellipsisTokens >= maxTokens) {
    return ellipsisTokens === maxTokens ? ellipsis : "";
  }
  const targetTokens = maxTokens - ellipsisTokens;
  const targetChars = Math.floor(text.length * (targetTokens / currentTokens));

  // Find a good break point (word boundary)
  let truncateAt = Math.min(targetChars, text.length - 1);
  while (truncateAt > 0 && !/\s/.test(text[truncateAt] || "")) {
    truncateAt--;
  }

  if (truncateAt === 0) {
    truncateAt = targetChars;
  }

  return text.slice(0, truncateAt).trimEnd() + ellipsis;
}

/**
 * Split text into chunks that fit within a token budget.
 *
 * @param text - Text to split
 * @param maxTokensPerChunk - Maximum tokens per chunk
 * @returns Array of text chunks
 */
export function splitIntoChunks(
  text: string,
  maxTokensPerChunk: number,
): string[] {
  if (!text) return [];
  if (maxTokensPerChunk <= 0) return [];

  const totalTokens = countTokens(text);
  if (totalTokens <= maxTokensPerChunk) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  let currentTokens = 0;

  // Token cost of separators
  const paragraphSeparatorTokens = countTokens("\n\n");
  const sentenceSeparatorTokens = countTokens(" ");

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);
    const separatorCost = currentChunk ? paragraphSeparatorTokens : 0;

    if (currentTokens + separatorCost + paraTokens <= maxTokensPerChunk) {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
      currentTokens += separatorCost + paraTokens;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      if (paraTokens > maxTokensPerChunk) {
        // Paragraph itself is too long, split by sentences
        const sentences = para.split(/(?<=[.!?])\s+/);
        currentChunk = "";
        currentTokens = 0;

        for (const sentence of sentences) {
          const sentTokens = countTokens(sentence);
          const sentSeparatorCost = currentChunk ? sentenceSeparatorTokens : 0;

          if (
            currentTokens + sentSeparatorCost + sentTokens <=
            maxTokensPerChunk
          ) {
            currentChunk += (currentChunk ? " " : "") + sentence;
            currentTokens += sentSeparatorCost + sentTokens;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
            }
            if (sentTokens > maxTokensPerChunk) {
              const truncated = truncateToTokens(sentence, maxTokensPerChunk);
              if (truncated) {
                chunks.push(truncated);
              }
              currentChunk = "";
              currentTokens = 0;
            } else {
              currentChunk = sentence;
              currentTokens = sentTokens;
            }
          }
        }
      } else {
        currentChunk = para;
        currentTokens = paraTokens;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Estimate if text looks like code.
 */
function looksLikeCode(text: string): boolean {
  // Check for common code indicators
  const codePatterns = [
    /^import\s+/m,
    /^export\s+/m,
    /^function\s+/m,
    /^class\s+/m,
    /^const\s+/m,
    /^let\s+/m,
    /^var\s+/m,
    /^\s*\/\//m,
    /^\s*\/\*/m,
    /[{}[\]();]/,
    /=>/,
  ];

  let matches = 0;
  for (const pattern of codePatterns) {
    if (pattern.test(text)) matches++;
  }

  return matches >= 3;
}

/**
 * Estimate if text looks like structured data (JSON, XML).
 */
function looksLikeStructured(text: string): boolean {
  const trimmed = text.trim();

  // JSON
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return true;
  }

  // XML/HTML
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return true;
  }

  return false;
}
