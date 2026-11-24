import mongoose from 'mongoose';

const clickEventSchema = new mongoose.Schema({
  linkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Link', required: true },
  clickedAt: { type: Date, required: true, default: Date.now },
  referrer: { type: String, default: null },
  deviceType: { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'], default: 'unknown' },
  browser: { type: String, default: 'unknown' },
  operatingSystem: { type: String, default: 'unknown' },
  countryName: { type: String, default: null },
  countryCode: { type: String, default: null },
  cityName: { type: String, default: null },
  region: { type: String, default: null },
  isBot: { type: Boolean, default: false },
  flowId: { type: String, default: null, index: true },
  publicationNumber: { type: Number, default: null },
  selectedDestinationId: { type: String, default: 'default' },
  matchedRuleId: { type: String, default: null },
  usedFallback: { type: Boolean, default: true },
}, { collection: 'clickEvents', versionKey: false });

clickEventSchema.index({ linkId: 1, clickedAt: -1 });
clickEventSchema.index({ clickedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export default mongoose.models.ClickEvent ?? mongoose.model('ClickEvent', clickEventSchema);
