import mongoose from 'mongoose';

const flowPublicationSchema = new mongoose.Schema({
  flowId: { type: String, required: true, index: true },
  publicationNumber: { type: Number, required: true },
  revision: { type: Number, required: true },
  operation: { type: String, enum: ['publish', 'rollback'], default: 'publish' },
  restoredFrom: { type: Number, default: null },
  publishedAt: { type: Date, required: true },
  configuration: { type: mongoose.Schema.Types.Mixed, required: true },
}, { collection: 'flow_publications', timestamps: true });

flowPublicationSchema.index({ flowId: 1, publicationNumber: -1 }, { unique: true });

export default mongoose.models.FlowPublication ?? mongoose.model('FlowPublication', flowPublicationSchema);
