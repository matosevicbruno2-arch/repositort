import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * config.js čita okruženje pri učitavanju, pa se za svaki slučaj učitava nanovo.
 * Neka polja (redirectUri) čitaju se lijeno, pa okruženje mora vrijediti i za
 * vrijeme provjera — zato se provjere izvode unutar ove funkcije.
 */
async function sConfigom(env, provjere) {
  const spremljeno = { ...process.env };
  try {
    for (const k of ['BASE_URL', 'RAILWAY_PUBLIC_DOMAIN', 'RENDER_EXTERNAL_HOSTNAME', 'PORT', 'GOOGLE_REDIRECT_URI']) {
      delete process.env[k];
    }
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', SHEET_ID: 'z', SESSION_SECRET: 't',
    }, env);

    const { config } = await import(`../src/config.js?t=${Math.random()}`);
    await provjere(config);
  } finally {
    process.env = spremljeno;
  }
}

test('bez postavki adresa je lokalna', async () => {
  await sConfigom({ PORT: '3000' }, (c) => {
    assert.equal(c.baseUrl, 'http://localhost:3000');
  });
});

test('domena s platforme se koristi kad BASE_URL nije zadan', async () => {
  await sConfigom({ RAILWAY_PUBLIC_DOMAIN: 'pult-production.up.railway.app' }, (c) => {
    assert.equal(c.baseUrl, 'https://pult-production.up.railway.app');
    assert.equal(c.google.redirectUri, 'https://pult-production.up.railway.app/auth/google/callback');
  });
});

test('BASE_URL ima prednost nad domenom s platforme', async () => {
  await sConfigom({ BASE_URL: 'https://pult.elink.hr', RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }, (c) => {
    assert.equal(c.baseUrl, 'https://pult.elink.hr');
  });
});

test('kosa crta na kraju BASE_URL-a ne stvara dvostruku u redirect_uri', async () => {
  await sConfigom({ BASE_URL: 'https://pult.elink.hr/' }, (c) => {
    assert.equal(c.google.redirectUri, 'https://pult.elink.hr/auth/google/callback');
  });
});

test('izričit GOOGLE_REDIRECT_URI se poštuje', async () => {
  await sConfigom({ BASE_URL: 'https://a.hr', GOOGLE_REDIRECT_URI: 'https://b.hr/auth/google/callback' }, (c) => {
    assert.equal(c.google.redirectUri, 'https://b.hr/auth/google/callback');
  });
});

test('nedostatak obavezne varijable javlja jasnu grešku', async () => {
  const spremljeno = { ...process.env };
  delete process.env.GOOGLE_CLIENT_ID;
  await assert.rejects(() => import(`../src/config.js?t=${Math.random()}`), /GOOGLE_CLIENT_ID/);
  process.env = spremljeno;
});
