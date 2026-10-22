/**
 * connectors.ts — Unified Connector Context Builder & Type Definitions
 */

export interface ConnectorContextPayload {
  workspaceContext?: {
    emails?: Array<{ sender?: string; subject?: string; snippet?: string; date?: string }>;
    calendarEvents?: Array<{ summary?: string; start?: string; end?: string; description?: string }>;
    recentSheets?: Array<{ title?: string; id?: string }>;
    recentFiles?: Array<{ name?: string; id?: string; mimeType?: string }>;
    [key: string]: any;
  } | string;
  driveContext?: {
    files?: Array<{ name?: string; size?: number; type?: string; downloadUrl?: string }>;
    folders?: string[];
    [key: string]: any;
  } | string;
  searchContext?: {
    query?: string;
    results?: Array<{ title?: string; url?: string; snippet?: string }>;
    [key: string]: any;
  } | string;
  [key: string]: any;
}

export function buildInjectedConnectorContext(payload: ConnectorContextPayload = {}): string {
  const sections: string[] = [];

  if (payload.workspaceContext) {
    if (typeof payload.workspaceContext === 'string') {
      sections.push(`[Google Workspace Context]:\n${payload.workspaceContext}`);
    } else {
      sections.push(`[Google Workspace Context]:\n${JSON.stringify(payload.workspaceContext, null, 2)}`);
    }
  }

  if (payload.driveContext) {
    if (typeof payload.driveContext === 'string') {
      sections.push(`[Zulora Drive Context]:\n${payload.driveContext}`);
    } else {
      sections.push(`[Zulora Drive Context]:\n${JSON.stringify(payload.driveContext, null, 2)}`);
    }
  }

  if (payload.searchContext) {
    if (typeof payload.searchContext === 'string') {
      sections.push(`[Web Search Context]:\n${payload.searchContext}`);
    } else {
      sections.push(`[Web Search Context]:\n${JSON.stringify(payload.searchContext, null, 2)}`);
    }
  }

  return sections.join('\n\n');
}

export default {
  buildInjectedConnectorContext
};

