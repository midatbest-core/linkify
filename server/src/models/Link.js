import mongoose from 'mongoose';

const linkSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
  isCustomAlias: { type: Boolean },
  title: { type: String, trim: true, maxlength: 120, default: '' },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
}, {
  collection: 'links',
  timestamps: true,
});

linkSchema.index({ createdAt: -1 });
linkSchema.index({ status: 1, createdAt: -1 });
linkSchema.index({ tags: 1, createdAt: -1 });

export default mongoose.models.Link ?? mongoose.model('Link', linkSchema);
