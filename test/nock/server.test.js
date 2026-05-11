import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import nock from 'nock';
import { Octokit } from 'octokit';
import nodeFetch from 'node-fetch';
import { startServer } from '../../src/server.js';

describe('Baseline: Nock Interception', () => {
  let server;
  const port = 3001;
  const baseUrl = `http://localhost:${port}`;
  const originalConsole = { ...console };

  // Comment out to see the server logs during testing. 
  // Useful for debugging, but can be noisy when everything is working.
  function mockConsole() {
    console.log = () => {}; 
    console.info = () => {};
    console.warn = () => {};
    console.debug = () => {};
  }

  function restoreConsole() {
    Object.assign(console, originalConsole);
  }

  before(async () => {
    mockConsole();
    // nock.enableNetConnect('localhost:3001');
    server = await startServer(port); 
  });

  after(() => {
    restoreConsole();
    server.close();
  });

  describe('Test Environment Setup', () => {
    test('should verify the local server is reachable via direct fetch', async () => {
      const res = await fetch(`${baseUrl}/health`);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
    });
  });

  describe('Core Baseline Tests', () => {
    test('should successfully intercept native fetch requests (proving Undici support)', async () => {
      // 1. Setup the interceptor
      nock(baseUrl)
        .get('/repos/owner/repo')
        .reply(200, { mock: true });
      
      const octokit = new Octokit({ baseUrl });
      const { data } = await octokit.request('GET /repos/owner/repo');
      
      /**
       * PROOF OF INTERCEPTION:
       * 1. data.mock is true: Nock successfully caught the request and injected the body.
       * 2. No [Server] Incoming log: The request was caught BEFORE it hit the network.
       */
      assert.strictEqual(data.mock, true, 'Nock should have delivered the mocked payload');
      assert.strictEqual(data.full_name, undefined, 'Should NOT have received real data from the server');
    });

    test('should successfully intercept node-fetch requests (legacy fallback)', async () => {
      nock(baseUrl).get('/repos/owner/repo').reply(200, { mock: true });
      
      const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
      const { data } = await octokit.request('GET /repos/owner/repo');
      
      assert.strictEqual(data.mock, true);
    });

    test('should handle a manual 204 response without crashing', async () => {
      nock(baseUrl).post('/repos/owner/repo/merges').reply(204);
      
      const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
      const res = await octokit.rest.repos.merge({ 
        owner: 'owner', repo: 'repo', base: 'main', head: 'already-synced' 
      });
      
      assert.strictEqual(res.status, 204);
    });

    test('should successfully intercept a 201 via the rest client wrapper', async () => {
      nock(baseUrl).post('/repos/owner/repo/merges').reply(201, { merged: true });
      
      const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
      const { data } = await octokit.rest.repos.merge({ 
        owner: 'owner', repo: 'repo', base: 'main', head: 'feature' 
      });
      
      assert.strictEqual(data.merged, true);
    });
  });
});
