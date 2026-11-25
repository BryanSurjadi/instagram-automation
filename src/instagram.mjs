import { setTimeout as sleep } from 'node:timers/promises';

export function createInstagram(env) {
  const version = env.IG_API_VERSION || 'v27.0';
  const { IG_USER_ID: user, IG_ACCESS_TOKEN: token } = env;
  if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(user ?? '') || !token) {
    throw new Error('Set IG_USER_ID and IG_ACCESS_TOKEN and check IG_API_VERSION.');
  }

  async function request(path, body) {
    let response;
    try {
      response = await fetch('https://graph.facebook.com/' + version + '/' + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer ' + token },
        body: body && new URLSearchParams(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('Instagram API request failed or timed out.');
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.error) {
      const code = Number.isInteger(result?.error?.code) ? ', API code ' + result.error.code : '';
      throw new Error('Instagram API returned HTTP ' + response.status + code + '.');
    }
    return result;
  }

  async function sendForId(path, body) {
    const { id } = await request(path, body);
    if (typeof id !== 'string' || !/^\d+$/.test(id)) {
      throw new Error('Instagram API returned no usable ID.');
    }
    return id;
  }

  return {
    async verifyAccount(expectedUsername) {
      const { id, username } = await request(user + '?fields=id,username');
      if (id !== user || typeof username !== 'string' || username.toLowerCase() !== expectedUsername.toLowerCase()) {
        throw new Error('Instagram account verification failed for @' + expectedUsername + '.');
      }
    },
    async prepare(type, extension, url, caption) {
      const body = {
        media_type: type === 'story' ? 'STORIES' : 'REELS',
        [extension === '.mp4' ? 'video_url' : 'image_url']: url,
      };
      if (type === 'reel' && caption) body.caption = caption;

      const container = await sendForId(user + '/media', body);
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await sleep(60_000);
        const { status_code: status } = await request(container + '?fields=status_code');
        if (status === 'FINISHED') return container;
        if (status !== 'IN_PROGRESS') {
          throw new Error('Instagram could not prepare media container ' + container + '.');
        }
      }
      throw new Error('Instagram did not finish preparing media container ' + container + '.');
    },
    publish(container) {
      return sendForId(user + '/media_publish', { creation_id: container });
    },
  };
}
