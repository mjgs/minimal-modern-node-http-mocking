// src/server.js

import express from 'express';

const app = express();

// Logging Middleware: This is our "Visual Proof"
app.use((req, res, next) => {
  console.log(`[Server] Incoming: ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/repos/:owner/:repo', (req, res) => {
  res.json({ 
    name: req.params.repo, 
    full_name: `${req.params.owner}/${req.params.repo}` 
  });
});

app.post('/repos/:owner/:repo/merges', (req, res) => {
  const { base, head } = req.body;
  
  if (head === 'already-synced') {
    return res.status(204).end();
  }

  res.status(201).json({
    merged: true,
    sha: '12345abcde',
    message: `Merged ${head} into ${base}`
  });
});

export function startServer(port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[Server] Booted on port ${port}`);
      resolve(server);
    });

    // Shutdown message
    server.on('close', () => {
      console.log(`[Server] Shutting down on port ${port}`);
    });
  });
}
