import mongoose from 'mongoose';

const adminSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  credentialVersion: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { collection: 'adminSessions', versionKey: false });

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.AdminSession ?? mongoose.model('AdminSession', adminSessionSchema);
