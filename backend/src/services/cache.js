'use strict';
const NodeCache = require('node-cache');

// Different TTLs for different data types
const caches = {
  quote:   new NodeCache({ stdTTL: 30,   checkperiod: 10  }), // 30s — live prices
  profile: new NodeCache({ stdTTL: 3600, checkperiod: 120 }), // 1hr — company info
  metrics: new NodeCache({ stdTTL: 3600, checkperiod: 120 }), // 1hr — financials
  news:    new NodeCache({ stdTTL: 300,  checkperiod: 60  }), // 5min — news
  candles: new NodeCache({ stdTTL: 60,   checkperiod: 20  }), // 1min — candles
  search:  new NodeCache({ stdTTL: 600,  checkperiod: 60  }), // 10min — search
};

module.exports = {
  get(type, key) {
    return caches[type]?.get(key) ?? null;
  },
  set(type, key, value) {
    caches[type]?.set(key, value);
  },
  stats() {
    return Object.fromEntries(
      Object.entries(caches).map(([k, c]) => [k, c.getStats()])
    );
  },
};
