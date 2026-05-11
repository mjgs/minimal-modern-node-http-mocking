import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import nock from 'nock';
import { Octokit } from 'octokit';
import nodeFetch from 'node-fetch';
import { startServer } from '../../src/server.js';
import path from 'node:path';

const NOCK_MODE = process.env.NOCK_MODE || 'live';

describe(`Baseline: Nock Interception [Mode: ${NOCK_MODE}]`, () => {
  let server;
  const port = 3001;
  const baseUrl = `http://localhost:${port}`;
  const originalConsole = { ...console };

  // Configure Nock Back
  nock.back.fixtures = path.join(process.cwd(), 'test/fixtures/nock');
  
  // 'wild' mode allows the local server to be hit during 'live' or 'off'
  if (NOCK_MODE === 'record') nock.back.setMode('record');
  else if (NOCK_MODE === 'playback') nock.back.setMode('lockdown');
  else nock.back.setMode('wild');

  function mockConsole() {
    console.info = () => {};
    console.warn = () => {};
    console.debug = () => {};
    if (NOCK_MODE === 'record' || NOCK_MODE === 'playback') {
        console.log = () => {};
    }
  }

  function restoreConsole() {
    Object.assign(console, originalConsole);
  }

  before(async () => {
    mockConsole();
    if (NOCK_MODE === 'off') nock.restore();
    if (NOCK_MODE !== 'playback') server = await startServer(port);
  });

  after(() => {
    restoreConsole();
    if (server) server.close();
  });

  describe('Core Baseline Tests', () => {

    test('should successfully intercept native fetch requests (proving Undici support)', async () => {
      const { nockDone } = await nock.back('native-fetch.json');
      
      if (NOCK_MODE === 'live') {
        nock(baseUrl).get('/repos/owner/repo').reply(200, { mock: true });
      }

      try {
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.request('GET /repos/owner/repo');

        if (NOCK_MODE === 'off' || NOCK_MODE === 'record' || NOCK_MODE === 'playback') {
          assert.strictEqual(data.full_name, 'owner/repo');
        } else {
          // This runs only in 'live' mode
          assert.strictEqual(data.mock, true);
        }
      } finally {
        nockDone();
      }
    });

    test('should successfully intercept node-fetch requests (legacy fallback)', async () => {
      const { nockDone } = await nock.back('node-fetch-legacy.json');

      if (NOCK_MODE === 'live') {
        nock(baseUrl).get('/repos/owner/repo').reply(200, { mock: true });
      }

      try {
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const { data } = await octokit.request('GET /repos/owner/repo');
        
        if (NOCK_MODE === 'off' || NOCK_MODE === 'record' || NOCK_MODE === 'playback') {
          assert.strictEqual(data.full_name, 'owner/repo');
        } else {
          // This runs only in 'live' mode
          assert.strictEqual(data.mock, true);
        }
      } finally {
        nockDone();
      }
    });

    test('should handle a manual 204 response without crashing', async () => {
      const { nockDone } = await nock.back('status-204.json');

      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(204);
      }

      try {
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const res = await octokit.rest.repos.merge({ 
          owner: 'owner', repo: 'repo', base: 'main', head: 'already-synced' 
        });
        
        assert.strictEqual(res.status, 204);
      } finally {
        nockDone();
      }
    });

    test('should successfully intercept a 201 via the rest client wrapper', async () => {
      const { nockDone } = await nock.back('status-201.json');

      if (NOCK_MODE === 'live') {
        nock(baseUrl).post('/repos/owner/repo/merges').reply(201, { merged: true });
      }

      try {
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const { data } = await octokit.rest.repos.merge({ 
          owner: 'owner', repo: 'repo', base: 'main', head: 'feature' 
        });
        
        if (NOCK_MODE === 'off' || NOCK_MODE === 'record') {
          assert.strictEqual(data.merged, true); // Server returns true for 'feature'
        } else {
          assert.strictEqual(data.merged, true);
        }
      } finally {
        nockDone();
      }
    });
  });
});
