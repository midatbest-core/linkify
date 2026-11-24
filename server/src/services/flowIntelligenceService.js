import { compileFlowToAdaptiveRouting } from './flowCompiler.js';
import { resolveAdaptiveDestination } from './adaptiveRoutingService.js';
import { buildLinkAnalyticsPipeline, formatLinkAnalytics, runAggregate } from './analyticsService.js';
import { resolveLocalDateTime, utcDateTimeToLocal } from '../utils/schedule.js';
import { parseDateRange } from '../utils/dateRange.js';
import { serializeFlow } from './flowService.js';
import { normalizePublicationSnapshot, normalizeFlowDoc } from '../utils/flowNormalization.js';

function toId(value) {
  if (!value) return null;
  if (value?.buffer && value.buffer instanceof Uint8Array) return Buffer.from(value.buffer).toString('hex');
  return value?.toString?.() ?? String(value);
}

function plain(value) { return value?.toObject?.() ?? value; }
function httpError(message, status = 400, code = 'INVALID_FLOW_REQUEST') { return Object.assign(new Error(message), { status, code }); }
function labelsFrom(flow) {
  return Object.fromEntries((plain(flow)?.draft?.presentation?.nodes ?? []).map((node) => [node.nodeId, node.label || node.nodeId]));
}
function snapshotLabels(snapshot) {
  const norm = normalizePublicationSnapshot(snapshot);
  const result = Object.fromEntries((norm?.stages ?? []).map((stage) => [stage.stageId, stage.label || stage.stageId]));
  if (norm?.fallback?.label) result.default = norm.fallback.label;
  return result;
}

export function publicationSnapshot(flow, adaptiveRouting, { publicationNumber, operation = 'publish', restoredFrom = null } = {}) {
  const raw = plain(flow);
  const labels = labelsFrom(raw);
  const stages = (adaptiveRouting.rules ?? []).map((rule) => ({
    stageId: rule.ruleId,
    label: labels[rule.ruleId] ?? rule.ruleId,
    destinationId: rule.destinationId,
    destinationUrl: rule.destinationUrl,
    startAt: rule.startAt ?? null,
    endAt: rule.endAt ?? null,
  }));
  const fallbackNodeId = raw.draft?.routing?.fallbackNodeId ?? 'fallback';
  return {
    schemaVersion: 2,
    flowId: raw.flowId,
    revision: raw.revision,
    publicationNumber,
    operation,
    restoredFrom,
    creatorTimeZone: raw.creatorTimeZone,
    eventStartAtUtc: raw.eventStartAtUtc ?? null,
    eventEndAtUtc: raw.eventEndAtUtc ?? null,
    stages,
    fallback: {
      stageId: 'default',
      nodeId: fallbackNodeId,
      label: labels[fallbackNodeId] ?? 'Fallback',
      destinationId: adaptiveRouting.defaultDestinationId ?? 'default',
      destinationUrl: adaptiveRouting.defaultDestinationUrl,
    },
    adaptiveRouting: plain(adaptiveRouting),
  };
}

function conditionSummary(rule) {
  if (!rule) return 'No scheduled stage matched; the fallback destination is selected.';
  const conditions = [];
  if (rule.startAt) conditions.push(`at or after ${new Date(rule.startAt).toISOString()}`);
  if (rule.endAt) conditions.push(`before ${new Date(rule.endAt).toISOString()}`);
  if (rule.deviceType) conditions.push(`${rule.deviceType} device`);
  if (rule.countryCode) conditions.push(`country ${rule.countryCode}`);
  for (const [name, value] of Object.entries(rule.campaign ?? {})) conditions.push(`utm_${name} = ${value}`);
  return conditions.join(' AND ') || 'Enabled stage';
}

