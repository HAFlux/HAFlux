// Версия SPA — берётся из build-arg APP_VERSION (release.yml пропускает
// сюда git tag вроде "v0.1.0"). В dev / при локальной сборке без аргумента
// откатываемся на version из package.json.
import pkg from '../package.json';

const fromEnv = (import.meta.env.VITE_APP_VERSION ?? '').trim();
const cleaned = fromEnv.replace(/^v/, '');

export const APP_VERSION = cleaned || pkg.version;
