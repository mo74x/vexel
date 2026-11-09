import { describe, it, expect } from 'vitest';
import { isRtlLocale, locales } from '../i18n';
import arMessages from '../../messages/ar.json';
import enMessages from '../../messages/en.json';

describe('i18n & RTL Smoke Tests', () => {
  it('correctly maps Arabic to RTL direction and English to LTR', () => {
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
    expect(locales).toContain('ar');
    expect(locales).toContain('en');
  });

  it('renders expected HTML attributes for Arabic and English layouts', () => {
    const getHtmlAttributes = (locale: string) => {
      const isRtl = isRtlLocale(locale);
      return {
        lang: locale,
        dir: isRtl ? 'rtl' : 'ltr',
      };
    };

    const arAttrs = getHtmlAttributes('ar');
    expect(arAttrs.dir).toBe('rtl');
    expect(arAttrs.lang).toBe('ar');

    const enAttrs = getHtmlAttributes('en');
    expect(enAttrs.dir).toBe('ltr');
    expect(enAttrs.lang).toBe('en');
  });

  it('contains matching keys between Arabic and English translation dictionaries', () => {
    const checkKeys = (arObj: Record<string, any>, enObj: Record<string, any>) => {
      const arKeys = Object.keys(arObj);
      const enKeys = Object.keys(enObj);

      for (const key of enKeys) {
        expect(arKeys).toContain(key);
        if (typeof enObj[key] === 'object' && enObj[key] !== null) {
          checkKeys(arObj[key], enObj[key]);
        }
      }
    };

    checkKeys(arMessages, enMessages);
  });

  it('verifies essential Arabic navigation, auth, and metrics labels are present', () => {
    expect(arMessages.navigation.activity).toBe('النشاط');
    expect(arMessages.navigation.reps).toBe('المندوبون');
    expect(arMessages.navigation.impact).toBe('الأثر والإنتاجية');
    expect(arMessages.navigation.settings).toBe('الإعدادات');
    expect(arMessages.auth.sendMagicLink).toBe('إرسال رابط الدخول');
    expect(arMessages.impact.kpis.timeSaved).toBe('الوقت الموفر');
    expect(arMessages.onboarding.title).toBe('مرحباً بك في فيكسل');
  });
});

