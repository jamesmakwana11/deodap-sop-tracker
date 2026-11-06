import { SOP_RULES } from './sopRules.js';
import type {
  CampaignAudit,
  DashboardSummary,
  DashboardTotals,
  GroupSummaryRow,
  RuleFailureRow,
} from './types.js';
import { OBJECTIVES } from './types.js';

function emptyRow(key: string, label: string): GroupSummaryRow {
  return { key, label, campaigns: 0, good: 0, average: 0, bad: 0, notRated: 0, following: 0, avgSopPercent: null };
}

function groupBy(
  campaigns: readonly CampaignAudit[],
  keyOf: (c: CampaignAudit) => { key: string; label: string },
): GroupSummaryRow[] {
  const rows = new Map<string, GroupSummaryRow & { _sum: number; _n: number }>();
  for (const c of campaigns) {
    const { key, label } = keyOf(c);
    let row = rows.get(key);
    if (!row) {
      row = { ...emptyRow(key, label), _sum: 0, _n: 0 };
      rows.set(key, row);
    }
    row.campaigns++;
    if (c.rating === 'GOOD') row.good++;
    else if (c.rating === 'AVERAGE') row.average++;
    else if (c.rating === 'BAD') row.bad++;
    else row.notRated++;
    if (c.compliance.status === 'FOLLOWING') row.following++;
    if (c.compliance.percent !== null) {
      row._sum += c.compliance.percent;
      row._n++;
    }
  }
  return [...rows.values()].map(({ _sum, _n, ...row }) => ({
    ...row,
    avgSopPercent: _n === 0 ? null : Math.round(_sum / _n),
  }));
}

export function computeTotals(campaigns: readonly CampaignAudit[]): DashboardTotals {
  const t: DashboardTotals = {
    active: campaigns.length,
    good: 0,
    average: 0,
    bad: 0,
    notRated: 0,
    following: 0,
    partlyFollowing: 0,
    notFollowing: 0,
    needsReview: 0,
  };
  for (const c of campaigns) {
    if (c.rating === 'GOOD') t.good++;
    else if (c.rating === 'AVERAGE') t.average++;
    else if (c.rating === 'BAD') t.bad++;
    else t.notRated++;

    if (c.compliance.status === 'FOLLOWING') t.following++;
    else if (c.compliance.status === 'PARTLY_FOLLOWING') t.partlyFollowing++;
    else if (c.compliance.status === 'NOT_FOLLOWING') t.notFollowing++;
    else t.needsReview++;
  }
  return t;
}

export function computeRuleFailures(campaigns: readonly CampaignAudit[]): RuleFailureRow[] {
  const rows: RuleFailureRow[] = SOP_RULES.map((r) => {
    let pass = 0;
    let fail = 0;
    let notCheckable = 0;
    let notApplicable = 0;
    for (const c of campaigns) {
      const check = c.checks.find((x) => x.key === r.key);
      // A missing result means the check has not run — treat as not checkable, never as a pass.
      const outcome = check?.outcome ?? 'NOT_CHECKABLE';
      if (outcome === 'PASS') pass++;
      else if (outcome === 'FAIL') fail++;
      else if (outcome === 'NOT_CHECKABLE') notCheckable++;
      else notApplicable++;
    }
    const evaluated = pass + fail;
    return {
      key: r.key,
      label: r.label,
      rule: r.rule,
      pass,
      fail,
      notCheckable,
      notApplicable,
      failRate: evaluated === 0 ? null : fail / evaluated,
    };
  });
  // Most frequently failed first; rules with nothing evaluable sink to the bottom.
  return rows.sort((a, b) => (b.failRate ?? -1) - (a.failRate ?? -1) || b.fail - a.fail);
}

export function buildDashboardSummary(campaigns: readonly CampaignAudit[]): DashboardSummary {
  const byAccount = groupBy(campaigns, (c) => ({ key: c.account.id, label: c.account.name })).sort(
    (a, b) => b.campaigns - a.campaigns || a.label.localeCompare(b.label),
  );

  const objectiveOrder: string[] = [...OBJECTIVES, 'Other'];
  const byObjective = groupBy(campaigns, (c) => ({ key: c.objective, label: c.objective })).sort(
    (a, b) => b.campaigns - a.campaigns || objectiveOrder.indexOf(a.key) - objectiveOrder.indexOf(b.key),
  );

  return {
    totals: computeTotals(campaigns),
    byAccount,
    byObjective,
    ruleFailures: computeRuleFailures(campaigns),
  };
}
