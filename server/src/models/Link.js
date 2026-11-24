import mongoose from 'mongoose';

const linkSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  adaptiveRouting: {
    enabled: { type: Boolean, default: false },
    defaultDestinationUrl: { type: String, default: null },
    defaultDestinationId: { type: String, default: null },
    destinations: [{
      _id: false,
      destinationId: { type: String, required: true },
      ownerId: { type: String, required: true },
      destinationUrl: { type: String, required: true },
    }],
    rules: [{
      _id: false,
      ruleId: { type: String, required: true },
      priority: { type: Number, required: true, min: 0 },
      deviceType: { type: String, enum: ['mobile', 'desktop', 'tablet'] },
      countryCode: { type: String, match: /^[A-Z]{2}$/ },
      startAt: { type: Date },
      endAt: { type: Date },
      timeZone: { type: String, maxlength: 100 },
      campaign: {
        _id: false,
        source: { type: String, maxlength: 100 },
        medium: { type: String, maxlength: 100 },
        campaign: { type: String, maxlength: 100 },
      },
      destinationUrl: { type: String, required: true },
      destinationId: { type: String, required: true },
      enabled: { type: Boolean, default: true },
    }],
  },
  shortCode: { type: String, required: true, unique: true },
  isCustomAlias: { type: Boolean },
  title: { type: String, trim: true, maxlength: 120, default: '' },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
  management: {
    ownerType: { type: String, enum: ['flow'], default: undefined },
    flowId: { type: String, default: undefined },
  },
}, {
  collection: 'links',
  timestamps: true,
});

linkSchema.index({ createdAt: -1 });
linkSchema.index({ status: 1, createdAt: -1 });
linkSchema.index({ tags: 1, createdAt: -1 });
linkSchema.index({ 'management.flowId': 1 }, { unique: true, partialFilterExpression: { 'management.ownerType': 'flow' } });

export default mongoose.models.Link ?? mongoose.model('Link', linkSchema);