function evaluate(routing, instant, context, labelMap) {
  if (!routing) return null;
  const result = resolveAdaptiveDestination({ originalUrl: routing.defaultDestinationUrl, adaptiveRouting: routing }, { now: instant, ...context });
  const matchedRule = result.matchedRuleId ? (routing.rules ?? []).find((rule) => rule.ruleId === result.matchedRuleId) : null;
  return {
    ...result,
    stageId: matchedRule?.ruleId ?? 'default',
    stageLabel: matchedRule ? (labelMap[matchedRule.ruleId] ?? matchedRule.ruleId) : (labelMap.default ?? 'Fallback'),
    conditionSummary: conditionSummary(matchedRule),
    fallbackReason: result.usedFallback ? 'No enabled stage matched every supplied condition at this instant.' : null,
  };
}

export function diffPublicationSnapshots(left, right) {
  const normA = normalizePublicationSnapshot(left);
  const normB = normalizePublicationSnapshot(right);
  const stages = (snapshot) => new Map([
    ...(snapshot?.stages ?? []).map((stage) => [stage.stageId, stage]),
    ...(snapshot?.fallback ? [['default', snapshot.fallback]] : []),
  ]);
  const a = stages(normA);
  const b = stages(normB);
  const changes = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const before = a.get(id);
    const after = b.get(id);
    if (!before) changes.push({ type: 'added', stageId: id, after });
    else if (!after) changes.push({ type: 'removed', stageId: id, before });
    else {
      const fields = ['label', 'destinationUrl', 'startAt', 'endAt'].filter((field) => (before[field] ?? null) !== (after[field] ?? null));
      if (fields.length) changes.push({ type: 'changed', stageId: id, fields, before, after });
    }
  }
  return changes;
}

