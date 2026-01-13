import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

import { thoughts, editOperations } from "./schema"
import {
  createThought,
  getThoughts,
  getThoughtById,
  getThoughtsPaginated,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
} from "./lib"

export {
  thoughts,
  editOperations,
  createThought,
  getThoughts,
  getThoughtById,
  getThoughtsPaginated,
  createEditOperation,
  getEditOperations,
  updateEditOperationsThoughtId,
  deleteEditOperations,
}
