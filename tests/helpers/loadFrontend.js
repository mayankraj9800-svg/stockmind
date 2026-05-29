'use strict';
/**
 * Loads the frontend's global `APP` and `CONFIG` objects into a Node sandbox so
 * pure logic (symbol resolution, intent routing, memory, crypto detection,
 * ticker extraction) can be unit-tested WITHOUT a browser.
 *
 * It extracts the main inline <script> (the one that is NOT type="module" and
 * defines APP), stubs the browser globals it touches at load time, and runs it
 * in a vm context. No network, DOM, or Firebase is required.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

function makeEl() {
  const el = {
    _children: [],
    style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this._children.push(c); return c; },
    removeChild() {}, remove() {}, prepend() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    insertAdjacentHTML() {}, setAttribute() {}, getAttribute() { return null; },
    focus() {}, click() {},
    get innerHTML() { return this._html || ''; }, set innerHTML(v) { this._html = v; },
    get textContent() { return this._txt || ''; }, set textContent(v) { this._txt = v; },
    get value() { return this._val || ''; }, set value(v) { this._val = v; },
    get isConnected() { return true; },
    children: [], lastChild: null, dataset: {},
  };
  return el;
}

function loadFrontend() {
  const htmlPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Grab all non-module inline scripts; pick the largest (the app).
  const re = /<script(?![^>]*\bsrc=)(?![^>]*type=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let m, best = '';
  while ((m = re.exec(html))) { if (m[1].length > best.length) best = m[1]; }
  if (!best) throw new Error('Could not locate the main inline <script> in index.html');

  // ── Browser stubs ──────────────────────────────────────────────────────────
  const doc = {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener() {},
    body: makeEl(),
  };
  const win = {
    location: { hostname: 'localhost', href: 'http://localhost/' },
    addEventListener() {},
    setTimeout() { return 0; }, clearTimeout() {},
    setInterval() { return 0; }, clearInterval() {},
    navigator: { userAgent: 'node-test' },
    localStorage: { _d: {}, getItem(k){return this._d[k]??null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} },
    console,
    fetch: () => Promise.reject(new Error('network disabled in tests')),
    FB: null,
  };
  win.window = win;

  const sandbox = {
    window: win,
    self: win,            // engine UMD resolves root via `self` → attaches to window
    document: doc,
    navigator: win.navigator,
    localStorage: win.localStorage,
    console,
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    fetch: win.fetch,
    location: win.location,
    AbortController: class { constructor(){ this.signal = {}; } abort(){} },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);

  // Load the engine modules (conversationContext, portfolioEngine, …) into the
  // SAME context first, so window.ConversationContext / PortfolioEngine / etc.
  // exist exactly as they do in the browser.
  const enginesDir = path.join(__dirname, '..', '..', 'frontend', 'engines');
  for (const f of ['conversationContext.js', 'portfolioEngine.js', 'watchlistEngine.js', 'indexRouter.js']) {
    const p = path.join(enginesDir, f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }

  // Expose APP/CONFIG/ApiClient out of the script's top-level `const` scope.
  const wrapped = best + '\n;globalThis.__APP = (typeof APP!=="undefined")?APP:null;'
                       + 'globalThis.__CONFIG = (typeof CONFIG!=="undefined")?CONFIG:null;'
                       + 'globalThis.__ApiClient = (typeof ApiClient!=="undefined")?ApiClient:null;';
  vm.runInContext(wrapped, sandbox, { filename: 'index.inline.js' });

  if (!sandbox.__APP) throw new Error('APP not found after evaluating inline script');
  return {
    APP: sandbox.__APP, CONFIG: sandbox.__CONFIG, ApiClient: sandbox.__ApiClient,
    ConversationContext: win.ConversationContext, PortfolioEngine: win.PortfolioEngine,
    WatchlistEngine: win.WatchlistEngine, IndexRouter: win.IndexRouter, sandbox,
  };
}

module.exports = { loadFrontend };
