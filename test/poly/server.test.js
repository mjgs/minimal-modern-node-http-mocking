// test/poly/server.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { Polly } from '@pollyjs/core';
import FetchAdapter from '@pollyjs/adapter-fetch';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import { Octokit } from 'octokit';
import nodeFetch from 'node-fetch';
import { startServer } from '../../src/server.js';

Polly.register(FetchAdapter);
Polly.register(NodeHttpAdapter);

describe('Baseline: Polly Interception', () => {
  let server;
  const port = 3002;
  const baseUrl = `http://localhost:${port}`;
  const originalConsole = { ...console };

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
    server = await startServer(port);
  });

  after(async () => {
    restoreConsole();
    await server.close();
  });

  describe('Test Environment Setup', () => {
    test('should verify the local server is reachable via direct fetch', async () => {
      const res = await fetch(`${baseUrl}/health`);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
    });
  });

  describe('Core Baseline Tests', () => {
    test('should successfully intercept native fetch requests', async (t) => {
      // Keep this as 'fetch' or add both for safety
      const polly = new Polly(t.name, { adapters: ['fetch'] });
      try {
        polly.server
          .get(`${baseUrl}/repos/owner/repo`)
          .intercept((req, res) => res.status(200).json({ mock: true }));
        
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.request('GET /repos/owner/repo');
        
        assert.strictEqual(data.mock, true);
        assert.strictEqual(data.full_name, undefined);
      } finally {
        await polly.stop();
      }
    });

    test('should successfully intercept node-fetch requests', async (t) => {
      // CRITICAL: You must include 'node-http' to catch node-fetch
      const polly = new Polly(t.name, { adapters: ['node-http'] }); 
      try {
        polly.server
          .get(`${baseUrl}/repos/owner/repo`)
          .intercept((req, res) => res.status(200).json({ mock: true }));
        
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const { data } = await octokit.request('GET /repos/owner/repo');
        
        assert.strictEqual(data.mock, true);
      } finally {
        await polly.stop();
      }
    });

    test('should handle a manual 204 response without crashing', async (t) => {
      // Using 'node-http' here because you are using nodeFetch in the request
      const polly = new Polly(t.name, { adapters: ['node-http'] });
      try {
        polly.server
          .post(`${baseUrl}/repos/owner/repo/merges`)
          .intercept((req, res) => res.sendStatus(204));
        
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const res = await octokit.rest.repos.merge({ 
          owner: 'owner', repo: 'repo', base: 'main', head: 'already-synced' 
        });
        
        assert.strictEqual(res.status, 204);
      } finally {
        await polly.stop();
      }
    });

    test('should successfully intercept a 201 via the rest client wrapper', async (t) => {
      // Defaulting back to native fetch here (no nodeFetch passed to Octokit)
      const polly = new Polly(t.name, { adapters: ['fetch'] });
      try {
        polly.server
          .post(`${baseUrl}/repos/owner/repo/merges`)
          .intercept((req, res) => res.status(201).json({ merged: true }));
        
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.rest.repos.merge({ 
          owner: 'owner', repo: 'repo', base: 'main', head: 'feature' 
        });
        
        assert.strictEqual(data.merged, true);
      } finally {
        await polly.stop();
      }
    });
  });
});
