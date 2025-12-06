/**
 * Summarizer Module - Handles text summarization logic
 */
export class Summarizer {
  constructor(config) {
    this.config = config;
    this.minChars = 100;
    this.maxChars = 5000;
  }

  /**
   * Summarize text using extractive summarization
   * @param {string} text - Text to summarize
   * @returns {Promise<string>} - Summarized text
   */
  async summarize(text) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Text is empty');
      }

      // Validate input
      if (text.length < this.minChars) {
        return text; // Too short to summarize
      }

      if (text.length > this.maxChars) {
        text = text.substring(0, this.maxChars);
      }

      // Choose summarization strategy
      const strategy = this.config.summaryLength || 'medium';
      const ratio = this.getSummaryRatio(strategy);

      // Extract key sentences
      const sentences = this.extractSentences(text);
      const summary = this.extractKeySentences(sentences, ratio);

      return summary.join(' ').trim();
    } catch (error) {
      console.error('Summarization error:', error);
      return null;
    }
  }

  /**
   * Get summary ratio based on length preference
   * @param {string} length - 'short', 'medium', or 'long'
   * @returns {number} - Ratio between 0 and 1
   */
  getSummaryRatio(length) {
    const ratios = {
      short: 0.3,
      medium: 0.5,
      long: 0.7,
    };
    return ratios[length] || 0.5;
  }

  /**
   * Extract sentences from text
   * @param {string} text - Input text
   * @returns {Array<string>} - Array of sentences
   */
  extractSentences(text) {
    // Split by common sentence endings
    return text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Extract key sentences using TF-IDF like scoring
   * @param {Array<string>} sentences - Array of sentences
   * @param {number} ratio - Summary ratio
   * @returns {Array<string>} - Key sentences in order
   */
  extractKeySentences(sentences, ratio) {
    if (sentences.length === 0) return [];

    const numSentences = Math.max(1, Math.ceil(sentences.length * ratio));

    // Score sentences based on keywords and length
    const scored = sentences.map((sentence, index) => ({
      sentence,
      index,
      score: this.scoreSentence(sentence),
    }));

    // Sort by score and keep order
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, numSentences)
      .sort((a, b) => a.index - b.index)
      .map((item) => item.sentence);
  }

  /**
   * Score a sentence for importance
   * @param {string} sentence - Sentence to score
   * @returns {number} - Score
   */
  scoreSentence(sentence) {
    let score = 0;

    // Longer sentences tend to be more important
    score += sentence.split(' ').length * 0.1;

    // Count unique words
    const words = sentence.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    score += uniqueWords.size * 0.05;

    // Penalize very short sentences
    if (words.length < 3) {
      score *= 0.5;
    }

    return score;
  }

  /**
   * Clear cache (if any)
   */
  clear() {
    // Placeholder for cache clearing
  }
}
