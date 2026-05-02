/**
 * Проверка покрывает ли SAN запись данный домен.
 *  - Точное совпадение
 *  - wildcard *.example.com покрывает один уровень: app.example.com,
 *    но НЕ a.b.example.com (RFC 6125)
 */
export function sanMatches(san: string, domain: string): boolean {
  const d = domain.trim().toLowerCase();
  const s = san.trim().toLowerCase();
  if (!d || !s) return false;
  if (s === d) return true;
  // оба wildcard — должны быть равны
  if (s.startsWith('*.') && d.startsWith('*.')) return s === d;
  if (s.startsWith('*.')) {
    const base = s.slice(2);
    const parts = d.split('.');
    if (parts.length < 2) return false;
    return parts.slice(1).join('.') === base;
  }
  return false;
}

/** Покрывает ли сертификат указанный домен (по CN или любому SAN). */
export function certCovers(
  cert: { commonName: string; sans: string[] },
  domain: string,
): boolean {
  return sanMatches(cert.commonName, domain) || cert.sans.some((s) => sanMatches(s, domain));
}
