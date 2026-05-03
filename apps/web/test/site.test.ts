import { describe, expect, it } from 'vitest';
import { siteConfig } from '../src/config/site';

describe('siteConfig', () => {
  it('exposes the HAFlux brand', () => {
    expect(siteConfig.name).toBe('HAFlux');
    expect(siteConfig.fullName).toBe('HAFlux');
  });

  it('points to the haflux GitHub org', () => {
    expect(siteConfig.links.github).toContain('github.com/haflux/');
    expect(siteConfig.links.docs).toContain('github.com/haflux/');
  });

  it('declares non-empty navigation', () => {
    expect(siteConfig.navItems.length).toBeGreaterThan(0);
    for (const item of siteConfig.navItems) {
      expect(item.label).toBeTruthy();
      expect(item.href.startsWith('/')).toBe(true);
    }
  });
});
