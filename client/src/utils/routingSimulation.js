export function getServerConditionSummary(simulation) {
  return simulation?.matchedRule?.conditionSummary ?? '';
}
