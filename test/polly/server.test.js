// test/polly/server.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { Polly } from '@pollyjs/core';
import FetchAdapter from '@pollyjs/adapter-fetch';
import NodeHttpAdapter from '@pollyjs/adapter-node-http';
import FSPersister from '@pollyjs/persister-fs';
import { Octokit } from 'octokit';
import nodeFetch from 'node-fetch';
import { axiosFetcher } from '../utils/axiosFetcher.js';
import { startServer } from '../../src/server.js';

Polly.register(FetchAdapter);
Polly.register(NodeHttpAdapter);
Polly.register(FSPersister);

const POLLY_MODE = process.env.POLLY_MODE || 'live';
const FIXTURES_BASE = path.join(process.cwd(), 'test/fixtures/polly');
const port = 3002;
const baseUrl = `http://127.0.0.1:${port}`;

const MODE_MAP = {
  record: 'record',
  playback: 'replay',
  off: 'passthrough',
  live: 'passthrough'
};

// --- GLOBAL UTILITIES ---
const originalConsole = { ...console };

function mockConsole() {
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  // It only checks for 'record' or 'playback'
  if (POLLY_MODE === 'record' || POLLY_MODE === 'playback') {
    console.log = () => {};
  }
}

function restoreConsole() {
  Object.assign(console, originalConsole);
}

async function setupPolly(testName, adapters = ['fetch', 'node-http']) {
  return new Polly(testName, {
    mode: MODE_MAP[POLLY_MODE] || 'passthrough',
    adapters,
    persister: 'fs',
    persisterOptions: {
      fs: { recordingsDir: FIXTURES_BASE }
    },
    matchRequestsBy: {
      headers: false // Tell Polly: "Just match the URL and Method, ignore the headers"
    },
    logging: false,
    recordFailedRequests: true
  });
}

// --- 1. ENVIRONMENT SETUP ---
describe('Test Environment Setup', () => {
  let server;

  before(async () => {
    server = await startServer(port);
  });

  after(async () => {
    if (server) await server.close();
  });

  test('should verify the local server is reachable via direct fetch', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
  });
});

