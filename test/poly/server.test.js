// test/poly/server.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { Polly } from '@pollyjs/core';
import FetchAdapter from '@pollyjs/adapter-fetch';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import FSPersister from '@pollyjs/persister-fs';
import { Octokit } from 'octokit';
import nodeFetch from 'node-fetch';
import { startServer } from '../../src/server.js';

Polly.register(FetchAdapter);
Polly.register(NodeHttpAdapter);
Polly.register(FSPersister);

// Map your custom modes to Polly's native modes
const MODE_MAP = {
  record: 'record',
  playback: 'replay',
  off: 'passthrough',
  live: 'passthrough' // We use passthrough so we can manually intercept
};

const POLLY_MODE = process.env.POLLY_MODE || 'live';

describe(`Baseline: Polly Interception [Mode: ${POLLY_MODE}]`, () => {
  let server;
  const port = 3002;
  const baseUrl = `http://localhost:${port}`;
  const originalConsole = { ...console };

  function mockConsole() {
    console.info = () => {};
    console.warn = () => {};
    console.debug = () => {};
    if (POLLY_MODE === 'record' || POLLY_MODE === 'playback') {
      console.log = () => {};
    }
  }

  function restoreConsole() {
    Object.assign(console, originalConsole);
  }

  before(async () => {
    mockConsole();
    // Only start the server if we aren't in playback (replay) mode
    if (POLLY_MODE !== 'playback') {
      server = await startServer(port);
    }
  });

  after(async () => {
    restoreConsole();
    if (server) await server.close();
  });

  // Helper to initialize Polly with the consistent configuration
  async function setupPolly(testName, adapters = ['fetch']) {
    return new Polly(testName, {
      mode: MODE_MAP[POLLY_MODE] || 'passthrough',
      adapters,
      persister: 'fs',
      persisterOptions: {
        fs: { recordingsDir: path.join(process.cwd(), 'test/fixtures/poly') }
      },
      // Match the Nock behavior: don't allow unmocked requests in playback
      logging: false 
    });
  }

  describe('Test Environment Setup', () => {
    test('should verify the local server is reachable via direct fetch', async () => {
      const res = await fetch(`${baseUrl}/health`);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
    });
  });

  describe('Core Baseline Tests', () => {
    test('should successfully intercept native fetch requests', async (t) => {
      const polly = await setupPolly(t.name, ['fetch']);
      
      // Manual interception only in 'live' mode (mimics your Nock logic)
      if (POLLY_MODE === 'live') {
        polly.server
          .get(`${baseUrl}/repos/owner/repo`)
          .intercept((req, res) => res.status(200).json({ mock: true }));
      }

      try {
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.request('GET /repos/owner/repo');

        if (POLLY_MODE === 'off' || POLLY_MODE === 'record' || POLLY_MODE === 'playback') {
          assert.strictEqual(data.full_name, 'owner/repo');
        } else {
          // This branch ONLY runs in 'live' mode where you manually .intercept()
          assert.strictEqual(data.mock, true);
        }
      } finally {
        await polly.stop();
      }
    });

    test('should successfully intercept node-fetch requests', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      
      if (POLLY_MODE === 'live') {
        polly.server
          .get(`${baseUrl}/repos/owner/repo`)
          .intercept((req, res) => res.status(200).json({ mock: true }));
      }

      try {
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const { data } = await octokit.request('GET /repos/owner/repo');

        if (POLLY_MODE === 'off' || POLLY_MODE === 'record' || POLLY_MODE === 'playback') {
          assert.strictEqual(data.full_name, 'owner/repo');
        } else {
          assert.strictEqual(data.mock, true);
        }
      } finally {
        await polly.stop();
      }
    });

    test('should handle a manual 204 response without crashing', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      
      if (POLLY_MODE === 'live') {
        polly.server
          .post(`${baseUrl}/repos/owner/repo/merges`)
          .intercept((req, res) => res.sendStatus(204));
      }

      try {
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
      const polly = await setupPolly(t.name, ['fetch']);
      
      if (POLLY_MODE === 'live') {
        polly.server
          .post(`${baseUrl}/repos/owner/repo/merges`)
          .intercept((req, res) => res.status(201).json({ merged: true }));
      }

      try {
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.rest.repos.merge({ 
          owner: 'owner', repo: 'repo', base: 'main', head: 'feature' 
        });
        
        // Server returns merged: true for 'feature' branch
        assert.strictEqual(data.merged, true);
      } finally {
        await polly.stop();
      }
    });
  });
});
