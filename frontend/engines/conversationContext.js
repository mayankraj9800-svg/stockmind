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
    lastETF:             null,   // last ETF symbol discussed
    lastUserProfile:     { riskTolerance: null, age: null, horizon: null, income: null, country: null },
    turns:               [],
    updatedAt:           0,

    // ── setters ───────────────────────────────────────────────────────────
    setStock(symbol, entity) {
      this.lastPrimarySymbol = symbol || null;
      this.lastSecondarySymbol = null;
      this.lastComparison = null;       // a single stock ends any comparison
      this.lastEntity = entity || symbol || null;
      this.updatedAt = Date.now();
    },
    setComparison(symbols) {
      const arr = (symbols || []).filter(Boolean);
      this.lastComparison = arr.length >= 2 ? arr.slice(0, 3) : null;
      this.lastPrimarySymbol = arr[0] || this.lastPrimarySymbol;
      this.lastSecondarySymbol = arr[1] || null;
      this.updatedAt = Date.now();
    },
    setPortfolio(p) { this.lastPortfolio = p || null; this.updatedAt = Date.now(); },
    setWatchlist(w) { this.lastWatchlist = w || null; this.updatedAt = Date.now(); },
    setETF(sym)     { this.lastETF = sym || null; this.lastPrimarySymbol = sym || this.lastPrimarySymbol; this.updatedAt = Date.now(); },
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

      // comparison follow-up: "which has a stronger moat / which is safer / them"
      if (this.lastComparison && !hasNewTicker &&
          /\b(which|stronger|weaker|safer|riskier|better|worse|moat|cheaper|both|them|the (former|latter)|first one|second one)\b/i.test(m))
        return { kind: 'comparison-followup', symbols: [...this.lastComparison] };

      // portfolio follow-up: "which holding is riskiest / replace it / rebalance"
      if (this.lastPortfolio &&
          /\b(which (holding|position|stock)|riskiest|replace (it|the)|how much safer|rebalance|the portfolio|annual income|dividend income)\b/i.test(m))
        return { kind: 'portfolio-followup', portfolio: this.lastPortfolio };

      // watchlist follow-up
      if (this.lastWatchlist &&
          /\b(which (one|stock)|highest upside|strongest balance|lowest valuation|buy today|from (the|that) (list|watchlist))\b/i.test(m) && !hasNewTicker)
        return { kind: 'watchlist-followup', watchlist: this.lastWatchlist };

      // single-stock follow-up: "its risks", generic question with no new ticker
      if (this.lastPrimarySymbol && !hasNewTicker && this.isFollowUp(m))
        return { kind: 'single-followup', symbol: this.lastPrimarySymbol };

      return { kind: 'none' };
    },

    isFollowUp(msg) {
      const m = (msg || '').trim();
      const patterns = [
        /\b(it|its|this|that|they|their|the company|the stock|the same|more about|tell me more|what about|how about)\b/i,
        /^(what|how|why|is|does|did|has|have|can|will|would|should|when)\b/i,
        /^(and|also|but|so|then|what if|what's|what is|what are)\b/i,
      ];
      return patterns.some(p => p.test(m));
    },

    clear() {
      this.lastPrimarySymbol = this.lastSecondarySymbol = this.lastComparison = null;
      this.lastPortfolio = this.lastWatchlist = this.lastETF = this.lastEntity = null;
      this.lastUserProfile = { riskTolerance: null, age: null, horizon: null, income: null, country: null };
      this.turns = []; this.updatedAt = 0;
    },
  };

  return ConversationContext;
});
