import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const driveApi = 'https://www.googleapis.com/drive/v3/';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const readOnlyScope = 'https://www.googleapis.com/auth/drive.readonly';
export const driveId = /^[A-Za-z0-9_-]+$/;

export function readServiceAccount(env) {
  try {
    const account = JSON.parse(env.DRIVE_SERVICE_ACCOUNT_JSON);
    if (account.type === 'service_account' && account.client_email && account.private_key) {
      return account;
    }
  } catch {
    // Report the setting name without logging credentials.
  }
  throw new Error('Set DRIVE_SERVICE_ACCOUNT_JSON to the Google service account key JSON.');
}

export function createDrive(account) {
  const { SignJWT, importPKCS8 } = require('jose');
  const signer = importPKCS8(account.private_key, 'RS256');

  let cachedToken;
  let tokenExpires = 0;
  let refreshing;

  async function refresh() {
    const assertion = await new SignJWT({ scope: readOnlyScope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id })
      .setIssuer(account.client_email)
      .setAudience(tokenUrl)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(await signer);
    const response = await fetch(tokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Google token exchange returned HTTP ' + response.status + '.');
    const result = await response.json();
    if (!result.access_token) throw new Error('Google token exchange returned no access token.');
    cachedToken = result.access_token;
    tokenExpires = Date.now() + Number(result.expires_in || 3600) * 1000;
    return cachedToken;
  }

  async function accessToken() {
    if (Date.now() + 60_000 < tokenExpires) return cachedToken;
    refreshing ??= refresh().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  async function request(path, params, { range, signal } = {}) {
    const url = new URL(path, driveApi);
    url.search = new URLSearchParams(params);
    const headers = {
      Authorization: 'Bearer ' + await accessToken(),
      'Accept-Encoding': 'identity',
    };
    if (range) headers.Range = range;
    return fetch(url, { headers, signal: signal ?? AbortSignal.timeout(30_000) });
  }

  return {
    async list(folderId) {
      if (!driveId.test(folderId ?? '')) throw new Error('Set DRIVE_STORIES_FOLDER_ID to the folder ID.');
      const files = [];
      let pageToken;
      do {
        const params = {
          q: "'" + folderId + "' in parents and trashed = false",
          fields: 'nextPageToken,files(id,name,mimeType,size)',
          pageSize: '100',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        };
        if (pageToken) params.pageToken = pageToken;
        const response = await request('files', params);
        if (!response.ok) {
          throw new Error('Drive list returned HTTP ' + response.status + '. Check folder sharing.');
        }
        const page = await response.json();
        files.push(...(page.files ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return files;
    },

    download(id, options) {
      return request('files/' + encodeURIComponent(id), {
        alt: 'media',
        supportsAllDrives: 'true',
      }, options);
    },
  };
}
