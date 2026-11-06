import { RATING_LABEL, SOP_STATUS_LABEL, type Rating, type SopStatus } from '@sop/shared';

export interface Tone {
  label: string;
  text: string;
  bg: string;
}

export const RATING_TONE: Record<Rating, Tone> = {
  GOOD: { label: RATING_LABEL.GOOD, text: 'text-good', bg: 'bg-good-bg' },
  AVERAGE: { label: RATING_LABEL.AVERAGE, text: 'text-avg', bg: 'bg-avg-bg' },
  BAD: { label: RATING_LABEL.BAD, text: 'text-bad', bg: 'bg-bad-bg' },
  NOT_RATED: { label: RATING_LABEL.NOT_RATED, text: 'text-neutral', bg: 'bg-slate-100' },
};

export const SOP_STATUS_TONE: Record<SopStatus, Tone> = {
  FOLLOWING: { label: SOP_STATUS_LABEL.FOLLOWING, text: 'text-good', bg: 'bg-good-bg' },
  PARTLY_FOLLOWING: { label: SOP_STATUS_LABEL.PARTLY_FOLLOWING, text: 'text-avg', bg: 'bg-avg-bg' },
  NOT_FOLLOWING: { label: SOP_STATUS_LABEL.NOT_FOLLOWING, text: 'text-bad', bg: 'bg-bad-bg' },
  NEEDS_REVIEW: { label: SOP_STATUS_LABEL.NEEDS_REVIEW, text: 'text-neutral', bg: 'bg-slate-100' },
};
