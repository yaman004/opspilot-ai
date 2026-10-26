import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';
import { syncAllIndexes } from '../models';

export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  try {
    await syncAllIndexes();
  } catch (err) {
    // Index problems must be visible, but must not take the API down on a read-only replica etc.
    logger.error({ err }, 'Failed to sync MongoDB indexes');
  }
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
