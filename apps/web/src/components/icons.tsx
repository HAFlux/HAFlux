import type { SVGProps } from 'react';

export type IconSvgProps = SVGProps<SVGSVGElement> & { size?: number };

export const Logo = ({ size = 28, ...rest }: IconSvgProps) => (
  <svg
    fill="none"
    height={size}
    viewBox="0 0 32 32"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
    {...rest}
  >
    <title>HAFlux</title>
    {/* Внешняя hairline-рамка (наследует currentColor — видна на любой теме) */}
    <rect
      x="1.25"
      y="1.25"
      width="29.5"
      height="29.5"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    {/* Угловые засечки в духе terminal */}
    <path
      d="M3 3h2M3 3v2M27 3h2M29 3v2M3 29h2M3 29v-2M27 29h2M29 29v-2"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="square"
    />
    {/* Буква H — две вертикальные стойки + перекладина */}
    <path
      d="M10.5 9v14M21.5 9v14M10.5 16h11"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  </svg>
);

export const SunFilledIcon = ({ size = 22, ...rest }: IconSvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...rest}>
    <title>Light theme</title>
    <path d="M19 12a7 7 0 11-14 0 7 7 0 0114 0z" />
    <path
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
    />
  </svg>
);

export const MoonFilledIcon = ({ size = 22, ...rest }: IconSvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...rest}>
    <title>Dark theme</title>
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);

export const GithubIcon = ({ size = 22, ...rest }: IconSvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" {...rest}>
    <title>GitHub</title>
    <path d="M12 .5C5.73.5.5 5.73.5 12.05c0 5.1 3.29 9.43 7.86 10.96.58.1.79-.25.79-.55v-2.06c-3.2.69-3.87-1.36-3.87-1.36-.52-1.34-1.27-1.7-1.27-1.7-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.74 2.68 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.17a11.04 11.04 0 015.74 0c2.2-1.48 3.16-1.17 3.16-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.7 5.36-5.27 5.65.41.36.78 1.07.78 2.16v3.2c0 .31.21.66.8.55a10.99 10.99 0 007.85-10.96C23.5 5.73 18.27.5 12 .5z" />
  </svg>
);