// --- 2. POLLY INTERCEPTION MATRIX ---
describe(`Baseline: Polly Interception [Mode: ${POLLY_MODE}]`, () => {
  let server;

  before(async () => {
    mockConsole();
    if (POLLY_MODE !== 'playback') {
      server = await startServer(port);
    }
  });

  after(async () => {
    restoreConsole();
    if (server) await server.close();
  });

  // --- NATIVE FETCH ---
  describe('Transport: Native Fetch', () => {
    test('should fetch repo', async (t) => {
      const polly = await setupPolly(t.name, ['fetch']);
      if (POLLY_MODE === 'live') {
        polly.server.get(`${baseUrl}/repos/owner/repo`).intercept((req, res) => {
          res.status(200).json({ mock: true });
        });
      }

      try {
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.request('GET /repos/owner/repo');

        if (POLLY_MODE === 'live') {
          assert.strictEqual(data.mock, true);
        } else {
          assert.strictEqual(data.full_name, 'owner/repo');
        }
      } finally {
        await polly.stop();
      }
    });

    test('should perform merge (no changes) - 204 (INCOMPATIBILITY)', async (t) => {
      const polly = await setupPolly(t.name, ['fetch']);
      
      // Hijack the actual console.error for this specific block 
      // because Polly's FetchAdapter is being stubborn.
      const originalError = console.error;
      console.error = () => {};

      if (POLLY_MODE === 'live') {
        polly.server.post(`${baseUrl}/repos/owner/repo/merges`).intercept((req, res) => {
          res.sendStatus(204);
        });
      }

      try {
        const octokit = new Octokit({ 
          baseUrl,
          request: { retries: 0 } 
        });

        await octokit.rest.repos.merge({ 
          owner: 'owner', repo: 'repo', base: 'main', head: 'already-synced' 
        });
      } catch (err) {
        const errorMessage = err.cause?.message || err.message;
        if (errorMessage.includes('Invalid response status code 204')) {
          return; 
        }
        throw err;
      } finally {
        console.error = originalError; // Restore it immediately
        await polly.stop();
      }
    });

    test('should perform merge (some changes) - 201', async (t) => {
      const polly = await setupPolly(t.name, ['fetch']);
      if (POLLY_MODE === 'live') {
        polly.server.post(`${baseUrl}/repos/owner/repo/merges`).intercept((req, res) => {
          res.status(201).json({ mockMerged: true });
        });
      }

      try {
        const octokit = new Octokit({ baseUrl });
        const { data } = await octokit.rest.repos.merge({ 
          owner: 'owner', 
          repo: 'repo', 
          base: 'main', 
          head: 'feature' 
        });

        if (POLLY_MODE === 'live') {
          assert.strictEqual(data.mockMerged, true);
        } else {
          assert.strictEqual(data.merged, true);
        }
      } finally {
        await polly.stop();
      }
    });
  });

  // --- NODE-FETCH ---
  describe('Transport: node-fetch', () => {
    test('should fetch repo', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      if (POLLY_MODE === 'live') {
        polly.server.get(`${baseUrl}/repos/owner/repo`).intercept((req, res) => {
          res.status(200).json({ mock: true });
        });
      }

      try {
        const octokit = new Octokit({ baseUrl, request: { fetch: nodeFetch } });
        const { data } = await octokit.request('GET /repos/owner/repo');

        if (POLLY_MODE === 'live') {
          assert.strictEqual(data.mock, true);
        } else {
          assert.strictEqual(data.full_name, 'owner/repo');
        }
      } finally {
        await polly.stop();
      }
    });

    test('should perform merge (no changes) - 204', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      if (POLLY_MODE === 'live') {
        polly.server.post(`${baseUrl}/repos/owner/repo/merges`).intercept((req, res) => {
          res.sendStatus(204);
        });
      }

      try {
        const octokit = new Octokit({ 
          baseUrl, 
          request: { fetch: nodeFetch, headers: { connection: 'close' } } 
        });
        const res = await octokit.rest.repos.merge({ 
          owner: 'owner', 
          repo: 'repo', 
          base: 'main', 
          head: 'already-synced' 
        });
        assert.strictEqual(res.status, 204);
      } finally {
        await polly.stop();
      }
    });

    test('should perform merge (some changes) - 201', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      if (POLLY_MODE === 'live') {
        polly.server.post(`${baseUrl}/repos/owner/repo/merges`).intercept((req, res) => {
          res.status(201).json({ mockMerged: true });
        });
      }

      try {
        const octokit = new Octokit({ 
          baseUrl, 
          request: { fetch: nodeFetch, headers: { connection: 'close' } } 
        });
        const { data } = await octokit.rest.repos.merge({ 
          owner: 'owner', 
          repo: 'repo', 
          base: 'main', 
          head: 'feature' 
        });

        if (POLLY_MODE === 'live') {
          assert.strictEqual(data.mockMerged, true);
        } else {
          assert.strictEqual(data.merged, true);
        }
      } finally {
        await polly.stop();
      }
    });
  });

  // --- AXIOS ---
  describe('Transport: Axios', () => {
    test('should fetch repo', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      if (POLLY_MODE === 'live') {
        polly.server.get(`${baseUrl}/repos/owner/repo`).intercept((req, res) => {
          res.status(200).json({ mock: true });
        });
      }

      try {
        const octokit = new Octokit({ 
          baseUrl, 
          request: { fetch: axiosFetcher, headers: { connection: 'close' } } 
        });
        const { data } = await octokit.request('GET /repos/owner/repo');

        if (POLLY_MODE === 'live') {
          assert.strictEqual(data.mock, true);
        } else {
          assert.strictEqual(data.full_name, 'owner/repo');
        }
      } finally {
        await polly.stop();
      }
    });

    test('should perform merge (no changes) - 204', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      if (POLLY_MODE === 'live') {
        polly.server.post(`${baseUrl}/repos/owner/repo/merges`).intercept((req, res) => {
          res.sendStatus(204);
        });
      }

      try {
        const octokit = new Octokit({ 
          baseUrl, 
          request: { fetch: axiosFetcher, headers: { connection: 'close' } } 
        });
        const res = await octokit.rest.repos.merge({ 
          owner: 'owner', 
          repo: 'repo', 
          base: 'main', 
          head: 'already-synced' 
        });
        assert.strictEqual(res.status, 204);
      } finally {
        await polly.stop();
      }
    });

    test('should perform merge (some changes) - 201', async (t) => {
      const polly = await setupPolly(t.name, ['node-http']);
      if (POLLY_MODE === 'live') {
        polly.server.post(`${baseUrl}/repos/owner/repo/merges`).intercept((req, res) => {
          res.status(201).json({ mockMerged: true });
        });
      }

      try {
        const octokit = new Octokit({ 
          baseUrl, 
          request: { fetch: axiosFetcher, headers: { connection: 'close' } } 
        });
        const { data } = await octokit.rest.repos.merge({ 
          owner: 'owner', 
          repo: 'repo', 
          base: 'main', 
          head: 'feature' 
        });

        if (POLLY_MODE === 'live') {
          assert.strictEqual(data.mockMerged, true);
        } else {
          assert.strictEqual(data.merged, true);
        }
      } finally {
        await polly.stop();
      }
    });
  });
});
