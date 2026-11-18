import mongoose from 'mongoose';

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is required to connect to MongoDB.');
  }

  await mongoose.connect(uri);
  console.info('Connected to MongoDB.');
  return mongoose.connection;
}
