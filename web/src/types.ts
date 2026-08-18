export interface RootInfo {
  id: number;
  path: string;
  waive_dir: string | null;
  created_at?: string;
}

export interface CheckItem {
  name: string;
  status: string;
  report: string | null;
}

export interface ModeInfo {
  mode: string;
  summaryFile: string;
  items: CheckItem[];
}

export interface ScanResult {
  root: string;
  modes: ModeInfo[];
}

export interface ReportLine {
  lineNo: number;
  text: string;
  isComment: boolean;
  isEmpty: boolean;
  waived: boolean;
}

export interface ItemDetail {
  mode: string;
  item: string;
  status: string;
  reportPath: string | null;
  format: string;
  missing: boolean;
  lines: ReportLine[];
  waivedInfo: { line_no: number; content: string; waive_reason: string }[];
}

export interface CopilotMessage {
  id?: string;
  role: string;
  text: string;
  reasoning?: string;
  tools?: CopilotTool[];
}

export interface CopilotTool {
  callID: string;
  tool: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  input: string;
  title: string;
  output: string;
  error: string;
}

export interface CopilotInfo {
  sessionID: string | null;
  sessionExists: boolean;
  messages: CopilotMessage[];
  preset: string;
  status: string;
  reportPath: string | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  content: string;
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface WaiveResult {
  file: string;
  existed: boolean;
  exported: number;
  reason: string;
}

export interface WaiveFileInfo {
  file: string | null;
  content: string;
}

export interface BrowseResult {
  root: string;
  isDir: boolean;
  parent: string | null;
  dirs: { name: string; path: string }[];
}