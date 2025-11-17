import type {Tool} from '../agent/types.js';
import {createListFilesTool, createReadFileTool, createWriteFileTool} from './filesystem.js';
import {
  createAutomationsTool,
  createBioTool,
  createCanmoreTool,
  createFileSearchTool,
  createGCalTool,
  createGContactsTool,
  createGmailTool,
  createImageGenTool,
  createNodeTool,
  createNodeUserVisibleTool,
  createWebTool
} from './system.js';

export const createDefaultTools = (): Tool[] => [
  createListFilesTool(),
  createReadFileTool(),
  createWriteFileTool(),
  createFileSearchTool(),
  createNodeTool(),
  createNodeUserVisibleTool(),
  createWebTool(),
  createImageGenTool(),
  createAutomationsTool(),
  createGmailTool(),
  createGCalTool(),
  createGContactsTool(),
  createCanmoreTool(),
  createBioTool()
];
