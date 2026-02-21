import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

import { thoughts, editOperations, chatSessions } from "./schema"
import {
  createThought,
  getThoughts,
  getThoughtById,
  getThoughtsPaginated,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
  createChatSession,
  updateChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
} from "./lib"

export {
  thoughts,
  editOperations,
  chatSessions,
  createThought,
  getThoughts,
  getThoughtById,
  getThoughtsPaginated,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
  createChatSession,
  updateChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
}
