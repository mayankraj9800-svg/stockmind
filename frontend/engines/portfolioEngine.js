'use strict';
/**
 * PortfolioEngine — deterministic, rule-based portfolio constructor.
 * Browser global (window.PortfolioEngine) + Node module.
 *
 * IMPORTANT: allocations are a transparent RULE-BASED MODEL built from curated
 * baskets + documented adjustments. Yields/risk tiers are reference estimates,
 * clearly labelled — never presented as live data. Allocations always sum to
 * exactly 100%.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.PortfolioEngine = mod;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  // riskTier: 1 (cash/bond) … 5 (speculative). yield: approx annual %.
  const H = (symbol, name, sector, weight, yld, riskTier) => ({ symbol, name, sector, weight, yield: yld, riskTier });

  // ── US baskets (weights pre-normalised to 100) ──────────────────────────────
  const US_BASKETS = {
    conservative: [
      H('BND','Vanguard Total Bond','Fixed Income',30,3.6,1),
      H('SCHD','Schwab US Dividend','Dividend Equity',25,3.5,2),
      H('JNJ','Johnson & Johnson','Healthcare',15,3.0,2),
      H('PG','Procter & Gamble','Consumer Staples',15,2.4,2),
      H('KO','Coca-Cola','Consumer Staples',15,3.0,2),
    ],
    retirement: [
      H('BND','Vanguard Total Bond','Fixed Income',35,3.6,1),
      H('SCHD','Schwab US Dividend','Dividend Equity',25,3.5,2),
      H('VYM','Vanguard High Dividend','Dividend Equity',15,2.9,2),
      H('JNJ','Johnson & Johnson','Healthcare',10,3.0,2),
      H('PG','Procter & Gamble','Consumer Staples',8,2.4,2),
      H('O','Realty Income','Real Estate',7,5.4,3),
    ],
    dividend: [
      H('SCHD','Schwab US Dividend','Dividend Equity',25,3.5,2),
      H('VYM','Vanguard High Dividend','Dividend Equity',20,2.9,2),
      H('O','Realty Income','Real Estate',15,5.4,3),
      H('JNJ','Johnson & Johnson','Healthcare',12,3.0,2),
      H('KO','Coca-Cola','Consumer Staples',10,3.0,2),
      H('XOM','Exxon Mobil','Energy',10,3.3,3),
      H('VZ','Verizon','Telecom',8,6.5,3),
    ],
    balanced: [
      H('VOO','Vanguard S&P 500','US Equity',35,1.3,3),
      H('SCHD','Schwab US Dividend','Dividend Equity',20,3.5,2),
      H('BND','Vanguard Total Bond','Fixed Income',20,3.6,1),
      H('AAPL','Apple','Technology',13,0.5,3),
      H('MSFT','Microsoft','Technology',12,0.7,3),
    ],
    growth: [
      H('QQQ','Invesco QQQ','US Tech Index',25,0.6,3),
      H('MSFT','Microsoft','Technology',20,0.7,3),
      H('AAPL','Apple','Technology',18,0.5,3),
      H('GOOGL','Alphabet','Technology',15,0.0,3),
      H('AMZN','Amazon','Consumer Discretionary',12,0.0,4),
      H('V','Visa','Financials',10,0.8,3),
    ],
    aggressive: [
      H('NVDA','NVIDIA','Semiconductors',25,0.03,5),
      H('MSFT','Microsoft','Technology',18,0.7,3),
      H('AMZN','Amazon','Consumer Discretionary',15,0.0,4),
      H('META','Meta Platforms','Technology',14,0.4,4),
      H('TSLA','Tesla','Consumer Discretionary',14,0.0,5),
      H('AMD','Advanced Micro Devices','Semiconductors',14,0.0,5),
    ],
    ai: [
      H('NVDA','NVIDIA','Semiconductors',24,0.03,5),
      H('MSFT','Microsoft','AI / Cloud',20,0.7,3),
      H('GOOGL','Alphabet','AI / Cloud',16,0.0,3),
      H('AVGO','Broadcom','Semiconductors',14,1.2,4),
      H('AMD','Advanced Micro Devices','Semiconductors',14,0.0,5),
      H('PLTR','Palantir','AI Software',12,0.0,5),
    ],
    technology: [
      H('AAPL','Apple','Technology',20,0.5,3),
      H('MSFT','Microsoft','Technology',20,0.7,3),
      H('NVDA','NVIDIA','Semiconductors',16,0.03,5),
      H('GOOGL','Alphabet','Technology',16,0.0,3),
      H('AVGO','Broadcom','Semiconductors',14,1.2,4),
      H('CRM','Salesforce','Software',14,0.0,4),
    ],
    global: [
      H('VOO','Vanguard S&P 500','US Equity',30,1.3,3),
      H('VXUS','Vanguard Intl ex-US','Intl Equity',20,2.9,3),
      H('VWO','Vanguard Emerging Mkts','Emerging Mkts',12,2.7,4),
      H('TSM','Taiwan Semiconductor','Semiconductors',12,1.3,4),
      H('MSFT','Microsoft','Technology',14,0.7,3),
      H('NSRGY','Nestle','Consumer Staples',12,2.8,2),
    ],
  };

  // ── Indian baskets (.NS) ────────────────────────────────────────────────────
  const IN_BASKETS = {
    conservative: [
      H('HDFCBANK.NS','HDFC Bank','Banking',22,1.0,2),
      H('TCS.NS','Tata Consultancy','IT Services',20,1.4,2),
      H('HINDUNILVR.NS','Hindustan Unilever','FMCG',18,1.5,2),
      H('ITC.NS','ITC','FMCG',20,2.7,2),
      H('NESTLEIND.NS','Nestle India','FMCG',20,1.1,2),
    ],
    dividend: [
      H('ITC.NS','ITC','FMCG',22,2.7,2),
      H('COALINDIA.NS','Coal India','Energy',18,6.5,3),
      H('POWERGRID.NS','Power Grid','Utilities',18,4.5,2),
      H('NTPC.NS','NTPC','Utilities',16,3.5,2),
      H('ONGC.NS','ONGC','Energy',14,4.0,3),
      H('HDFCBANK.NS','HDFC Bank','Banking',12,1.0,2),
    ],
    growth: [
      H('RELIANCE.NS','Reliance Industries','Conglomerate',22,0.4,3),
      H('TCS.NS','Tata Consultancy','IT Services',18,1.4,2),
      H('INFY.NS','Infosys','IT Services',16,2.2,3),
      H('HDFCBANK.NS','HDFC Bank','Banking',16,1.0,3),
      H('BHARTIARTL.NS','Bharti Airtel','Telecom',14,0.5,3),
      H('BAJFINANCE.NS','Bajaj Finance','Financials',14,0.4,4),
    ],
    aggressive: [
      H('ADANIENT.NS','Adani Enterprises','Conglomerate',20,0.0,5),
      H('BAJFINANCE.NS','Bajaj Finance','Financials',18,0.4,4),
      H('TATAMOTORS.NS','Tata Motors','Auto',16,0.0,4),
      H('ZOMATO.NS','Zomato','Internet',16,0.0,5),
      H('RELIANCE.NS','Reliance Industries','Conglomerate',16,0.4,3),
      H('TRENT.NS','Trent','Retail',14,0.2,5),
    ],
    balanced: [
      H('RELIANCE.NS','Reliance Industries','Conglomerate',20,0.4,3),
      H('HDFCBANK.NS','HDFC Bank','Banking',20,1.0,3),
      H('TCS.NS','Tata Consultancy','IT Services',18,1.4,2),
      H('ITC.NS','ITC','FMCG',16,2.7,2),
      H('INFY.NS','Infosys','IT Services',14,2.2,3),
      H('LT.NS','Larsen & Toubro','Infrastructure',12,1.1,3),
    ],
  };
  IN_BASKETS.retirement = IN_BASKETS.dividend;
  IN_BASKETS.technology = IN_BASKETS.growth;
  IN_BASKETS.ai = IN_BASKETS.growth;
  IN_BASKETS.global = US_BASKETS.global;

  const DEFENSIVE_US = H('BND','Vanguard Total Bond','Fixed Income',0,3.6,1);
  const DEFENSIVE_IN = H('NIFTYBEES.NS','Nippon Nifty BeES','Index ETF',0,1.3,2);

  // Safer swap targets by riskTier (for "replace the riskiest holding").
  const SAFER_US = H('SCHD','Schwab US Dividend','Dividend Equity',0,3.5,2);
  const SAFER_IN = H('HDFCBANK.NS','HDFC Bank','Banking',0,1.0,2);

  function pickType(input) {
    if (input.type && (US_BASKETS[input.type] || IN_BASKETS[input.type])) return input.type;
    const themes = (input.themes || []).map(t => String(t).toLowerCase());
    if (themes.some(t => /\bai\b|artificial/.test(t))) return 'ai';
    if (themes.some(t => /tech|cloud|semic/.test(t))) return 'technology';
    if (themes.some(t => /global|international/.test(t))) return 'global';
    if (input.income || themes.some(t => /dividend|income/.test(t))) return 'dividend';
    const age = input.age || 0;
    const risk = input.riskTolerance;
    if (age >= 60 || (risk === 'conservative' && age >= 50)) return 'retirement';
    if (risk === 'conservative') return 'conservative';
    if (risk === 'aggressive') return 'aggressive';
    if (risk === 'moderate') return 'balanced';
    return 'balanced';
  }

  // Defensive tilt grows with age and conservatism (0 … 0.45).
  function defensiveBoost(input) {
    let b = 0;
    const age = input.age || 0;
    if (age >= 70) b += 0.30; else if (age >= 60) b += 0.22; else if (age >= 50) b += 0.12; else if (age >= 40) b += 0.05;
    if (input.riskTolerance === 'conservative') b += 0.15;
    if (input.riskTolerance === 'aggressive') b -= 0.10;
    return Math.max(0, Math.min(0.45, b));
  }

  // Normalise weights to integers summing to EXACTLY 100.
  function normalise100(holdings) {
    const total = holdings.reduce((s, h) => s + h.weight, 0) || 1;
    let scaled = holdings.map(h => ({ ...h, weight: (h.weight / total) * 100 }));
    let floored = scaled.map(h => ({ ...h, weight: Math.floor(h.weight), _frac: h.weight - Math.floor(h.weight) }));
    let used = floored.reduce((s, h) => s + h.weight, 0);
    let remainder = 100 - used;
    floored.sort((a, b) => b._frac - a._frac);
    for (let i = 0; i < remainder; i++) floored[i % floored.length].weight += 1;
    floored.forEach(h => delete h._frac);
    // restore original order by symbol stability
    return floored;
  }

  function build(input = {}) {
    const country = input.country === 'IN' ? 'IN' : 'US';
    const BASKETS = country === 'IN' ? IN_BASKETS : US_BASKETS;
    const type = pickType(input);
    let basket = (BASKETS[type] || BASKETS.balanced).map(h => ({ ...h }));

    // Apply defensive tilt: scale equities down, add/grow a defensive sleeve.
    const boost = defensiveBoost(input);
    if (boost > 0 && type !== 'conservative' && type !== 'retirement') {
      basket.forEach(h => { h.weight = h.weight * (1 - boost); });
      const def = country === 'IN' ? { ...DEFENSIVE_IN } : { ...DEFENSIVE_US };
      const existing = basket.find(h => h.symbol === def.symbol);
      if (existing) existing.weight += boost * 100; else { def.weight = boost * 100; basket.push(def); }
    }

    const holdings = normalise100(basket);
    const amount = Number(input.amount) || 0;
    const currency = country === 'IN' ? '₹' : '$';
    holdings.forEach(h => { h.amount = Math.round((h.weight / 100) * amount); });

    // metrics
    const riskScoreRaw = holdings.reduce((s, h) => s + h.weight * h.riskTier, 0) / 100; // 1..5
    const riskScore = Math.round(riskScoreRaw * 20); // 0..100
    const riskLabel = riskScore >= 75 ? 'High' : riskScore >= 50 ? 'Moderate' : riskScore >= 30 ? 'Conservative' : 'Low';
    const expectedYield = +(holdings.reduce((s, h) => s + h.weight * h.yield, 0) / 100).toFixed(2);
    const sectorExposure = {};
    holdings.forEach(h => { sectorExposure[h.sector] = (sectorExposure[h.sector] || 0) + h.weight; });
    const annualIncome = Math.round(amount * expectedYield / 100);

    return {
      type, country, currency, amount,
      holdings: holdings.map(h => ({ symbol: h.symbol, name: h.name, sector: h.sector, weight: h.weight, amount: h.amount, yield: h.yield, riskTier: h.riskTier })),
      totalWeight: holdings.reduce((s, h) => s + h.weight, 0),
      riskScore, riskLabel,
      expectedYield, annualIncome,
      sectorExposure,
      recession: recessionCommentary(type, riskLabel),
      disclaimer: 'Rule-based model allocation. Yields are reference estimates, not live data. Not financial advice.',
    };
  }

  function recessionCommentary(type, riskLabel) {
    if (type === 'retirement' || type === 'conservative' || type === 'dividend')
      return 'Defensive tilt (bonds, staples, dividend payers) should cushion drawdowns; income stream tends to persist through downturns.';
    if (type === 'aggressive' || type === 'ai')
      return 'High growth/semiconductor weighting is the most recession-sensitive sleeve — expect larger drawdowns if rates rise or capex slows.';
    if (type === 'global')
      return 'Geographic diversification softens single-market shocks, but emerging-market sleeve adds volatility in risk-off periods.';
    return 'Broad-market core with some defensive ballast; moderate drawdown expected in a recession, with faster recovery than a pure-growth mix.';
  }

  // riskiest holding = highest riskTier, ties broken by largest weight.
  function riskiestHolding(portfolio) {
    if (!portfolio || !portfolio.holdings || !portfolio.holdings.length) return null;
    return [...portfolio.holdings].sort((a, b) => (b.riskTier - a.riskTier) || (b.weight - a.weight))[0];
  }

  // Replace the riskiest holding with a safer alternative, re-normalise, and
  // report how much the portfolio risk dropped.
  function replaceRiskiest(portfolio) {
    if (!portfolio) return null;
    const worst = riskiestHolding(portfolio);
    if (!worst) return portfolio;
    const safer = portfolio.country === 'IN' ? { ...SAFER_IN } : { ...SAFER_US };
    // if safer symbol already present, fold weight into it; else swap in place
    const newHoldings = [];
    let folded = false;
    for (const h of portfolio.holdings) {
      if (h.symbol === worst.symbol) {
        const existing = portfolio.holdings.find(x => x.symbol === safer.symbol && x.symbol !== worst.symbol);
        if (existing) { folded = true; continue; } // drop; weight added below
        newHoldings.push({ ...safer, weight: worst.weight });
      } else {
        newHoldings.push({ ...h });
      }
    }
    if (folded) {
      const tgt = newHoldings.find(x => x.symbol === safer.symbol);
      if (tgt) tgt.weight += worst.weight;
    }
    const rebuilt = finaliseHoldings(newHoldings, portfolio.amount, portfolio.country);
    return {
      ...rebuilt,
      type: portfolio.type, country: portfolio.country, currency: portfolio.currency, amount: portfolio.amount,
      removed: worst.symbol, added: safer.symbol,
      riskReduction: portfolio.riskScore - rebuilt.riskScore,
      disclaimer: portfolio.disclaimer,
    };
  }

  function finaliseHoldings(holdings, amount, country) {
    const norm = normalise100(holdings);
    norm.forEach(h => { h.amount = Math.round((h.weight / 100) * (amount || 0)); });
    const riskScore = Math.round((norm.reduce((s, h) => s + h.weight * h.riskTier, 0) / 100) * 20);
    const expectedYield = +(norm.reduce((s, h) => s + h.weight * h.yield, 0) / 100).toFixed(2);
    const sectorExposure = {};
    norm.forEach(h => { sectorExposure[h.sector] = (sectorExposure[h.sector] || 0) + h.weight; });
    return {
      holdings: norm.map(h => ({ symbol: h.symbol, name: h.name, sector: h.sector, weight: h.weight, amount: h.amount, yield: h.yield, riskTier: h.riskTier })),
      totalWeight: norm.reduce((s, h) => s + h.weight, 0),
      riskScore,
      riskLabel: riskScore >= 75 ? 'High' : riskScore >= 50 ? 'Moderate' : riskScore >= 30 ? 'Conservative' : 'Low',
      expectedYield,
      annualIncome: Math.round((amount || 0) * expectedYield / 100),
      sectorExposure,
    };
  }

  return { build, riskiestHolding, replaceRiskiest, pickType, normalise100,
           SUPPORTED_TYPES: ['retirement','dividend','growth','aggressive','ai','technology','balanced','conservative','global'] };
});
