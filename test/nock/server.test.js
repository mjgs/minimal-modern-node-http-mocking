// test/nock/server.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import nock from 'nock';
import { Octokit } from 'octokit';
import nodeFetch from 'node-fetch';
import { axiosFetcher } from '../utils/axiosFetcher.js';
import { startServer } from '../../src/server.js';
import path from 'node:path';

const NOCK_MODE = process.env.NOCK_MODE || 'live';
const FIXTURES_BASE = path.join(process.cwd(), 'test/fixtures/nock');
const port = 3001;
const baseUrl = `http://localhost:${port}`;

// --- GLOBAL UTILITIES ---
const originalConsole = { ...console };

function mockConsole() {
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  // Only silence logs in record/playback to keep the noise down
  if (NOCK_MODE === 'record' || NOCK_MODE === 'playback') {
    console.log = () => {};
  }
}

function restoreConsole() {
  Object.assign(console, originalConsole);
}

// --- 1. ENVIRONMENT SETUP (Pure Integration) ---
describe('Test Environment Setup', () => {
  let server;

  before(async () => {
    // We do NOT mock console here yet because we want to see 
    // the server boot logs for the environment check.
    nock.restore(); 
    server = await startServer(port);
  });

  // Ensure the first block is totally gone
  after(async () => {
    if (server) {
      await server.close();
      // Small delay to ensure the OS releases the port
      // await new Promise(resolve => setTimeout(resolve, 10)); 
    }
  });

  test('should verify the local server is reachable via direct fetch', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
  });
});

