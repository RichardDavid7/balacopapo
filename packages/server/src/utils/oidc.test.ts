import { describe, it, expect } from 'vitest';
import {
  consumeAdminOidcLinkToken,
  consumeOidcAuthState,
  consumeOidcLoginTicket,
  createAdminOidcLinkToken,
  createOidcAuthState,
  createOidcLoginTicket,
  extractOidcGroups,
  matchesAdminGroups,
  normalizeIssuer,
  sanitizeOidcUsername,
} from './oidc.js';

describe('OIDC helpers', () => {
  it('normalizes issuer trailing slashes', () => {
    expect(normalizeIssuer('https://auth.example.com/application/o/balacopapo///')).toBe(
      'https://auth.example.com/application/o/balacopapo',
    );
  });

  it('extracts groups from primary claim, arrays, strings, and roles fallback', () => {
    expect(extractOidcGroups({ groups: ['Admins', 'Users'] }, 'groups')).toEqual(['Admins', 'Users']);
    expect(extractOidcGroups({ custom_groups: 'admins, moderators', roles: ['staff'] }, 'custom_groups')).toEqual([
      'admins',
      'moderators',
      'staff',
    ]);
  });

  it('matches admin groups case-insensitively', () => {
    expect(matchesAdminGroups(['Users', 'Balacopapo-Admins'], ['balacopapo-admins'])).toBe(true);
    expect(matchesAdminGroups(['Users'], ['balacopapo-admins'])).toBe(false);
    expect(matchesAdminGroups(['Admins'], [])).toBe(false);
  });

  it('sanitizes OIDC usernames into valid local handles', () => {
    expect(sanitizeOidcUsername('Richard.David!')).toBe('richard_david');
    expect(sanitizeOidcUsername('a')).toBe('user_a');
    expect(sanitizeOidcUsername('   ')).toBe('user_oidc');
  });

  it('consumes auth state, admin link tokens, and login tickets once', () => {
    const { state, nonce, codeChallenge } = createOidcAuthState({ redirect: '/channels/@me', client: 'web' });
    expect(codeChallenge.length).toBeGreaterThan(20);
    const consumed = consumeOidcAuthState(state);
    expect(consumed?.nonce).toBe(nonce);
    expect(consumeOidcAuthState(state)).toBeNull();

    const { token } = createAdminOidcLinkToken('user-123');
    expect(consumeAdminOidcLinkToken(token)).toBe('user-123');
    expect(consumeAdminOidcLinkToken(token)).toBeNull();

    const ticket = createOidcLoginTicket('user-456');
    expect(consumeOidcLoginTicket(ticket)).toBe('user-456');
    expect(consumeOidcLoginTicket(ticket)).toBeNull();
  });
});
