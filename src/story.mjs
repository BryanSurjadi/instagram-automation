import { randomInt } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDrive, driveId, readServiceAccount } from './drive.mjs';
import { createInstagram } from './instagram.mjs';
import { contentTypes, createMediaLinks } from './media-link.mjs';

export function pickStory(files, chooseIndex = randomInt) {
  const eligible = files.flatMap(file => {
    const format = extname(file.name ?? '').slice(1).toLowerCase();
    if (!driveId.test(file.id ?? '') || !Object.hasOwn(contentTypes, format) ||
        file.mimeType !== contentTypes[format] || !/^[1-9][0-9]{0,14}$/.test(file.size)) {
      return [];
    }
    return [{ ...file, size: String(file.size), format }];
  });
  return eligible.length ? eligible[chooseIndex(eligible.length)] : undefined;
}

export async function runStory({ drive, folderId, fileId, live, getMediaUrl, instagram,
  verifyMediaUrl, chooseIndex, log = console.log }) {
  const files = await drive.list(folderId);
  const file = pickStory(fileId ? files.filter(candidate => candidate.id === fileId) : files, chooseIndex);
  if (!file) {
    if (fileId) throw new Error('The requested Drive file is missing from the Story folder or is ineligible.');
    log('No eligible files in the Story folder.');
    return;
  }

  log((live ? 'Selected Story: ' : 'Dry run. Selected Story: ') + JSON.stringify(file.name));
  if (!live) return;

  const url = getMediaUrl(file);
  await verifyMediaUrl(url);
  const container = await instagram.prepare('story', '.' + file.format, url);
  try {
    const mediaId = await instagram.publish(container);
    log('Published Instagram Story ' + mediaId + '.');
  } catch (error) {
    throw new Error(error.message + ' Check Instagram container ' +
      container + ' before attempting another live run.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { values: { live, 'file-id': fileId, 'verify-account': verifyAccount } } = parseArgs({
      options: { live: { type: 'boolean' }, 'file-id': { type: 'string' }, 'verify-account': { type: 'boolean' } },
    });
    if (fileId !== undefined && !driveId.test(fileId)) throw new Error('Use --file-id with a valid Drive file ID.');
    if (verifyAccount && (live || fileId)) throw new Error('Run --verify-account on its own.');
    if (live && process.env.IG_ALLOW_LIVE !== 'true') {
      throw new Error('Set IG_ALLOW_LIVE=true before running live.');
    }
    if (live && process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT !== '1') {
      throw new Error('Live publishing is disabled for workflow reruns. Check the original run.');
    }
    const instagram = live || verifyAccount ? createInstagram(process.env) : undefined;
    if (instagram) {
      const username = process.env.IG_EXPECTED_USERNAME;
      if (!/^[A-Za-z0-9._]{1,30}$/.test(username ?? '')) {
        throw new Error('Set IG_EXPECTED_USERNAME to the intended account username without @.');
      }
      await instagram.verifyAccount(username);
      console.log('Verified Instagram account @' + username + '.');
    }
    if (!verifyAccount) await runFromEnvironment({ fileId, live, instagram });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

async function runFromEnvironment({ fileId, live, instagram }) {
  const drive = createDrive(readServiceAccount(process.env));
  const links = live ? createMediaLinks(process.env.MEDIA_SIGNING_KEY) : undefined;
  await runStory({
    drive,
    folderId: process.env.DRIVE_STORIES_FOLDER_ID,
    fileId,
    live,
    getMediaUrl: file => links.url(process.env.MEDIA_BASE_URL, file),
    instagram,
    async verifyMediaUrl(url) {
      let response;
      try {
        response = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(90_000) });
      } catch (error) {
        const host = new URL(url).hostname;
        const reason = error.cause?.code ?? error.name;
        throw new Error('Could not reach the media relay at ' + host + ' (' + reason +
          '). Check that MEDIA_BASE_URL matches the active tunnel and that /health returns OK.');
      }
      await response.body?.cancel();
      if (response.status !== 206 || !/^bytes 0-0\/[1-9]\d*$/.test(response.headers.get('content-range') ?? '')) {
        throw new Error('Express media relay did not serve the requested byte range (HTTP ' + response.status + ').');
      }
    },
  });
}
