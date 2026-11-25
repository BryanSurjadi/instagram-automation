import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createDrive, readServiceAccount } from './drive.mjs';
import { contentTypes, createMediaLinks } from './media-link.mjs';

const require = createRequire(import.meta.url);
const express = require('express');

export function createApp(drive, links) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_, res) => res.sendStatus(200));

  app.get('/media/:id.:format', async (req, res) => {
    const { id, format } = req.params;
    if (!links.verify(id, format, req.query)) {
      return res.sendStatus(403);
    }

    res.set('Cache-Control', 'private, no-store');
    res.set('Accept-Ranges', 'bytes');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
      return res.set('Content-Type', contentTypes[format])
        .set('Content-Length', req.query.size).end();
    }

    const range = req.get('Range');
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
      return res.set('Content-Range', 'bytes */' + req.query.size).sendStatus(416);
    }

    const aborted = new AbortController();
    res.on('close', () => aborted.abort());
    try {
      const upstream = await drive.download(id, {
        range,
        signal: AbortSignal.any([aborted.signal, AbortSignal.timeout(120_000)]),
      });
      if (upstream.status === 416) {
        await upstream.body?.cancel();
        return res.set('Content-Range', 'bytes */' + req.query.size).sendStatus(416);
      }
      if (![200, 206].includes(upstream.status) || !upstream.body ||
          upstream.headers.get('Content-Type')?.split(';')[0] !== contentTypes[format]) {
        await upstream.body?.cancel();
        return res.sendStatus(502);
      }

      res.status(upstream.status);
      res.set('Content-Type', contentTypes[format]);
      for (const header of ['content-length', 'content-range']) {
        const value = upstream.headers.get(header);
        if (value) res.set(header, value);
      }
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      if (!res.headersSent && !res.destroyed) res.sendStatus(502);
      else if (!res.destroyed) res.destroy();
    }
  });

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = createApp(createDrive(readServiceAccount(process.env)),
    createMediaLinks(process.env.MEDIA_SIGNING_KEY));
  app.listen(process.env.PORT || 3000, () => console.log('Instagram media relay is ready.'));
}
