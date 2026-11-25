import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createInstagram } from '../src/instagram.mjs';
import { createMediaLinks } from '../src/media-link.mjs';
import { createApp } from '../src/server.mjs';
import { pickStory, runStory } from '../src/story.mjs';

const jpg = { id: 'jpg1', name: 'Photo.JPG', mimeType: 'image/jpeg', size: '200' };
const video = { id: 'vid_2', name: 'Clip.mp4', mimeType: 'video/mp4', size: '4' };
const invalid = { id: 'png3', name: 'Other.png', mimeType: 'image/png', size: '10' };
const links = createMediaLinks('test-example-secret-for-stories-only');

test('random selection considers only nonempty matching JPG and MP4 files', () => {
  const files = [jpg, invalid, video, { ...jpg, size: '0' }, { ...jpg, mimeType: 'text/html' }];
  const picked = pickStory(files, count => {
    assert.equal(count, 2);
    return 1;
  });
  assert.equal(picked.id, video.id);
  assert.equal(pickStory([invalid]), undefined);
});

test('dry run previews a selection without creating a URL or making Instagram calls', async () => {
  const output = [];
  await runStory({
    drive: { list: async () => [jpg] }, folderId: 'inbox', live: false,
    log: line => output.push(line),
  });
  assert.deepEqual(output, ['Dry run. Selected Story: "Photo.JPG"']);
});

test('an explicit Drive ID selects only that eligible file and never falls back', async () => {
  const output = [];
  const options = { drive: { list: async () => [jpg, video, invalid] }, folderId: 'inbox',
    live: false, log: line => output.push(line) };
  await runStory({ ...options, fileId: video.id });
  assert.deepEqual(output, ['Dry run. Selected Story: "Clip.mp4"']);
  for (const fileId of ['missing', invalid.id]) {
    await assert.rejects(runStory({ ...options, fileId }), /missing from the Story folder or is ineligible/);
  }
});

test('account verification checks the username and ID on the configured Graph API account', async t => {
  let account = { id: '100', username: 'SalonMurahJakarta' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://graph.facebook.com/v27.0/100?fields=id,username');
    assert.equal(options.method, 'GET');
    return Response.json(account);
  });
  const instagram = createInstagram({ IG_USER_ID: '100', IG_ACCESS_TOKEN: 'mock-token' });
  await instagram.verifyAccount('salonmurahjakarta');
  account = { ...account, username: 'localsolution.id' };
  await assert.rejects(instagram.verifyAccount('salonmurahjakarta'), /verification failed/);
  account = { id: '101', username: 'salonmurahjakarta' };
  await assert.rejects(instagram.verifyAccount('salonmurahjakarta'), /verification failed/);
});

test('live run verifies its URL, prepares one Story and publishes one container', async () => {
  const calls = [];
  await runStory({
    drive: { list: async () => [video] }, folderId: 'inbox', live: true,
    getMediaUrl: file => links.url('https://relay.example', file),
    verifyMediaUrl: async url => calls.push(['verify', new URL(url).pathname]),
    instagram: {
      async prepare(type, extension, url) {
        calls.push([type, extension, new URL(url).pathname]);
        return '100';
      },
      async publish(id) {
        calls.push(['publish', id]);
        return '200';
      },
    },
    log() {},
  });
  assert.deepEqual(calls, [
    ['verify', '/media/vid_2.mp4'], ['story', '.mp4', '/media/vid_2.mp4'], ['publish', '100'],
  ]);
});

test('signed links reject tampered media metadata and expire after 15 minutes', () => {
  const now = Date.UTC(2026, 10, 25);
  const url = new URL(links.url('https://relay.example', { ...video, format: 'mp4' }, now));
  const query = Object.fromEntries(url.searchParams);
  assert(links.verify(video.id, 'mp4', query, now));
  assert(!links.verify(video.id, 'mp4', { ...query, size: '500' }, now));
  assert(!links.verify(jpg.id, 'mp4', query, now));
  assert(!links.verify(video.id, 'mp4', query, now + 900_000));
});

test('Express serves signed media and byte ranges while denying unsigned access', async t => {
  const downloads = [];
  const app = createApp({
    async download(id, { range }) {
      downloads.push([id, range]);
      return new Response(range ? 'bc' : 'abcd', {
        status: range ? 206 : 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': range ? '2' : '4',
          ...(range ? { 'Content-Range': 'bytes 1-2/4' } : {}),
        },
      });
    },
  }, links);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const root = 'http://127.0.0.1:' + server.address().port;
  const signed = new URL(links.url('https://relay.example', { ...video, format: 'mp4' }));
  const url = root + signed.pathname + signed.search;
  assert.equal((await fetch(root + signed.pathname)).status, 403);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '4');
  assert.deepEqual(downloads, []);
  const whole = await fetch(url);
  assert.equal(await whole.text(), 'abcd');
  const partial = await fetch(url, { headers: { Range: 'bytes=1-2' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 1-2/4');
  assert.equal(await partial.text(), 'bc');
  assert.deepEqual(downloads, [[video.id, undefined], [video.id, 'bytes=1-2']]);
});
