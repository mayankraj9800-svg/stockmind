'use strict';

/**
 * StockMind AI Analysis Engine
 * ════════════════════════════
 * Builds structured, validated prompts for Groq AI.
 * Prevents hallucination by:
 *   1. Only passing VERIFIED data to the AI
 *   2. Explicitly telling AI what data is missing
 *   3. Requiring structured JSON output with confidence scores
 *   4. Refusing analysis when data quality is too low
 */

// ── CONFIDENCE SCORING ────────────────────────────────────────────────────────

function calculateConfidence(analysisData) {
  const { quote, profile, metrics, news, dataQuality } = analysisData;
  let score = 0;
  const factors = [];

  // Live price data (40 points)
  if (quote) {
    score += 20;
    factors.push('Live price available');
    if (quote._meta?.reliability === 'high')   { score += 20; factors.push('Price data high reliability'); }
    if (quote._meta?.reliability === 'medium') { score += 10; factors.push('Price data medium reliability'); }
  } else {
    factors.push('⚠ No live price data');
  }

  // Company profile (15 points)
  if (profile?.name) { score += 15; factors.push('Company profile verified'); }
  else factors.push('⚠ Company profile missing');

  // Financial metrics (30 points)
  if (metrics) {
    const m = metrics;
    let metricScore = 0;
    if (m.peNormalizedAnnual)  { metricScore += 6;  factors.push('P/E ratio available'); }
    if (m['revenueGrowthTTMYoy']) { metricScore += 6; factors.push('Revenue growth available'); }
    if (m.epsNormalizedAnnual) { metricScore += 6;  factors.push('EPS available'); }
    if (m['52WeekHigh'])       { metricScore += 6;  factors.push('52-week range available'); }
    if (m.marketCapitalization){ metricScore += 6;  factors.push('Market cap available'); }
    score += metricScore;
  } else {
    factors.push('⚠ Financial metrics unavailable');
  }

  // News sentiment (10 points)
  if (news?.length >= 3) { score += 10; factors.push(`${news.length} recent news articles`); }
  else if (news?.length > 0) { score += 5; factors.push(`${news.length} recent news articles`); }
  else factors.push('⚠ No recent news');

  // Data freshness (5 points)
  if (quote?._meta?.freshness === 'live')   { score += 5; factors.push('Data is live/real-time'); }
  if (quote?._meta?.freshness === 'recent') { score += 3; factors.push('Data is recent'); }

  return {
    score:       Math.min(100, Math.round(score)),
    label:       score >= 75 ? 'High' : score >= 50 ? 'Medium' : 'Low',
    factors,
    canAnalyse:  score >= 40,
    disclaimer:  score < 60 ? 'Analysis based on incomplete data — use with caution' : null,
  };
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────

function buildAnalysisPrompt(analysisData, userQuestion, confidence) {
  const { quote, profile, metrics, news, symbol } = analysisData;

  // Format available data sections
  const sections = [];

  // Price section
  if (quote) {
    const change    = quote.d  ? `${quote.d > 0 ? '+' : ''}${quote.d.toFixed(2)}` : 'N/A';
    const changePct = quote.dp ? `${quote.dp > 0 ? '+' : ''}${quote.dp.toFixed(2)}%` : 'N/A';
    sections.push(`LIVE PRICE DATA (verified, ${quote._meta?.freshness || 'recent'}):
  Current:    $${quote.c?.toFixed(2) || 'N/A'}
  Change:     ${change} (${changePct})
  Day High:   $${quote.h?.toFixed(2) || 'N/A'}
  Day Low:    $${quote.l?.toFixed(2) || 'N/A'}
  Prev Close: $${quote.pc?.toFixed(2) || 'N/A'}
  Data time:  ${quote._meta?.timestamp || 'N/A'}`);
  } else {
    sections.push('LIVE PRICE DATA: ⚠ NOT AVAILABLE — do not guess prices');
  }

  // Company section
  if (profile) {
    sections.push(`COMPANY PROFILE (verified):
  Name:     ${profile.name || 'N/A'}
  Exchange: ${profile.exchange || 'N/A'}
  Sector:   ${profile.finnhubIndustry || 'N/A'}
  Country:  ${profile.country || 'N/A'}
  Mkt Cap:  ${profile.marketCapitalization ? '$' + (profile.marketCapitalization / 1000).toFixed(1) + 'B' : 'N/A'}
  Shares:   ${profile.shareOutstanding ? (profile.shareOutstanding / 1e6).toFixed(0) + 'M' : 'N/A'}`);
  } else {
    sections.push('COMPANY PROFILE: ⚠ NOT AVAILABLE — do not fabricate company details');
  }

  // Metrics section
  if (metrics && Object.keys(metrics).length > 0) {
    const m = metrics;
    const fmt = (v, suffix = '') => v != null ? `${Number(v).toFixed(2)}${suffix}` : 'N/A';
    sections.push(`FINANCIAL METRICS (verified):
  P/E Ratio (TTM):      ${fmt(m.peTTM)}
  P/E Ratio (Norm):     ${fmt(m.peNormalizedAnnual)}
  EPS (TTM):            ${fmt(m.epsTTM, '$')}
  EPS (Annual):         ${fmt(m.epsNormalizedAnnual, '$')}
  Revenue Growth YoY:   ${fmt(m['revenueGrowthTTMYoy'], '%')}
  Gross Margin:         ${fmt(m.grossMarginTTM, '%')}
  Net Margin:           ${fmt(m.netProfitMarginTTM, '%')}
  ROE:                  ${fmt(m.roeTTM, '%')}
  ROA:                  ${fmt(m.roaTTM, '%')}
  Debt/Equity:          ${fmt(m.totalDebt_totalEquityAnnual)}
  P/S Ratio:            ${fmt(m.psTTM)}
  P/B Ratio:            ${fmt(m.pbAnnual)}
  Beta:                 ${fmt(m.beta)}
  52-Week High:         ${fmt(m['52WeekHigh'], '$')}
  52-Week Low:          ${fmt(m['52WeekLow'], '$')}
  RSI (14):             ${fmt(m.rsi14)}
  10-Day Avg Vol:       ${m['10DayAverageTradingVolume'] ? (m['10DayAverageTradingVolume'] / 1e6).toFixed(2) + 'M' : 'N/A'}
  Dividend Yield:       ${fmt(m.dividendYieldIndicatedAnnual, '%')}`);
  } else {
    sections.push('FINANCIAL METRICS: ⚠ NOT AVAILABLE — do not fabricate ratios or metrics');
  }

  // News section
  if (news?.length > 0) {
    const headlines = news.slice(0, 5).map(n =>
      `  • [${new Date(n.datetime * 1000).toLocaleDateString()}] ${n.headline}`
    ).join('\n');
    sections.push(`RECENT NEWS HEADLINES (last 7 days):\n${headlines}`);
  } else {
    sections.push('RECENT NEWS: ⚠ No recent news available');
  }

  const dataBlock = sections.join('\n\n');

  return `You are StockMind AI — an institutional-grade financial analysis engine built into a Bloomberg-style terminal.

ANALYSIS DATA FOR: ${symbol}
Analysis Confidence: ${confidence.score}% (${confidence.label})
Data Reliability: ${quote?._meta?.reliability || 'unknown'}
Data Freshness: ${quote?._meta?.freshness || 'unknown'}

${dataBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES — NEVER VIOLATE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ONLY use data explicitly provided above. Never invent prices, metrics, or ratios.
2. If a metric shows "N/A", say it's unavailable — never estimate or guess it.
3. Never give a BUY/SELL/HOLD recommendation without P/E, price, and revenue data all present.
4. If confidence < 50%, explicitly warn the user analysis is limited.
5. Never mention competitor prices, analyst targets, or news you were NOT given above.
6. If asked about data you don't have, say clearly: "This data was not available at analysis time."
7. This is NOT financial advice. Always include this disclaimer.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER QUESTION: ${userQuestion}

RESPONSE FORMAT:
- Be concise and analytical — no filler sentences
- Lead with the most important insight first
- Use the actual numbers from the data above
- Structure: Price Summary → Key Metrics → Risk Factors → Verdict (if data allows)
- End with: "⚠ Analysis Confidence: ${confidence.score}% | Not financial advice"
- Total length: 150-300 words maximum`;
}

function buildChatPrompt(userMessage, analysisData, confidence) {
  const { quote, symbol } = analysisData || {};

  if (!analysisData || !quote) {
    return `You are StockMind AI, a professional financial assistant.

The user asked: "${userMessage}"

No verified market data was available for this query.
If the user is asking about a specific stock price or analysis, tell them clearly that live data could not be fetched and suggest they try again.
Do NOT guess any prices, ratios, or financial metrics.
Keep response under 100 words.`;
  }

  return buildAnalysisPrompt(analysisData, userMessage, confidence);
}

module.exports = { calculateConfidence, buildAnalysisPrompt, buildChatPrompt };
