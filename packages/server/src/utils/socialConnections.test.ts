import { describe, it, expect } from 'vitest';
import { validateSocialConnection } from '@backspace/shared';

describe('validateSocialConnection', () => {
  it('accepts valid Steam profile URLs and extracts profile name', () => {
    const res = validateSocialConnection('steam', 'https://steamcommunity.com/id/rpd7/');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.connection.url).toBe('https://steamcommunity.com/id/rpd7/');
      expect(res.connection.displayLabel).toBe('rpd7');
    }
  });

  it('blocks Steam linkfilter redirect URLs', () => {
    const res = validateSocialConnection(
      'steam',
      'https://steamcommunity.com/linkfilter/?u=http%3A%2F%2Fvk.com%2Ftopic-50589186_28225534',
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('redirect_blocked');
  });

  it('blocks Facebook/YouTube/Instagram redirectors and wrong domains', () => {
    expect(validateSocialConnection('facebook', 'https://facebook.com/l.php?u=https://evil.test').ok).toBe(false);
    expect(validateSocialConnection('youtube', 'https://youtube.com/redirect?q=https://evil.test').ok).toBe(false);
    expect(validateSocialConnection('instagram', 'https://l.instagram.com/?u=https://evil.test').ok).toBe(false);
    expect(validateSocialConnection('steam', 'https://evil.com/id/rpd7').ok).toBe(false);
  });

  it('accepts custom websites showing the exact clean URL', () => {
    const res = validateSocialConnection('website', 'https://meu-site.dev/sobre');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.connection.url).toBe('https://meu-site.dev/sobre');
      expect(res.connection.displayLabel).toBe('meu-site.dev/sobre');
    }
    expect(validateSocialConnection('website', 'javascript:alert(1)').ok).toBe(false);
  });
});
