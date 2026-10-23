import mongoose from "mongoose";
import type { DocumentClient } from "./mongo.probe";

export async function openMongo(url: string): Promise<DocumentClient> {
  const connection = await mongoose.createConnection(url, { serverSelectionTimeoutMS: 1000 }).asPromise();
  return {
    async ping() {
      await connection.db?.command({ ping: 1 });
    },
    async close() {
      await connection.close();
    },
  };
}