export function createFlowIntelligenceService({ Flow, Link, ClickEvent, FlowPublication }) {
  async function getFlow(flowId) {
    const flow = await Flow.findOne({ flowId });
    if (!flow) throw httpError('Flow not found.', 404, 'FLOW_NOT_FOUND');
    return flow;
  }

  async function loadAllPublications(flowId, rawFlow) {
    let pubs = [];
    if (FlowPublication) {
      pubs = await FlowPublication.find({ flowId }).sort({ publicationNumber: 1 }).lean();
    }
    if (!pubs.length && Array.isArray(rawFlow.publicationHistory) && rawFlow.publicationHistory.length > 0) {
      pubs = rawFlow.publicationHistory.map((item, idx) => {
        const num = item.publicationNumber ?? item.configuration?.publicationNumber ?? (idx + 1);
        const norm = normalizePublicationSnapshot(item.configuration ?? item, {
          publicationNumber: num,
          operation: item.operation ?? 'publish',
          restoredFrom: item.restoredFrom ?? null,
          publishedAt: item.publishedAt ?? new Date(),
          flow: rawFlow,
        });
        return {
          flowId,
          publicationNumber: num,
          revision: item.revision ?? norm.revision,
          operation: item.operation ?? 'publish',
          restoredFrom: item.restoredFrom ?? null,
          publishedAt: item.publishedAt ?? new Date(),
          configuration: norm,
        };
      }).sort((a, b) => a.publicationNumber - b.publicationNumber);
    }
    return pubs;
  }

  async function analytics(flowId, rangeInput = {}) {
    const flow = await getFlow(flowId);
    const raw = normalizeFlowDoc(flow);
    if (!raw.linkId) {
      return { state: 'unpublished', flow: serializeFlow(flow), analytics: null };
    }
    const linkId = toId(raw.linkId);
    const link = await Link.findById(linkId);
    if (!link) throw httpError('The published Flow link is unavailable.', 409, 'PUBLICATION_INCONSISTENT');

    const range = parseDateRange(rangeInput);
    const result = await runAggregate(ClickEvent, buildLinkAnalyticsPipeline(link._id ?? linkId, range));
    const formatted = formatLinkAnalytics(result, range);
    const routing = plain(link.adaptiveRouting);
    const destinations = new Map((routing?.destinations ?? []).map((item) => [item.destinationId, item]));
    const currentIds = new Set([routing?.defaultDestinationId, ...(routing?.rules ?? []).map((rule) => rule.destinationId)]);

    // Load publication snapshots to attribute clicks accurately by publication history
    const publications = await loadAllPublications(flowId, raw);
    const pubMap = new Map(publications.map((p) => [p.publicationNumber, p.configuration]));

    // Map each aggregated click row to its historical publication attribution
    formatted.destinations = formatted.destinations.map((row) => {
      let stageId = null;
      let stageLabel = 'Unknown attribution';
      let destinationUrl = null;
      let attribution = 'unknown';

      // 1. Direct publicationNumber attribution
      if (row.publicationNumber && pubMap.has(row.publicationNumber)) {
        const snapshot = pubMap.get(row.publicationNumber);
        if (row.usedFallback || row.destinationId === snapshot.fallback?.destinationId) {
          stageId = snapshot.fallback?.nodeId ?? 'default';
          stageLabel = snapshot.fallback?.label ?? 'Fallback';
          destinationUrl = snapshot.fallback?.destinationUrl ?? null;
          attribution = 'known';
        } else {
          const matchedStage = (snapshot.stages ?? []).find(
            (s) => s.destinationId === row.destinationId || (row.matchedRuleId && s.stageId === row.matchedRuleId),
          );
          if (matchedStage) {
            stageId = matchedStage.stageId;
            stageLabel = matchedStage.label || matchedStage.stageId;
            destinationUrl = matchedStage.destinationUrl;
            attribution = 'known';
          }
        }
      }

      // 2. Publication lookup by destinationId / ruleId across historical snapshots
      if (attribution === 'unknown') {
        const matchingPubs = publications.filter((p) => {
          const snap = p.configuration;
          if (row.destinationId === snap.fallback?.destinationId) return true;
          return (snap.stages ?? []).some(
            (s) => s.destinationId === row.destinationId || (row.matchedRuleId && s.stageId === row.matchedRuleId),
          );
        });

        if (matchingPubs.length === 1) {
          const snap = matchingPubs[0].configuration;
          if (row.destinationId === snap.fallback?.destinationId) {
            stageId = snap.fallback?.nodeId ?? 'default';
            stageLabel = snap.fallback?.label ?? 'Fallback';
            destinationUrl = snap.fallback?.destinationUrl ?? null;
            attribution = 'known';
          } else {
            const matchedStage = (snap.stages ?? []).find(
              (s) => s.destinationId === row.destinationId || (row.matchedRuleId && s.stageId === row.matchedRuleId),
            );
            if (matchedStage) {
              stageId = matchedStage.stageId;
              stageLabel = matchedStage.label || matchedStage.stageId;
              destinationUrl = matchedStage.destinationUrl;
              attribution = 'known';
            }
          }
        } else if (matchingPubs.length > 1) {
          // Check if all matching publications had the identical label and destinationUrl
          const labels = new Set();
          const urls = new Set();
          let sId = null;
          for (const p of matchingPubs) {
            const snap = p.configuration;
            if (row.destinationId === snap.fallback?.destinationId) {
              labels.add(snap.fallback?.label ?? 'Fallback');
              urls.add(snap.fallback?.destinationUrl ?? '');
              sId = snap.fallback?.nodeId ?? 'default';
            } else {
              const matchedStage = (snap.stages ?? []).find(
                (s) => s.destinationId === row.destinationId || (row.matchedRuleId && s.stageId === row.matchedRuleId),
              );
              if (matchedStage) {
                labels.add(matchedStage.label || matchedStage.stageId);
                urls.add(matchedStage.destinationUrl ?? '');
                sId = matchedStage.stageId;
              }
            }
          }
          if (labels.size === 1) {
            stageId = sId;
            stageLabel = [...labels][0];
            destinationUrl = [...urls][0];
            attribution = 'known';
          } else {
            stageId = sId ?? 'ambiguous';
            stageLabel = 'Ambiguous historical attribution';
            destinationUrl = null;
            attribution = 'ambiguous';
          }
        }
      }

      // 3. Fallback to Link destination history if present
      if (attribution === 'unknown') {
        const destination = destinations.get(row.destinationId);
        if (destination) {
          stageId = destination.ownerId;
          stageLabel = destination.ownerId === 'default' ? 'Fallback' : destination.ownerId;
          destinationUrl = destination.destinationUrl;
          attribution = 'known';
        }
      }

      return {
        ...row,
        attribution,
        stageId,
        stageLabel,
        destinationUrl,
        historical: !currentIds.has(row.destinationId),
      };
    });

    formatted.stageDistribution = Object.values(formatted.destinations.reduce((groups, row) => {
      const key = row.stageId ?? 'unknown';
      const existing = groups[key] ?? { stageId: row.stageId, stageLabel: row.stageLabel, clicks: 0, unknown: !row.stageId };
      existing.clicks += row.clicks;
      groups[key] = existing;
      return groups;
    }, {})).sort((a, b) => b.clicks - a.clicks);

    const fallbackClicks = formatted.destinations
      .filter((row) => row.stageId === 'default' || row.destinationId === routing?.defaultDestinationId)
      .reduce((sum, row) => sum + row.clicks, 0);
    formatted.fallbackEngagement = { clicks: fallbackClicks, percentage: formatted.clicksInRange ? Math.round((fallbackClicks / formatted.clicksInRange) * 100) : 0 };

    return {
      state: formatted.clicksInRange ? 'ready' : 'empty',
      flow: serializeFlow(flow),
      analytics: formatted,
    };
  }

  async function simulate(flowId, input = {}) {
    const flow = await getFlow(flowId);
    const raw = normalizeFlowDoc(flow);
    const isArchived = raw.lifecycleStatus === 'archived';
    const localDateTime = input.localDateTime || utcDateTimeToLocal(new Date().toISOString(), raw.creatorTimeZone);
    const resolved = resolveLocalDateTime(localDateTime, raw.creatorTimeZone, input.disambiguation);
    if (resolved.error) throw httpError(resolved.error, 400, resolved.ambiguous ? 'AMBIGUOUS_LOCAL_TIME' : 'INVALID_LOCAL_TIME');

    const context = {
      deviceType: input.deviceType ?? 'unknown',
      countryCode: input.countryCode ? input.countryCode.toUpperCase() : null,
      query: input.query ?? {},
    };
    const supportedDevices = new Set(['unknown', 'mobile', 'desktop', 'tablet']);
    if (!supportedDevices.has(context.deviceType)) throw httpError('Unsupported device context.');
    if (context.countryCode && !/^[A-Z]{2}$/.test(context.countryCode)) throw httpError('Country must be a two-letter uppercase code.');
    if (!context.query || typeof context.query !== 'object' || Array.isArray(context.query)) throw httpError('Query context must be an object.');

    const link = raw.linkId ? await Link.findById(raw.linkId) : null;
    const previousRouting = plain(link?.adaptiveRouting);
    let draftRouting;
    let draftError = null;
    try {
      draftRouting = compileFlowToAdaptiveRouting(raw, { previousRouting });
    } catch (error) {
      draftError = error.message;
    }

    const publishedRouting = raw.publishedConfiguration?.adaptiveRouting ?? previousRouting ?? null;
    const currentLabels = labelsFrom(raw);
    const publishedLabels = snapshotLabels(raw.publishedConfiguration);
    const instant = resolved.value;

    const boundaries = [...new Set([
      raw.eventStartAtUtc,
      raw.eventEndAtUtc,
      ...(draftRouting?.rules ?? []).flatMap((rule) => [rule.startAt, rule.endAt]),
      ...(publishedRouting?.rules ?? []).flatMap((rule) => [rule.startAt, rule.endAt]),
    ].filter(Boolean).map((value) => new Date(value).toISOString()))].sort().map((utc) => ({
      utc,
      localDateTime: utcDateTimeToLocal(utc, raw.creatorTimeZone),
    }));

    return {
      flowId: raw.flowId,
      timeZone: raw.creatorTimeZone,
      lifecycleStatus: raw.lifecycleStatus,
      isArchived,
      archivedNotice: isArchived ? 'This Flow is currently archived. Public visits to its short link return HTTP 410 Gone.' : null,
      localDateTime,
      evaluatedAt: instant.toISOString(),
      ambiguous: resolved.ambiguous === true,
      draft: draftRouting ? evaluate(draftRouting, instant, context, currentLabels) : null,
      draftError,
      published: evaluate(publishedRouting, instant, context, publishedLabels),
      boundaries,
      note: 'Simulation only. No redirect occurred, no click was recorded, and no state was changed.',
    };
  }

  async function history(flowId, { page = 1, limit = 20 } = {}) {
    const flow = await getFlow(flowId);
    const raw = normalizeFlowDoc(flow);
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let items = [];
    let total = 0;

    if (FlowPublication) {
      // Repeatable and interruption-resilient migration: check which publications exist and only insert missing ones
      if (Array.isArray(raw.publicationHistory) && raw.publicationHistory.length > 0) {
        const existingPubs = await FlowPublication.find({ flowId }, { publicationNumber: 1 }).lean();
        const existingNumbers = new Set((existingPubs ?? []).map((p) => p.publicationNumber));
        const missingDocs = [];

        for (let idx = 0; idx < raw.publicationHistory.length; idx++) {
          const entry = raw.publicationHistory[idx];
          const pubNum = entry.publicationNumber ?? entry.configuration?.publicationNumber ?? (idx + 1);
          if (!existingNumbers.has(pubNum)) {
            const norm = normalizePublicationSnapshot(entry.configuration ?? entry, {
              publicationNumber: pubNum,
              operation: entry.operation ?? 'publish',
              restoredFrom: entry.restoredFrom ?? null,
              publishedAt: entry.publishedAt ?? new Date(),
              flow: raw,
            });
            missingDocs.push({
              flowId: raw.flowId,
              publicationNumber: pubNum,
              revision: entry.revision ?? norm.revision,
              operation: entry.operation ?? 'publish',
              restoredFrom: entry.restoredFrom ?? null,
              publishedAt: entry.publishedAt ?? new Date(),
              configuration: norm,
            });
          }
        }

        if (missingDocs.length > 0) {
          try {
            await FlowPublication.insertMany(missingDocs, { ordered: false });
          } catch {}
        }
      }

      total = await FlowPublication.countDocuments({ flowId });
      if (total > 0) {
        items = await FlowPublication.find({ flowId })
          .sort({ publicationNumber: -1 })
          .skip(offset)
          .limit(limitNum)
          .lean();
      }
    }

    if (!FlowPublication || total === 0) {
      const allHistory = (raw.publicationHistory ?? []).map((entry, idx) => {
        const pubNum = entry.publicationNumber ?? entry.configuration?.publicationNumber ?? (idx + 1);
        const norm = normalizePublicationSnapshot(entry.configuration ?? entry, {
          publicationNumber: pubNum,
          operation: entry.operation ?? 'publish',
          restoredFrom: entry.restoredFrom ?? null,
          publishedAt: entry.publishedAt ?? new Date(),
          flow: raw,
        });
        return {
          publicationNumber: pubNum,
          revision: entry.revision ?? norm.revision,
          operation: entry.operation ?? 'publish',
          restoredFrom: entry.restoredFrom ?? null,
          publishedAt: entry.publishedAt,
          configuration: norm,
        };
      }).sort((a, b) => (b.publicationNumber ?? 0) - (a.publicationNumber ?? 0));
      total = allHistory.length;
      items = allHistory.slice(offset, offset + limitNum);
    }

    const historyWithDiffs = await Promise.all(items.map(async (entry) => {
      const currentNumber = entry.publicationNumber ?? entry.configuration?.publicationNumber;
      let priorSnapshot = null;
      if (FlowPublication && currentNumber > 1) {
        const priorDoc = await FlowPublication.findOne({ flowId, publicationNumber: currentNumber - 1 }).lean();
        if (priorDoc) priorSnapshot = priorDoc.configuration;
      }
      if (!priorSnapshot && currentNumber > 1 && Array.isArray(raw.publicationHistory)) {
        const found = raw.publicationHistory.find((item, idx) => {
          const num = item.publicationNumber ?? item.configuration?.publicationNumber ?? (idx + 1);
          return num === currentNumber - 1;
        });
        if (found) priorSnapshot = normalizePublicationSnapshot(found.configuration ?? found, { publicationNumber: currentNumber - 1, flow: raw });
      }

      const currentSnapshot = normalizePublicationSnapshot(entry.configuration ?? entry, { publicationNumber: currentNumber, flow: raw });
      const changes = priorSnapshot ? diffPublicationSnapshots(priorSnapshot, currentSnapshot) : [];

      return {
        publicationNumber: currentNumber,
        revision: entry.revision,
        operation: entry.operation ?? 'publish',
        restoredFrom: entry.restoredFrom ?? null,
        publishedAt: entry.publishedAt,
        configuration: currentSnapshot,
        changes,
        isCurrent: (raw.publishedConfiguration?.publicationNumber ?? raw.publicationSequence) === currentNumber,
      };
    }));

    return {
      flowId: raw.flowId,
      history: historyWithDiffs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      activePublicationNumber: raw.publishedConfiguration?.publicationNumber ?? raw.publicationSequence ?? null,
    };
  }

  async function diff(flowId, fromNumber, toNumber) {
    const fromNum = Number(fromNumber);
    const toNum = Number(toNumber);
    if (!Number.isInteger(fromNum) || !Number.isInteger(toNum)) {
      throw httpError('Both from and to publication numbers must be valid integers.', 400);
    }

    let fromDoc = FlowPublication ? await FlowPublication.findOne({ flowId, publicationNumber: fromNum }).lean() : null;
    let toDoc = FlowPublication ? await FlowPublication.findOne({ flowId, publicationNumber: toNum }).lean() : null;

    if (!fromDoc || !toDoc) {
      const flow = await getFlow(flowId);
      const raw = normalizeFlowDoc(flow);
      const historyList = raw.publicationHistory ?? [];
      if (!fromDoc) {
        const found = historyList.find((item, idx) => (item.publicationNumber ?? item.configuration?.publicationNumber ?? (idx + 1)) === fromNum);
        if (found) {
          fromDoc = { configuration: normalizePublicationSnapshot(found.configuration ?? found, { publicationNumber: fromNum, flow: raw }) };
        }
      }
      if (!toDoc) {
        const found = historyList.find((item, idx) => (item.publicationNumber ?? item.configuration?.publicationNumber ?? (idx + 1)) === toNum);
        if (found) {
          toDoc = { configuration: normalizePublicationSnapshot(found.configuration ?? found, { publicationNumber: toNum, flow: raw }) };
        }
      }
    }

    if (!fromDoc || !toDoc) throw httpError('One or both specified publications could not be found.', 404, 'PUBLICATION_NOT_FOUND');

    const fromSnapshot = normalizePublicationSnapshot(fromDoc.configuration);
    const toSnapshot = normalizePublicationSnapshot(toDoc.configuration);

    return {
      flowId,
      fromPublicationNumber: fromNum,
      toPublicationNumber: toNum,
      fromSnapshot,
      toSnapshot,
      changes: diffPublicationSnapshots(fromSnapshot, toSnapshot),
    };
  }

  return { analytics, simulate, history, diff };
}
