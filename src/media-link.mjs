import { createHmac, timingSafeEqual } from 'node:crypto';
import { driveId } from './drive.mjs';

export const contentTypes = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp4: 'video/mp4',
});

export function createMediaLinks(key) {
  if (!key || Buffer.byteLength(key) < 32) {
    throw new Error('Set MEDIA_SIGNING_KEY to a random secret of at least 32 bytes.');
  }

  function signature(id, format, size, expires) {
    return createHmac('sha256', key)
      .update([id, format, size, expires].join(':'))
      .digest('hex');
  }

  return {
    url(baseUrl, file, now = Date.now()) {
      const url = new URL('/media/' + file.id + '.' + file.format, baseUrl);
      if (url.protocol !== 'https:') throw new Error('MEDIA_BASE_URL must use HTTPS.');
      const expires = String(Math.floor(now / 1000) + 900);
      url.searchParams.set('size', file.size);
      url.searchParams.set('expires', expires);
      url.searchParams.set('sig', signature(file.id, file.format, file.size, expires));
      return url.href;
    },

    verify(id, format, { size, expires, sig }, now = Date.now()) {
      if (!driveId.test(id) || !Object.hasOwn(contentTypes, format) ||
          typeof size !== 'string' || !/^[1-9][0-9]{0,14}$/.test(size) ||
          typeof expires !== 'string' || !/^\d{10,11}$/.test(expires) ||
          Number(expires) <= Math.floor(now / 1000) ||
          typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) return false;
      return timingSafeEqual(Buffer.from(sig, 'hex'),
        Buffer.from(signature(id, format, size, expires), 'hex'));
    },
  };
}
