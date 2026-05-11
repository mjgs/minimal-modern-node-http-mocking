// test/utils/axiosFetcher.js

import axios from 'axios';

/**
 * A shim to make Axios look like a standard fetch client for Octokit.
 * This allows us to use Axios as the transport layer while keeping
 * the Octokit consumer logic identical across tests.
 */
export const axiosFetcher = async (url, options) => {
  const res = await axios({
    url,
    method: options.method,
    data: options.body,
    headers: options.headers,
    // Prevents Axios from throwing on 4xx/5xx so Octokit can handle errors
    validateStatus: () => true, 
  });

  return {
    status: res.status,
    // Node 18+ provides the global Headers class
    headers: new Headers(res.headers),
    // Octokit and other fetch consumers expect these helper methods
    json: async () => res.data,
    text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
    ok: res.status >= 200 && res.status < 300,
  };
};
