import { describe, expect, it } from 'vitest';
import { __LOG_REGEX_FOR_TESTS } from '../src/proxy-hosts/logs.service';

describe('LOG_REGEX', () => {
  const re = __LOG_REGEX_FOR_TESTS;

  it('parses httplog with captured User-Agent block (default renderer output)', () => {
    const line =
      '<134>May  5 11:18:39 haproxy[99]: 127.0.0.1:58732 [05/May/2026:11:18:39.942] fe_https~ be_proxy_cmor6y6l9000dk501o0c3hqm9/upstream 0/0/1/8/9 200 257 - - ---- 6/1/0/0/0 0/0 {curl/8.5.0} "GET https://demo-account-api.bmd.su/ HTTP/2.0"';
    const m = re.exec(line);
    if (!m?.groups) throw new Error('regex did not match');
    expect(m.groups.clientIp).toBe('127.0.0.1');
    expect(m.groups.frontend).toBe('fe_https~');
    expect(m.groups.backend).toBe('be_proxy_cmor6y6l9000dk501o0c3hqm9');
    expect(m.groups.server).toBe('upstream');
    expect(m.groups.status).toBe('200');
    expect(m.groups.method).toBe('GET');
    expect(m.groups.url).toBe('https://demo-account-api.bmd.su/');
    expect(m.groups.capturedReq).toBe('curl/8.5.0');
  });

  it('parses NOSRV / 503 entry (no upstream picked)', () => {
    const line =
      '<134>May  5 09:33:18 haproxy[99]: 147.45.199.165:51418 [05/May/2026:09:33:18.836] fe_https~ be_proxy_cmoscxn8d0003lg0112av39gp/<NOSRV> 0/-1/-1/-1/0 503 1563 - - SC-- 3/2/0/0/0 0/0 {Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36} "GET https://demo-account.bmd.su/ HTTP/2.0"';
    const m = re.exec(line);
    if (!m?.groups) throw new Error('regex did not match');
    expect(m.groups.backend).toBe('be_proxy_cmoscxn8d0003lg0112av39gp');
    expect(m.groups.server).toBe('<NOSRV>');
    expect(m.groups.status).toBe('503');
    expect(m.groups.termState).toBe('SC--');
    expect(m.groups.capturedReq?.startsWith('Mozilla/5.0')).toBe(true);
  });

  it('still parses httplog without any capture-block', () => {
    const line =
      '127.0.0.1:50000 [05/May/2026:08:00:00.000] fe_http be_panel/api 0/0/0/2/2 200 100 - - ---- 1/1/0/0/0 0/0 "GET / HTTP/1.1"';
    const m = re.exec(line);
    if (!m?.groups) throw new Error('regex did not match');
    expect(m.groups.backend).toBe('be_panel');
    expect(m.groups.method).toBe('GET');
  });
});
