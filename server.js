#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const argv = require('process').argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i];
  const value = argv[i + 1];
  if (!key.startsWith('--') || !value) continue;
  args[key.slice(2)] = value;
}

const port = parseInt(args.port || args.p || '5173', 10);
const certPath = args.cert || args.c || 'cert.pem';
const keyPath = args.key || args.k || 'key.pem';
const root = process.cwd();

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.js': return 'application/javascript';
    case '.css': return 'text/css';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.glb': return 'model/gltf-binary';
    case '.gltf': return 'model/gltf+json';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

try {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('Certificate or key file not found:', certPath, keyPath);
    process.exit(1);
  }
} catch (err) {
  console.error('Error checking cert/key:', err.message);
  process.exit(1);
}

const options = {
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
}

https.createServer(options, (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const parsed = url.parse(req.url || '/');
  let safeSuffix = path.normalize(parsed.pathname || '/').replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(root, safeSuffix);
  if (parsed.pathname === '/' || parsed.pathname === '') {
    filePath = path.join(root, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fs.stat(filePath, (dirErr, dirStats) => {
        if (dirErr || !dirStats.isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        streamFile(filePath, res);
      });
      return;
    }

    streamFile(filePath, res);
  });
}).listen(port, () => {
  console.log(`Serving HTTPS on https://localhost:${port}`);
  console.log('Press CTRL+C to stop');
});

function streamFile(filePath, res) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.statusCode = 500;
    res.end('Server error');
  });
  res.setHeader('Content-Type', contentType(filePath));
  res.setHeader('Cache-Control', 'no-store');
  stream.pipe(res);
}
