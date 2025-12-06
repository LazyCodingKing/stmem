/**
 * Summarizer Module - Text summarization
 */
export class Summarizer {
  constructor(config) {
    this.config = config;
  }

  async summarize(text) {
    try {
      if (!text || text.trim().length === 0) {
        return null;
      }

      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length === 0) return text;

      const ratio = this.getSummaryRatio(this.config.summaryLength || 'medium');
      const numSentences = Math.max(1, Math.ceil(sentences.length * ratio));

      const scored = sentences.map((s, i) => ({
        text: s.trim(),
        index: i,
        score: this.scoreSentence(s),
      }));

      const top = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, numSentences)
        .sort((a, b) => a.index - b.index)
        .map(s => s.text);

      return top.join('. ') + '.';
    } catch (error) {
      console.error('Summarization error:', error);
      return null;
    }
  }

  getSummaryRatio(length) {
    const ratios = { short: 0.3, medium: 0.5, long: 0.7 };
    return ratios[length] || 0.5;
  }

  scoreSentence(sentence) {
    const words = sentence.split(/\s+/).length;
    return Math.min(words, 50) / 50;
  }
}
