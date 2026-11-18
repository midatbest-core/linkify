import mongoose from 'mongoose';

const linkSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
}, {
  collection: 'links',
  timestamps: { createdAt: true, updatedAt: false },
});

export default mongoose.models.Link ?? mongoose.model('Link', linkSchema);