// --- 2. NOCK INTERCEPTION MATRIX ---
describe(`Baseline: Nock Interception [Mode: ${NOCK_MODE}]`, () => {
  let server;

  // Configure Nock Mode
  if (NOCK_MODE === 'record') {
    nock.back.setMode('record');
    nock.enableNetConnect(/localhost/); 
  } else if (NOCK_MODE === 'playback') {
    nock.back.setMode('lockdown');
  } else {
    nock.back.setMode('wild');
  }

  before(async () => {
    // Apply console mocking now to keep the matrix logs clean
    mockConsole();
    nock.activate();
    if (NOCK_MODE === 'off') {
      nock.restore();
    }
    if (NOCK_MODE !== 'playback') {
      server = await startServer(port);
    }
  });

  // async so the runner waits for the server to die
  // before finishing the suite or starting another transport block.
  after(async () => {
    restoreConsole();
    if (server) {
      await server.close();
    }
  });

  // --- NATIVE FETCH ---
  describe('Transport: Native Fetch', () => {
    const fixtureDir = path.join(FIXTURES_BASE, 'native');

    test('should fetch repo', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl });
      const { nockDone } = await nock.back('01-fetch-repo.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).get('/repos/owner/repo').reply(200, { mock: true });
      }

      const { data } = await octokit.request('GET /repos/owner/repo');
      
      if (NOCK_MODE === 'live') {
        assert.strictEqual(data.mock, true);
      } else {
        assert.strictEqual(data.full_name, 'owner/repo');
      }
      nockDone();
    });

    test('should perform merge (no changes) - 204 (INCOMPATIBILITY - record/playback mode)', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ 
        baseUrl, 
        request: { retries: 0 } 
      });
      
      const { nockDone } = await nock.back('02-merge-no-changes.json');
      
      try {
        if (NOCK_MODE === 'live') {
          nock(baseUrl).post('/repos/owner/repo/merges').reply(204);

          const res = await octokit.rest.repos.merge({ 
            owner: 'owner', repo: 'repo', base: 'main', head: 'already-synced' 
          });
          assert.strictEqual(res.status, 204, 'Manual mock should succeed in live mode');
        } else {
          await assert.rejects(
            octokit.rest.repos.merge({ 
              owner: 'owner', repo: 'repo', base: 'main', head: 'already-synced' 
            }),
            (err) => {
              const msg = err.cause?.message || err.message || "";
              return /Invalid response status code 204|Nock: Disallowed net connect/.test(msg);
            }
          );
        }
      } finally {
        nockDone();
      }
    });

    test('should perform merge (some changes) - 201', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl });

      const { nockDone } = await nock.back('03-merge-with-changes.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(201, { mockMerged: true });
      }

      const { data } = await octokit.rest.repos.merge({ 
        owner: 'owner', 
        repo: 'repo', 
        base: 'main', 
        head: 'feature' 
      });

      if (NOCK_MODE === 'live') {
        assert.strictEqual(data.mockMerged, true);
      } else {
        assert.strictEqual(data.merged, true);
      }
      nockDone();
    });
  });

  // --- NODE-FETCH ---
  describe('Transport: node-fetch', () => {
    const fixtureDir = path.join(FIXTURES_BASE, 'node-fetch');

    test('should fetch repo', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
      const { nockDone } = await nock.back('01-fetch-repo.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).get('/repos/owner/repo').reply(200, { mock: true });
      }

      const { data } = await octokit.request('GET /repos/owner/repo');
      
      if (NOCK_MODE === 'live') {
        assert.strictEqual(data.mock, true);
      } else {
        assert.strictEqual(data.full_name, 'owner/repo');
      }
      nockDone();
    });

    test('should perform merge (no changes) - 204', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch, headers: { connection: 'close' } } });
      const { nockDone } = await nock.back('02-merge-no-changes.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(204);
      }

      const res = await octokit.rest.repos.merge({ 
        owner: 'owner', 
        repo: 'repo', 
        base: 'main', 
        head: 'already-synced' 
      });
      
      assert.strictEqual(res.status, 204);
      nockDone();
    });

    test('should perform merge (some changes) - 201', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch, headers: { connection: 'close' } } });
      const { nockDone } = await nock.back('03-merge-with-changes.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(201, { mockMerged: true });
      }

      const { data } = await octokit.rest.repos.merge({ 
        owner: 'owner', 
        repo: 'repo', 
        base: 'main', 
        head: 'feature' 
      });

      if (NOCK_MODE === 'live') {
        assert.strictEqual(data.mockMerged, true);
      } else {
        assert.strictEqual(data.merged, true);
      }
      nockDone();
    });
  });

  // --- AXIOS ---
  describe('Transport: Axios', () => {
    const fixtureDir = path.join(FIXTURES_BASE, 'axios');

    test('should fetch repo', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl, request: { fetch: axiosFetcher, headers: { connection: 'close' } } });
      const { nockDone } = await nock.back('01-fetch-repo.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).get('/repos/owner/repo').reply(200, { mock: true });
      }

      const { data } = await octokit.request('GET /repos/owner/repo');
      
      if (NOCK_MODE === 'live') {
        assert.strictEqual(data.mock, true);
      } else {
        assert.strictEqual(data.full_name, 'owner/repo');
      }
      nockDone();
    });

    test('should perform merge (no changes) - 204', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl, request: { fetch: axiosFetcher, headers: { connection: 'close' } } });
      const { nockDone } = await nock.back('02-merge-no-changes.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(204);
      }

      const res = await octokit.rest.repos.merge({ 
        owner: 'owner', 
        repo: 'repo', 
        base: 'main', 
        head: 'already-synced' 
      });
      
      assert.strictEqual(res.status, 204);
      nockDone();
    });

    test('should perform merge (some changes) - 201', async () => {
      nock.back.fixtures = fixtureDir;
      const octokit = new Octokit({ baseUrl, request: { fetch: axiosFetcher, headers: { connection: 'close' } } });
      const { nockDone } = await nock.back('03-merge-with-changes.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(201, { mockMerged: true });
      }

      const { data } = await octokit.rest.repos.merge({ 
        owner: 'owner', 
        repo: 'repo', 
        base: 'main', 
        head: 'feature' 
      });

      if (NOCK_MODE === 'live') {
        assert.strictEqual(data.mockMerged, true);
      } else {
        assert.strictEqual(data.merged, true);
      }
      nockDone();
    });
  });
});
