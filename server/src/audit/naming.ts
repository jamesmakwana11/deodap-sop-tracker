import type { CheckResult, ObjectiveLabel } from '@sop/shared';

/**
 * Naming rule: the campaign name carries the objective, the creative format and a date.
 * Separators are not enforced ("3038 | NN | Carousel | Sales | 01.01.2026" and
 * "Sales_Video_05-10-26" both pass).
 */

export const OBJECTIVE_WORDS: Record<Exclude<ObjectiveLabel, 'Other'>, string[]> = {
  Sales: ['sales', 'sale', 'purchase', 'purchases', 'conversion', 'conversions'],
  Traffic: ['traffic', 'lpv', 'landing page views', 'link clicks'],
  Awareness: ['awareness', 'reach', 'brand awareness'],
  Engagement: ['engagement', 'eng', 'post engagement'],
  'App Promotion': ['app promotion', 'app install', 'app installs', 'installs', 'app'],
  Leads: ['leads', 'lead', 'lead gen', 'leadgen'],
};

export const FORMAT_WORDS = [
  'carousel', 'video', 'videos', 'reel', 'reels', 'image', 'images', 'single image', 'static', 'photo',
  'catalog', 'catalogue', 'dpa', 'collection', 'story', 'stories', 'gif', 'ugc', 'slideshow',
  'instant experience', 'flexible', 'mixed', 'banner',
];

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s_-]*');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text);
}

const validDay = (d: number) => d >= 1 && d <= 31;
const validMonth = (m: number) => m >= 1 && m <= 12;

export function containsDate(name: string): boolean {
  const text = name.toLowerCase();
  // dd.mm.yyyy, dd/mm/yy, dd-mm-yyyy, dd_mm_yyyy
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./\-_](\d{1,2})[./\-_](\d{4}|\d{2})(?!\d)/g)) {
    if (validDay(Number(m[1])) && validMonth(Number(m[2]))) return true;
  }
  // yyyy-mm-dd
  for (const m of text.matchAll(/(?<!\d)(20\d{2})[./\-_](\d{1,2})[./\-_](\d{1,2})(?!\d)/g)) {
    if (validMonth(Number(m[2])) && validDay(Number(m[3]))) return true;
  }
  // 26 Oct, 26 October 2026, 26Oct, Oct 26, October 26th
  if (new RegExp(`(?<!\\d)(\\d{1,2})(st|nd|rd|th)?[\\s.\\-_]*(${MONTHS})(?![a-z])`, 'i').test(text)) return true;
  if (new RegExp(`(?<![a-z])(${MONTHS})[\\s.\\-_]*(\\d{1,2})(st|nd|rd|th)?(?!\\d)`, 'i').test(text)) return true;
  return false;
}

export function checkNaming(name: string, objective: ObjectiveLabel): CheckResult {
  if (objective === 'Other') {
    return { key: 'naming', outcome: 'NOT_CHECKABLE', detail: 'Objective is not one the SOP defines, so its name word is unknown' };
  }
  const missing: string[] = [];
  if (!OBJECTIVE_WORDS[objective].some((w) => hasWord(name, w))) missing.push(`the objective (${objective})`);
  if (!FORMAT_WORDS.some((w) => hasWord(name, w))) missing.push('the creative format');
  if (!containsDate(name)) missing.push('a date');

  if (missing.length === 0) return { key: 'naming', outcome: 'PASS', detail: null };
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
  return { key: 'naming', outcome: 'FAIL', detail: `Name is missing ${list}` };
}
