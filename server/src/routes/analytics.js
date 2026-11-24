import { Router } from 'express';
import mongoose from 'mongoose';
import ClickEvent from '../models/ClickEvent.js';
import Link from '../models/Link.js';
import {
  buildCampaignReportPipeline,
  buildLinkAnalyticsPipeline,
  buildOverviewAnalyticsPipeline,
  formatCampaignReport,
  formatLinkAnalytics,
  formatOverviewAnalytics,
  runAggregate,
} from '../services/analyticsService.js';
import { parseDateRange } from '../utils/dateRange.js';
import { generateCsv } from '../utils/csvExport.js';

export function createAnalyticsRouter({ linkModel = Link, clickEventModel = ClickEvent, rateLimitMiddleware = (_request, _response, next) => next() } = {}) {
  const router = Router();

  router.get('/analytics/overview', rateLimitMiddleware, async (request, response, next) => {
    try {
      const range = parseDateRange(request.query);
      const [result, recentLinks] = await Promise.all([
        runAggregate(clickEventModel, buildOverviewAnalyticsPipeline(range)),
        linkModel.find({}).sort({ createdAt: -1 }).limit(5),
      ]);
      const baseUrl = (process.env.SHORT_BASE_URL ?? `${request.protocol}://${request.get('host')}`).replace(/\/$/, '');
      response.json({ analytics: { ...formatOverviewAnalytics(result, recentLinks.map((link) => ({
        id: link.id ?? link._id?.toString(), shortCode: link.shortCode,
        shortUrl: `${baseUrl}/${link.shortCode}`, originalUrl: link.originalUrl,
        title: link.title ?? '', status: link.status ?? 'active', createdAt: link.createdAt,
      })), range) } });
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  router.get('/links/:id/analytics', rateLimitMiddleware, async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const range = parseDateRange(request.query);
      const link = await linkModel.findById(request.params.id);
      if (!link) return response.status(404).json({ error: 'Link not found.' });
      const result = await runAggregate(clickEventModel, buildLinkAnalyticsPipeline(request.params.id, range));
      response.json({ analytics: formatLinkAnalytics(result, range) });
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  router.get('/links/:id/campaign-report', rateLimitMiddleware, async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const range = parseDateRange(request.query);
      const link = await linkModel.findById(request.params.id);
      if (!link) return response.status(404).json({ error: 'Link not found.' });
      const result = await runAggregate(clickEventModel, buildCampaignReportPipeline(request.params.id, range));
      response.json({ report: formatCampaignReport(link, result, range) });
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  router.get('/links/:id/campaign-report/export', rateLimitMiddleware, async (request, response, next) => {
    if (!mongoose.isObjectIdOrHexString(request.params.id)) return response.status(400).json({ error: 'Invalid link ID.' });
    try {
      const range = parseDateRange(request.query);
      const link = await linkModel.findById(request.params.id);
      if (!link) return response.status(404).json({ error: 'Link not found.' });

      const result = await runAggregate(clickEventModel, buildCampaignReportPipeline(request.params.id, range));
      const report = formatCampaignReport(link, result, range);

      const overviewHeaders = [
        { label: 'Short Code', key: 'shortCode' },
        { label: 'Title', key: 'title' },
        { label: 'Original URL', key: 'originalUrl' },
        { label: 'Status', key: 'status' },
        { label: 'Date From', key: 'from' },
        { label: 'Date To', key: 'to' },
        { label: 'Range Visits', key: 'rangeVisits' },
        { label: 'Range Allowed', key: 'rangeAllowed' },
        { label: 'Range Blocked', key: 'rangeBlocked' },
        { label: 'Lifetime Redirects', key: 'lifetimeRedirects' },
        { label: 'Max Clicks Cap', key: 'maxClicks' },
        { label: 'Cap Reached', key: 'capReached' },
        { label: 'Expires At', key: 'expiresAt' },
        { label: 'Expired', key: 'isExpired' },
        { label: 'Password Protected', key: 'hasPassword' },
        { label: 'Blocked: Expired', key: 'blockedExpired' },
        { label: 'Blocked: Max Clicks', key: 'blockedMaxClicks' },
        { label: 'Blocked: Password', key: 'blockedPassword' },
      ];
      const overviewRows = [{
        shortCode: report.link.shortCode,
        title: report.link.title,
        originalUrl: report.link.originalUrl,
        status: report.link.status,
        from: report.range.from,
        to: report.range.to,
        rangeVisits: report.summary.range.totalVisits,
        rangeAllowed: report.summary.range.allowedRedirects,
        rangeBlocked: report.summary.range.blockedAttempts,
        lifetimeRedirects: report.link.lifetimeRedirectCount,
        maxClicks: report.capStatus.maxClicks ?? 'None',
        capReached: report.capStatus.capReached ? 'Yes' : 'No',
        expiresAt: report.link.protection.expiresAt ?? 'None',
        isExpired: report.capStatus.isExpired ? 'Yes' : 'No',
        hasPassword: report.link.protection.hasPassword ? 'Yes' : 'No',
        blockedExpired: report.summary.range.blockedBreakdown.expired,
        blockedMaxClicks: report.summary.range.blockedBreakdown.maxClicks,
        blockedPassword: report.summary.range.blockedBreakdown.password,
      }];

      let csvContent = '# SECTION: OVERVIEW\r\n' + generateCsv({ headers: overviewHeaders, rows: overviewRows });

      if (report.experiments && report.experiments.length > 0) {
        const expHeaders = [
          { label: 'Variant ID', key: 'variantId' },
          { label: 'Label', key: 'label' },
          { label: 'Destination URL', key: 'destinationUrl' },
          { label: 'Configured Weight %', key: 'weight' },
          { label: 'Clicks', key: 'clicks' },
          { label: 'Traffic Share %', key: 'trafficPercentage' },
        ];
        csvContent += '\r\n\r\n# SECTION: AB_EXPERIMENTS\r\n' + generateCsv({ headers: expHeaders, rows: report.experiments });
      }

      if (report.dailyClicks && report.dailyClicks.length > 0) {
        const dailyHeaders = [
          { label: 'Date', key: '_id' },
          { label: 'Successful Redirects', key: 'count' },
        ];
        csvContent += '\r\n\r\n# SECTION: DAILY_CLICKS\r\n' + generateCsv({ headers: dailyHeaders, rows: report.dailyClicks });
      }

      const deviceRows = Object.entries(report.deviceBreakdown).map(([device, count]) => ({ category: 'Device', name: device, clicks: count }));
      const countryRows = report.topCountries.map((c) => ({ category: 'Country', name: `${c.countryName} (${c.countryCode})`, clicks: c.clicks }));
      const referrerRows = report.topReferrers.map((r) => ({ category: 'Referrer', name: r.hostname, clicks: r.clicks }));
      const breakdownRows = [...deviceRows, ...countryRows, ...referrerRows];
      if (breakdownRows.length > 0) {
        const breakdownHeaders = [
          { label: 'Category', key: 'category' },
          { label: 'Name', key: 'name' },
          { label: 'Clicks', key: 'clicks' },
        ];
        csvContent += '\r\n\r\n# SECTION: AUDIENCE_BREAKDOWN\r\n' + generateCsv({ headers: breakdownHeaders, rows: breakdownRows });
      }

      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="linkify-campaign-${report.link.shortCode}-${report.range.from}-to-${report.range.to}.csv"`);
      return response.send(csvContent);
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  return router;
}

export default createAnalyticsRouter;
