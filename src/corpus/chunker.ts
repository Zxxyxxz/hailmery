// V0 chunker: token-based sliding window over markdown.
//
// V1 will get section-aware splitting (preserve H1/H2 boundaries) and PDF/DOCX
// text extraction. For V0 we accept that headers may straddle chunks — they
// still embed as informative context.

export { chunkByTokens as chunkMarkdown } from '../lib/tokens.js';
