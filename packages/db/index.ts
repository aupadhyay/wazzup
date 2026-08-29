import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

import { thoughts, editOperations, chatSessions, syncState } from "./schema"
import {
  createThought,
  getThoughts,
  getThoughtById,
  getThoughtsPaginated,
  setThoughtAccessLevel,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
  createChatSession,
  updateChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  getSyncState,
  setSyncState,
  getThoughtsUpdatedSince,
  getEditOperationsByThoughtUuids,
  upsertSyncedThought,
  upsertSyncedEditOperation,
} from "./lib"

export {
  thoughts,
  editOperations,
  chatSessions,
  syncState,
  createThought,
  getThoughts,
  getThoughtById,
  getThoughtsPaginated,
  setThoughtAccessLevel,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
  createChatSession,
  updateChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  getSyncState,
  setSyncState,
  getThoughtsUpdatedSince,
  getEditOperationsByThoughtUuids,
  upsertSyncedThought,
  upsertSyncedEditOperation,
}

export {
  accessLevelSchema,
  thoughtWireSchema,
  editOperationWireSchema,
  syncPushInputSchema,
  syncPullInputSchema,
  syncPullResultSchema,
} from "./wire"

export type {
  AccessLevel,
  ThoughtWire,
  EditOperationWire,
  SyncPushInput,
  SyncPullResult,
} from "./wire"
