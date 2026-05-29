'use strict';
/**
 * IndexRouter — ETF + market-index classification and routing.
 * Browser global (window.IndexRouter) + Node module.
 *
 * Ensures ETFs are NOT analysed as individual companies (no P/E, EPS, moat),
 * and that market indices are handled via their tracking proxy with index-level
 * commentary rather than company analysis.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.IndexRouter = mod;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  // ── ETF REGISTRY (reference data — clearly not live) ────────────────────────
  const ETF_REGISTRY = {
    SPY:  { name: 'SPDR S&P 500 ETF',            expenseRatio: 0.0945, yield: 1.3, tracks: 'S&P 500',        topSectors: ['Tech 31%','Financials 13%','Healthcare 11%'], risk: 'Moderate' },
    VOO:  { name: 'Vanguard S&P 500 ETF',        expenseRatio: 0.03,   yield: 1.3, tracks: 'S&P 500',        topSectors: ['Tech 31%','Financials 13%','Healthcare 11%'], risk: 'Moderate' },
    IVV:  { name: 'iShares Core S&P 500 ETF',    expenseRatio: 0.03,   yield: 1.3, tracks: 'S&P 500',        topSectors: ['Tech 31%','Financials 13%','Healthcare 11%'], risk: 'Moderate' },
    QQQ:  { name: 'Invesco QQQ Trust',           expenseRatio: 0.20,   yield: 0.6, tracks: 'Nasdaq-100',     topSectors: ['Tech 50%','Comm Svcs 16%','Consumer Disc 13%'], risk: 'Moderate-High' },
    VTI:  { name: 'Vanguard Total Stock Market', expenseRatio: 0.03,   yield: 1.3, tracks: 'US total market', topSectors: ['Tech 30%','Financials 13%','Healthcare 12%'], risk: 'Moderate' },
    DIA:  { name: 'SPDR Dow Jones ETF',          expenseRatio: 0.16,   yield: 1.7, tracks: 'Dow Jones 30',   topSectors: ['Financials 22%','Healthcare 18%','Tech 18%'], risk: 'Moderate' },
    IWM:  { name: 'iShares Russell 2000 ETF',    expenseRatio: 0.19,   yield: 1.2, tracks: 'Russell 2000 (small-cap)', topSectors: ['Financials 18%','Industrials 16%','Healthcare 15%'], risk: 'High' },
    SCHD: { name: 'Schwab US Dividend Equity',   expenseRatio: 0.06,   yield: 3.5, tracks: 'Dow Jones US Dividend 100', topSectors: ['Financials 18%','Energy 14%','Consumer Staples 14%'], risk: 'Low-Moderate' },
    VYM:  { name: 'Vanguard High Dividend Yield',expenseRatio: 0.06,   yield: 2.9, tracks: 'FTSE High Dividend Yield', topSectors: ['Financials 21%','Healthcare 14%','Consumer Staples 13%'], risk: 'Low-Moderate' },
    GLD:  { name: 'SPDR Gold Shares',            expenseRatio: 0.40,   yield: 0.0, tracks: 'Gold spot price', topSectors: ['Gold 100%'], risk: 'Moderate' },
  };

  // ── MARKET INDICES → tracking proxy / region ────────────────────────────────
  const INDEX_REGISTRY = {
    'S&P 500':       { aliases: ['s&p 500','s&p500','sp500','spx','s and p 500'], region: 'US', proxyETF: 'SPY',  desc: '500 large-cap US companies' },
    'Nasdaq-100':    { aliases: ['nasdaq 100','nasdaq100','nasdaq-100','ndx'], region: 'US', proxyETF: 'QQQ',  desc: '100 largest non-financial Nasdaq companies (tech-heavy)' },
    'Dow Jones':     { aliases: ['dow jones','dow','djia','dow 30'], region: 'US', proxyETF: 'DIA',  desc: '30 blue-chip US companies (price-weighted)' },
    'Russell 2000':  { aliases: ['russell 2000','russell2000','rut'], region: 'US', proxyETF: 'IWM',  desc: 'US small-cap benchmark' },
    'Nifty 50':      { aliases: ['nifty 50','nifty50','nifty'], region: 'IN', proxyETF: 'NIFTYBEES.NS', desc: '50 large-cap NSE companies' },
    'Sensex':        { aliases: ['sensex','bse sensex','bse30'], region: 'IN', proxyETF: null, desc: '30 large-cap BSE companies' },
    'Nifty Next 50': { aliases: ['nifty next 50','nifty next50','next 50','junior nifty'], region: 'IN', proxyETF: 'JUNIORBEES.NS', desc: 'NSE stocks ranked 51–100 (emerging large-caps)' },
    'Nifty Bank':    { aliases: ['nifty bank','bank nifty','banknifty'], region: 'IN', proxyETF: 'BANKBEES.NS', desc: '12 large NSE banking stocks' },
  };

  function isETF(symbol) {
    return !!ETF_REGISTRY[(symbol || '').toUpperCase()];
  }
  function getETF(symbol) {
    const k = (symbol || '').toUpperCase();
    return ETF_REGISTRY[k] ? { symbol: k, ...ETF_REGISTRY[k] } : null;
  }

  // Flattened (alias → index) list, LONGEST alias first so "nifty next 50"
  // beats "nifty" and "s&p 500" beats partial matches.
  const ALIAS_INDEX = [];
  for (const [name, def] of Object.entries(INDEX_REGISTRY))
    for (const a of def.aliases) ALIAS_INDEX.push({ alias: a, name, def });
  ALIAS_INDEX.sort((x, y) => y.alias.length - x.alias.length);

  function aliasHit(alias, m) {
    return new RegExp('(^|[^a-z0-9])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(m);
  }

  function matchIndex(text) {
    const m = (text || '').toLowerCase();
    for (const { alias, name, def } of ALIAS_INDEX) if (aliasHit(alias, m)) return { name, ...def };
    return null;
  }
  // All indices mentioned in the text (for index comparisons). Longest aliases
  // are consumed first so "nifty next 50" doesn't also count as "nifty 50".
  function matchAllIndices(text) {
    let m = ' ' + (text || '').toLowerCase() + ' ';
    const found = [];
    for (const { alias, name, def } of ALIAS_INDEX) {
      if (found.some(f => f.name === name)) continue;
      const re = new RegExp('(^|[^a-z0-9])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
      if (re.test(m)) { found.push({ name, ...def }); m = m.replace(new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' '); }
    }
    return found;
  }

  // Classify a free-text query: 'etf' | 'index' | 'index-compare' | 'stock'
  function classify(text) {
    const indices = matchAllIndices(text);
    if (indices.length >= 2 && /\b(compare|vs\.?|versus|or)\b/i.test(text)) return { kind: 'index-compare', indices };
    if (indices.length >= 1) return { kind: 'index', index: indices[0], indices };
    const caps = (text.match(/\b[A-Z]{2,5}\b/g) || []);
    const etf = caps.find(isETF);
    if (etf) return { kind: 'etf', etf: getETF(etf) };
    return { kind: 'stock' };
  }

  return { isETF, getETF, matchIndex, matchAllIndices, classify, ETF_REGISTRY, INDEX_REGISTRY,
           SUPPORTED_ETFS: Object.keys(ETF_REGISTRY), SUPPORTED_INDICES: Object.keys(INDEX_REGISTRY) };
});
