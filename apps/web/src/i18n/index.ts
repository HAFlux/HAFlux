import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ru from './ru.json';

/**
 * Простая i18n конфигурация:
 *  - fallback EN
 *  - автодетект из navigator.language (Browser detector)
 *  - сохранение выбора в localStorage (key: 'haflux:lang')
 *  - переключатель в шапке вызывает i18n.changeLanguage('en'|'ru')
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ru'],
    nonExplicitSupportedLngs: true, // ru-RU → ru
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'haflux:lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
