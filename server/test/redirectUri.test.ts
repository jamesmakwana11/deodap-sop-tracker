/** Automatic Meta OAuth redirect URI: localhost, Render, custom domains, proxy headers. */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { detectedRedirectUri } from '../src/http/publicUrl.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { resolveRedirectUri } from '../src/meta/appConfig.js';

const CB = '/api/meta/oauth/callback';

/** A tiny app that answers with the detected redirect URI, as production or development. */
function probe(opts: { production: boolean; trustProxy?: number }) {
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);
  app.get('/uri', (req, res) => res.json({ uri: detectedRedirectUri(req, opts.production) }));
  app.use(errorHandler);
  return app;
}
const uri = async (app: express.Express, headers: Record<string, string>) => {
  let r = request(app).get('/uri');
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  const res = await r;
  return res.status === 200 ? (res.body.uri as string) : res.status;
};

describe('local', () => {
  it('uses http://localhost with the port the browser used (Vite dev server or a local build)', async () => {
    expect(await uri(probe({ production: false }), { Host: 'localhost:5173' })).toBe(`http://localhost:5173${CB}`);
    expect(await uri(probe({ production: true }), { Host: 'localhost:4000' })).toBe(`http://localhost:4000${CB}`);
    expect(await uri(probe({ production: true }), { Host: '127.0.0.1:4000' })).toBe(`http://127.0.0.1:4000${CB}`);
  });
});

describe('production', () => {
  it('detects the Render address behind its proxy, with https', async () => {
    const render = probe({ production: true, trustProxy: 1 });
    expect(await uri(render, { Host: 'deodap-sop.onrender.com', 'X-Forwarded-Proto': 'https' })).toBe(`https://deodap-sop.onrender.com${CB}`);
    // https even if the proxy header is missing: TLS ends at the proxy in production.
    expect(await uri(probe({ production: true }), { Host: 'deodap-sop.onrender.com' })).toBe(`https://deodap-sop.onrender.com${CB}`);
  });

  it('detects any custom domain, normalised, without default ports', async () => {
    const app = probe({ production: true, trustProxy: 1 });
    expect(await uri(app, { Host: 'SOP.DeoDap.com' })).toBe(`https://sop.deodap.com${CB}`);
    expect(await uri(app, { Host: 'sop.deodap.com:443', 'X-Forwarded-Proto': 'https' })).toBe(`https://sop.deodap.com${CB}`);
    expect(await uri(app, { Host: 'internal:10000', 'X-Forwarded-Host': 'audit.deodap.in', 'X-Forwarded-Proto': 'https' })).toBe(`https://audit.deodap.in${CB}`);
  });
});

describe('proxy headers', () => {
  it('ignores X-Forwarded-* unless the proxy is trusted', async () => {
    const direct = probe({ production: false });
    expect(await uri(direct, { Host: 'app.example.com', 'X-Forwarded-Host': 'evil.example.net', 'X-Forwarded-Proto': 'https' })).toBe(`http://app.example.com${CB}`);
    const proxied = probe({ production: false, trustProxy: 1 });
    expect(await uri(proxied, { Host: 'app.example.com', 'X-Forwarded-Host': 'app.example.org', 'X-Forwarded-Proto': 'https' })).toBe(`https://app.example.org${CB}`);
  });

  it('refuses host names that are not host names', async () => {
    const app = probe({ production: true, trustProxy: 1 });
    for (const bad of ['evil.com/path', 'a b.com', 'evil.com@good.com', 'x.com:99999', '-bad.com']) {
      expect(await uri(app, { Host: 'ok.example.com', 'X-Forwarded-Host': bad }), bad).toBe(400);
    }
  });

  it('trusts Render’s proxy automatically, and nothing by default', () => {
    const before = process.env.RENDER;
    try {
      delete process.env.RENDER;
      expect(createApp().get('trust proxy')).toBeFalsy();
      process.env.RENDER = 'true';
      expect(createApp().get('trust proxy')).toBe(1);
    } finally {
      if (before === undefined) delete process.env.RENDER;
      else process.env.RENDER = before;
    }
  });
});

describe('fixed redirect URI (optional override)', () => {
  const detected = `https://sop.deodap.com${CB}`;
  it('is used when set, except a localhost one on a public domain', () => {
    expect(resolveRedirectUri({ fixedRedirectUri: null }, detected)).toEqual({ uri: detected, source: 'detected', ignoredFixed: null });
    expect(resolveRedirectUri({ fixedRedirectUri: `https://www.deodap.com${CB}` }, detected).uri).toBe(`https://www.deodap.com${CB}`);
    // The old Settings form saved http://localhost:5173/... — never valid on a public domain.
    const stale = resolveRedirectUri({ fixedRedirectUri: `http://localhost:5173${CB}` }, detected);
    expect(stale).toEqual({ uri: detected, source: 'detected', ignoredFixed: `http://localhost:5173${CB}` });
    expect(resolveRedirectUri({ fixedRedirectUri: `http://localhost:5173${CB}` }, `http://localhost:4000${CB}`).uri).toBe(`http://localhost:5173${CB}`);
  });
});

afterEach(() => undefined);
