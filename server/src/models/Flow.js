import mongoose from 'mongoose';

const positionSchema = new mongoose.Schema({ x: Number, y: Number }, { _id: false });
const presentationNodeSchema = new mongoose.Schema({
  nodeId: { type: String, required: true },
  kind: { type: String, enum: ['entry', 'router', 'destination', 'fallback'], required: true },
  label: { type: String, maxlength: 80, default: '' },
  description: { type: String, maxlength: 240, default: '' },
  phase: { type: String, enum: ['before', 'during', 'after', 'custom'] },
  position: { type: positionSchema, required: true },
}, { _id: false });
const edgeSchema = new mongoose.Schema({
  edgeId: { type: String, required: true }, source: { type: String, required: true }, target: { type: String, required: true }, label: { type: String, maxlength: 100, default: '' },
}, { _id: false });
const stageSchema = new mongoose.Schema({
  nodeId: { type: String, required: true },
  phase: { type: String, enum: ['before', 'during', 'after', 'custom'], required: true },
  destinationUrl: { type: String, default: '' },
  startLocal: { type: String, default: '' }, endLocal: { type: String, default: '' },
  startDisambiguation: { type: String, enum: ['earlier', 'later'], default: 'earlier' },
  endDisambiguation: { type: String, enum: ['earlier', 'later'], default: 'earlier' },
  startAtUtc: { type: Date, default: null }, endAtUtc: { type: Date, default: null },
}, { _id: false });

const flowSchema = new mongoose.Schema({
  flowId: { type: String, required: true, unique: true, index: true },
  eventName: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 1000 },
  creatorTimeZone: { type: String, required: true, maxlength: 100 },
  eventStartLocal: { type: String, default: '' }, eventEndLocal: { type: String, default: '' },
  eventStartDisambiguation: { type: String, enum: ['earlier', 'later'], default: 'earlier' },
  eventEndDisambiguation: { type: String, enum: ['earlier', 'later'], default: 'earlier' },
  eventStartAtUtc: { type: Date, default: null }, eventEndAtUtc: { type: Date, default: null },
  revision: { type: Number, required: true, min: 1, default: 1 },
  draft: {
    presentation: { nodes: { type: [presentationNodeSchema], default: [] }, edges: { type: [edgeSchema], default: [] } },
    routing: { stages: { type: [stageSchema], default: [] }, fallbackNodeId: { type: String, default: null }, fallbackDestinationUrl: { type: String, default: '' } },
  },
  publishedRevision: { type: Number, default: null },
  publishedConfiguration: { type: mongoose.Schema.Types.Mixed, default: null },
  publishedAt: { type: Date, default: null },
  publicationHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
  publicationRequests: { type: [new mongoose.Schema({ key: { type: String, required: true }, payloadHash: { type: String, required: true }, revision: { type: Number, required: true }, linkId: { type: mongoose.Schema.Types.ObjectId, required: true }, shortCode: { type: String, required: true }, publishedAt: { type: Date, required: true } }, { _id: false })], default: [] },
  linkId: { type: mongoose.Schema.Types.ObjectId, ref: 'Link', default: null },
}, { collection: 'flows', timestamps: true });

flowSchema.index({ updatedAt: -1 });

export default mongoose.models.Flow ?? mongoose.model('Flow', flowSchema);
