'use strict';
/**
 * ConversationContext — single source of truth for multi-turn memory.
 * Works as a browser global (window.ConversationContext) AND a Node module
 * (require) so it can be unit-tested headlessly.
 *
 * Resolves follow-up references ("its risks", "which one?", "replace it with
 * something safer") to a concrete subject BEFORE the router runs, so the AI can
 * never drift to a different company.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.ConversationContext = mod;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  const RISK_WORDS = {
    conservative: /\b(conservative|risk[-\s]?averse|low[-\s]?risk|safe|cautious|capital preservation)\b/i,
    aggressive:   /\b(aggressive|high[-\s]?risk|risk[-\s]?tolerant|high growth)\b/i,
    moderate:     /\b(moderate|balanced|medium[-\s]?risk|moderately aggressive)\b/i,
  };

  const ConversationContext = {
    lastPrimarySymbol:   null,   // single stock most recently analysed
    lastSecondarySymbol: null,   // second side of a comparison
    lastComparison:      null,   // [sym, sym, ...]
    lastPortfolio:       null,   // portfolio object from PortfolioEngine
    lastWatchlist:       null,   // watchlist object from WatchlistEngine
    lastScanner:         null,   // scanner results { region, results:[...] }
    lastETF:             null,   // last ETF symbol discussed
    lastDecision:        null,   // most recent portfolio decision (e.g. a replace)
    lastObjective:       null,   // portfolio objective/themes (e.g. ['ai','technology'])
    decisionHistory:     [],     // rolling log of decisions + rationale
    activeTopic:         null,   // 'stock'|'comparison'|'portfolio'|'watchlist'|'scanner'|'etf'
    lastUserProfile:     { riskTolerance: null, age: null, horizon: null, income: null, country: null },
    turns:               [],
    updatedAt:           0,

    // The active topic owns follow-up resolution. Switching topics clears the
    // others so a stale portfolio/comparison can never hijack a new subject
    // ("wrong context" / random-ticker bug).
    _switchTopic(topic) {
      this.activeTopic = topic;
      if (topic !== 'comparison') { this.lastComparison = null; this.lastSecondarySymbol = null; }
      if (topic !== 'portfolio')  this.lastPortfolio = null;
      if (topic !== 'watchlist')  this.lastWatchlist = null;
      if (topic !== 'scanner')    this.lastScanner = null;
      if (topic !== 'portfolio')  { this.lastDecision = null; this.lastObjective = null; }
      if (topic !== 'stock' && topic !== 'comparison' && topic !== 'etf') this.lastPrimarySymbol = null;
      this.updatedAt = Date.now();
    },

    // Record a portfolio decision + rationale so future "why?" questions can be
    // answered from memory instead of falling back to an asset lookup.
    addDecision(d) {
      this.lastDecision = d || null;
      if (d) { this.decisionHistory.push(d); if (this.decisionHistory.length > 10) this.decisionHistory.shift(); }
      this.updatedAt = Date.now();
    },
    setObjective(o) { this.lastObjective = o || null; },

    // ── setters ───────────────────────────────────────────────────────────
    setStock(symbol, entity) {
      this._switchTopic('stock');
      this.lastPrimarySymbol = symbol || null;
      this.lastSecondarySymbol = null;
      this.lastEntity = entity || symbol || null;
    },
    setComparison(symbols) {
      const arr = (symbols || []).filter(Boolean);
      if (arr.length < 2) return;
      this._switchTopic('comparison');
      this.lastComparison = arr.slice(0, 3);
      this.lastPrimarySymbol = arr[0];
      this.lastSecondarySymbol = arr[1] || null;
    },
    setPortfolio(p) { this._switchTopic('portfolio'); this.lastPortfolio = p || null; },
    setWatchlist(w) { this._switchTopic('watchlist'); this.lastWatchlist = w || null; },
    setScanner(s)   { this._switchTopic('scanner');   this.lastScanner = s || null; },
    setETF(sym)     { this._switchTopic('etf'); this.lastETF = sym || null; this.lastPrimarySymbol = sym || null; },
    setProfile(partial) {
      if (!partial) return;
      for (const k of ['riskTolerance', 'age', 'horizon', 'income', 'country'])
        if (partial[k] != null) this.lastUserProfile[k] = partial[k];
      this.updatedAt = Date.now();
    },
    addTurn(role, content) {
      this.turns.push({ role, content: String(content || '').slice(0, 400) });
      if (this.turns.length > 8) this.turns.shift();
    },

    // ── profile extraction from free text ───────────────────────────────────
    extractProfile(msg) {
      const out = {};
      const ageM = msg.match(/\b(\d{2})\s*(?:years?\s*old|y\/?o|yo)\b/i) || msg.match(/\bi am\s+(\d{2})\b/i);
      if (ageM) { const a = parseInt(ageM[1], 10); if (a >= 16 && a <= 100) out.age = a; }
      for (const [tol, re] of Object.entries(RISK_WORDS)) if (re.test(msg)) { out.riskTolerance = tol; break; }
      if (/\b(retire early|early retirement|10\+? years|long[-\s]?term|decade)\b/i.test(msg)) out.horizon = 'long';
      if (/\b(short[-\s]?term|swing|next year|1 year)\b/i.test(msg)) out.horizon = 'short';
      if (/\b(income|dividend|yield|passive income)\b/i.test(msg)) out.income = true;
      if (/\b(india|indian|nse|bse|nifty|sensex|₹|rupees?)\b/i.test(msg)) out.country = 'IN';
      else if (/\b(us|usa|american|nasdaq|s&p)\b/i.test(msg)) out.country = 'US';
      return out;
    },

    // ── reference resolution ────────────────────────────────────────────────
    // Decide what a follow-up refers to, using stored context.
    // Returns { kind, symbols?, target? }.
    resolveReference(msg, opts = {}) {
      const m = (msg || '').trim();
      const reservedCaps = opts.reservedCaps || (() => false);
      const capsTokens = (m.match(/\b[A-Z]{2,5}\b/g) || []).filter(t => !reservedCaps(t));
      const hasNewTicker = capsTokens.length > 0;

      // ── RULE 1/2/3/5: EXPLICIT REQUESTS OUTRANK MEMORY ──────────────────────
      // A new primary command (build/analyse/compare/scan/invest) must NEVER be
      // answered from stored portfolio/stock memory. Memory may only resolve a
      // *pure follow-up*. The one exception: a command that explicitly refers to
      // the active book ("compare the two positions in THAT portfolio").
      const buildCmd = (/\b(build|create|construct|design|put together)\b/i.test(m) && /\b(portfolio|allocation)\b/i.test(m))
                       || (/\binvest\b/i.test(m) && /\bstocks?\b/i.test(m));
      const otherCmd = /\b(analy[sz]e|compare|versus|\bvs\b|scan|screen|watchlist)\b/i.test(m);
      const refsActivePortfolio = /\b(that|this|the|my)\s+(portfolio|holdings|positions|allocation)\b/i.test(m);
      if (buildCmd) return { kind: 'none' };                       // building is always a fresh action
      if (otherCmd && !refsActivePortfolio) return { kind: 'none' }; // analyse/compare outrank stale memory

      // Follow-ups resolve ONLY against the active topic — a stale portfolio or
      // comparison can never hijack a different subject.

      // ── PRIORITY 1: REASONING follow-up ("why did you replace NVIDIA with
      // SCHD?", "explain", "what changed?", "instead of another AI stock?").
      // Highest priority so it WINS over asset/ETF lookup even when the message
      // names tickers that belong to the active decision/context.
      // Reasoning asks ABOUT a decision ("why/explain/instead of"). It must NOT
      // fire on an IMPERATIVE command ("Replace it with a safer alternative"),
      // but MUST fire on a question that merely describes a past action
      // ("Why did you replace NVIDIA with SCHD?"). So only a leading action verb
      // vetoes reasoning — not the word appearing mid-sentence.
      const startsWithAction = /^\s*(replace|swap|rebalance|build|create|construct|make|add|buy|sell|allocate|diversify|set|change)\b/i.test(m);
      const reasoning = !startsWithAction &&
        /\b(why|explain|reasoning|rationale|justify|what changed|pros and cons|trade[-\s]?offs?|instead of|why (that|this|did)|how come|on what basis)\b/i.test(m);
      if (reasoning) {
        if (this.activeTopic === 'portfolio' && (this.lastDecision || this.lastPortfolio))
          return { kind: 'portfolio-reasoning', decision: this.lastDecision, portfolio: this.lastPortfolio, objective: this.lastObjective };
        if (this.activeTopic === 'comparison' && this.lastComparison)
          return { kind: 'comparison-followup', symbols: [...this.lastComparison] };
        if (this.activeTopic === 'stock' && this.lastPrimarySymbol)
          return { kind: 'single-followup', symbol: this.lastPrimarySymbol };
      }

      // comparison follow-up: "which has a stronger moat / which is safer / them"
      if (this.activeTopic === 'comparison' && this.lastComparison && !hasNewTicker &&
          /\b(which|stronger|weaker|safer|riskier|better|worse|moat|cheaper|both|them|the (former|latter)|first one|second one)\b/i.test(m))
        return { kind: 'comparison-followup', symbols: [...this.lastComparison] };

      // portfolio follow-up: riskiest / replace / rebalance / capital / compare-within
      if (this.activeTopic === 'portfolio' && this.lastPortfolio && !hasNewTicker &&
          /\b(which (holding|position|stock|one)|riskiest|most risk|highest risk|replace (it|the)|safer alternative|how much safer|risk (has |)changed|rebalance|the portfolio|annual income|dividend income|the (top|two)|top (two|positions)|additional capital|add (capital|more)|allocate more|increase|more capital)\b/i.test(m))
        return { kind: 'portfolio-followup', portfolio: this.lastPortfolio };

      // watchlist follow-up
      if (this.activeTopic === 'watchlist' && this.lastWatchlist && !hasNewTicker &&
          /\b(which (one|stock)|highest upside|strongest balance|lowest valuation|buy today|from (the|that) (list|watchlist))\b/i.test(m))
        return { kind: 'watchlist-followup', watchlist: this.lastWatchlist };

      // scanner follow-up: "which has the best setup / highest upside / safest"
      if (this.activeTopic === 'scanner' && this.lastScanner && !hasNewTicker &&
          /\b(which (one|stock|has)|best setup|strongest|highest upside|safest|riskiest|top (pick|setup))\b/i.test(m))
        return { kind: 'scanner-followup', scanner: this.lastScanner };

      // single-stock follow-up: "its risks", generic question with no new ticker
      if (this.activeTopic === 'stock' && this.lastPrimarySymbol && !hasNewTicker && this.isFollowUp(m))
        return { kind: 'single-followup', symbol: this.lastPrimarySymbol };

      return { kind: 'none' };
    },

    isFollowUp(msg) {
      const m = (msg || '').trim();
      const patterns = [
        /\b(it|its|this|that|they|their|the company|the stock|the same|more about|tell me more|what about|how about)\b/i,
        /^(what|how|why|is|does|did|has|have|can|will|would|should|when|which|are|do)\b/i,
        /^(and|also|but|so|then|what if|what's|what is|what are)\b/i,
      ];
      return patterns.some(p => p.test(m));
    },

    clear() {
      this.lastPrimarySymbol = this.lastSecondarySymbol = this.lastComparison = null;
      this.lastPortfolio = this.lastWatchlist = this.lastScanner = this.lastETF = this.lastEntity = null;
      this.lastDecision = this.lastObjective = null; this.decisionHistory = [];
      this.activeTopic = null;
      this.lastUserProfile = { riskTolerance: null, age: null, horizon: null, income: null, country: null };
      this.turns = []; this.updatedAt = 0;
    },
  };

  return ConversationContext;
});
