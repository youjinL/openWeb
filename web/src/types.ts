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
}

export interface CopilotInfo {
  sessionID: string | null;
  sessionExists: boolean;
  messages: CopilotMessage[];
  preset: string;
  status: string;
  reportPath: string | null;
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