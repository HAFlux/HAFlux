export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: 'HAFlux',
  fullName: 'HAFlux',
  description: 'HAFlux — visual control plane for HAProxy.',
  navItems: [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Proxy hosts', href: '/proxy-hosts' },
    { label: 'Clusters', href: '/clusters' },
    { label: 'Certificates', href: '/certificates' },
    { label: 'Error pages', href: '/error-pages' },
    { label: 'Access groups', href: '/access-groups' },
    { label: 'Backup', href: '/backup' },
    { label: 'Help', href: '/help' },
    { label: 'Profile', href: '/profile' },
  ],
  links: {
    github: 'https://github.com/haproxy-panel/waf',
    docs: 'https://github.com/haproxy-panel/waf/blob/main/docs/SPEC.md',
  },
};
