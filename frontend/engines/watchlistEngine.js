'use strict';
/**
 * WatchlistEngine — curated, theme-based watchlists.
 * Browser global (window.WatchlistEngine) + Node module.
 * Returns ticker / company / sector / reason, filterable by region.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.WatchlistEngine = mod;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  const E = (ticker, company, sector, region, reason) => ({ ticker, company, sector, region, reason });

  const THEMES = {
    ai: [
      E('NVDA','NVIDIA','Semiconductors','US','Dominant AI training/inference GPU supplier'),
      E('MSFT','Microsoft','AI / Cloud','US','Azure AI + OpenAI partnership, Copilot monetisation'),
      E('GOOGL','Alphabet','AI / Cloud','US','Gemini models + TPU stack + search distribution'),
      E('AVGO','Broadcom','Semiconductors','US','Custom AI accelerators + networking silicon'),
      E('AMD','Advanced Micro Devices','Semiconductors','US','MI-series GPUs as the #2 AI accelerator'),
      E('PLTR','Palantir','AI Software','US','Enterprise/government AI deployment platform'),
      E('TSM','Taiwan Semiconductor','Semiconductors','International','Fabricates nearly all leading-edge AI chips'),
      E('INFY.NS','Infosys','IT Services','India','AI-led IT services and enterprise integration'),
    ],
    cybersecurity: [
      E('CRWD','CrowdStrike','Cybersecurity','US','Cloud-native endpoint protection leader'),
      E('PANW','Palo Alto Networks','Cybersecurity','US','Broad platform across network/cloud/SOC'),
      E('ZS','Zscaler','Cybersecurity','US','Zero-trust secure access (SASE) leader'),
      E('FTNT','Fortinet','Cybersecurity','US','Firewall + integrated security fabric'),
      E('S','SentinelOne','Cybersecurity','US','Autonomous AI-driven endpoint security'),
      E('NET','Cloudflare','Cybersecurity / Edge','US','Edge security + zero-trust network services'),
    ],
    cloud: [
      E('MSFT','Microsoft','Cloud','US','Azure #2 hyperscaler, fastest large-cap cloud growth'),
      E('AMZN','Amazon','Cloud','US','AWS market-share leader, profit engine'),
      E('GOOGL','Alphabet','Cloud','US','Google Cloud now profitable, AI-differentiated'),
      E('SNOW','Snowflake','Cloud Data','US','Cloud data warehouse / consumption model'),
      E('DDOG','Datadog','Cloud Observability','US','Monitoring across cloud-native stacks'),
      E('NOW','ServiceNow','Cloud Software','US','Enterprise workflow automation platform'),
    ],
    semiconductors: [
      E('NVDA','NVIDIA','Semiconductors','US','AI GPU leader'),
      E('TSM','Taiwan Semiconductor','Semiconductors','International','World leading-edge foundry'),
      E('ASML','ASML','Semiconductors','International','Monopoly on EUV lithography'),
      E('AVGO','Broadcom','Semiconductors','US','Networking + custom silicon'),
      E('AMD','Advanced Micro Devices','Semiconductors','US','CPU/GPU share gains'),
      E('QCOM','Qualcomm','Semiconductors','US','Mobile + edge-AI SoCs'),
      E('MU','Micron','Semiconductors','US','HBM memory for AI accelerators'),
    ],
    dividend: [
      E('SCHD','Schwab US Dividend','Dividend ETF','US','Quality dividend-growth screen, ~3.5% yield'),
      E('JNJ','Johnson & Johnson','Healthcare','US','Dividend King, defensive cash flows'),
      E('PG','Procter & Gamble','Consumer Staples','US','Dividend King, staple demand'),
      E('KO','Coca-Cola','Consumer Staples','US','60+ years of dividend growth'),
      E('O','Realty Income','Real Estate','US','Monthly-pay REIT, ~5% yield'),
      E('ITC.NS','ITC','FMCG','India','High-yield Indian FMCG/staples'),
      E('POWERGRID.NS','Power Grid','Utilities','India','Regulated utility, steady ~4.5% yield'),
    ],
    indian: [
      E('RELIANCE.NS','Reliance Industries','Conglomerate','India','Energy-to-telecom-to-retail giant'),
      E('TCS.NS','Tata Consultancy','IT Services','India','Largest Indian IT exporter'),
      E('HDFCBANK.NS','HDFC Bank','Banking','India','Leading private-sector bank'),
      E('INFY.NS','Infosys','IT Services','India','Global IT services + AI services'),
      E('BHARTIARTL.NS','Bharti Airtel','Telecom','India','#2 telecom with ARPU tailwinds'),
      E('BAJFINANCE.NS','Bajaj Finance','Financials','India','Leading NBFC, high growth'),
      E('LT.NS','Larsen & Toubro','Infrastructure','India','Capex/infra cycle beneficiary'),
    ],
    'global-growth': [
      E('MSFT','Microsoft','Technology','US','Durable compounder across cloud + AI'),
      E('NVDA','NVIDIA','Semiconductors','US','AI infrastructure leader'),
      E('TSM','Taiwan Semiconductor','Semiconductors','International','Critical global chip foundry'),
      E('ASML','ASML','Semiconductors','International','EUV monopoly'),
      E('MELI','MercadoLibre','E-commerce','International','LatAm e-commerce + fintech'),
      E('SE','Sea Limited','E-commerce','International','SE-Asia e-commerce/gaming'),
      E('RELIANCE.NS','Reliance Industries','Conglomerate','India','India growth proxy'),
    ],
  };

  const THEME_ALIASES = {
    ai: 'ai', 'artificial intelligence': 'ai', 'a.i.': 'ai',
    cyber: 'cybersecurity', cybersecurity: 'cybersecurity', security: 'cybersecurity',
    cloud: 'cloud', 'cloud computing': 'cloud', saas: 'cloud',
    semi: 'semiconductors', semiconductor: 'semiconductors', semiconductors: 'semiconductors', chips: 'semiconductors', chip: 'semiconductors',
    dividend: 'dividend', income: 'dividend', 'dividend stocks': 'dividend',
    india: 'indian', indian: 'indian', nifty: 'indian', nse: 'indian',
    global: 'global-growth', 'global growth': 'global-growth', international: 'global-growth',
  };

  function detectTheme(msg) {
    const m = (msg || '').toLowerCase();
    // longest alias first
    const keys = Object.keys(THEME_ALIASES).sort((a, b) => b.length - a.length);
    for (const k of keys) if (new RegExp('(^|[^a-z])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(m)) return THEME_ALIASES[k];
    return null;
  }

  // Build a watchlist for a theme, optional region filter ('US'|'India'|'International'),
  // and a size limit (default 10).
  function build(theme, opts = {}) {
    const key = THEMES[theme] ? theme : (THEME_ALIASES[theme] || detectTheme(theme));
    if (!key || !THEMES[key]) return null;
    let items = THEMES[key].slice();
    if (opts.region) items = items.filter(i => i.region === opts.region);
    const limit = opts.limit || 10;
    items = items.slice(0, limit);
    return { theme: key, count: items.length, items,
             regions: [...new Set(items.map(i => i.region))],
             disclaimer: 'Curated thematic watchlist — research idea, not a recommendation.' };
  }

  return { build, detectTheme, THEMES, THEME_ALIASES,
           SUPPORTED_THEMES: Object.keys(THEMES) };
});
