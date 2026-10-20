/**
 * workspace.ts — Google Workspace Agent & Dispatcher for Zulora AI
 * =================================================================
 * Provides seamless, strongly-typed execution for Google Workspace services:
 * Gmail, Google Sheets, Google Calendar, Google Forms, and Google Drive.
 * Aligned with official Google OAuth 2.0 credentials and error handling.
 */

import {
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
} from '../config/google';
import connectorManager from '../../services/connectorManager';

export {
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
};

export interface WorkspaceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  status?: number;
  retryable?: boolean;
  url?: string;
}

/**
 * Handle and normalize Workspace errors (OAuth 401/503 handling)
 */
function handleWorkspaceError(error: any): WorkspaceResponse {
  const message = error?.message || String(error || 'Unknown Workspace error');
  const status = Number(error?.status || error?.statusCode) || undefined;
  const code = error?.code || (status === 401
    ? 'GOOGLE_OAUTH_REQUIRED'
    : status === 503
      ? 'GOOGLE_OAUTH_UNAVAILABLE'
      : message.includes('OAuth') || message.includes('client credentials')
        ? 'GOOGLE_OAUTH_ERROR'
        : 'WORKSPACE_ERROR');
  return {
    success: false,
    error: message,
    code,
    ...(status ? { status } : {}),
    retryable: status === 503 || Boolean(status && status >= 500)
  };
}

// ==========================================
// 1. GMAIL AGENT HANDLERS
// ==========================================

export async function sendGmailEmail(options: {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.sendEmail({
      to: options.to,
      subject: options.subject,
      body: options.body,
      isHtml: options.isHtml !== false
    });
    return {
      success: true,
      data: result,
      url: result?.threadId ? `https://mail.google.com/mail/u/0/#inbox/${result.threadId}` : undefined
    };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function createGmailDraft(options: {
  to: string;
  subject: string;
  body: string;
}): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.createDraft({
      to: options.to,
      subject: options.subject,
      body: options.body
    });
    return { success: true, data: result };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function searchGmailMessages(query: string, maxResults = 10): Promise<WorkspaceResponse> {
  try {
    const messages = await connectorManager.searchMessages(query, maxResults);
    return { success: true, data: messages };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

// ==========================================
// 2. GOOGLE SHEETS AGENT HANDLERS
// ==========================================

export async function createGoogleSheet(title: string, headers: string[] = [], initialRows: any[][] = []): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.createSpreadsheet(title, headers, initialRows);
    return {
      success: true,
      data: result,
      url: result?.spreadsheetUrl
    };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function readGoogleSheet(spreadsheetId: string, range = 'Sheet1!A1:Z100'): Promise<WorkspaceResponse> {
  try {
    const rows = await connectorManager.readSheetData({
      spreadsheet_id: spreadsheetId,
      range
    });
    return { success: true, data: rows };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function appendGoogleSheetData(spreadsheetId: string, rows: any[][], range = 'Sheet1!A1'): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.appendSheetRows({
      spreadsheetId,
      range,
      values: rows
    });
    return { success: true, data: result };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

// ==========================================
// 3. GOOGLE CALENDAR AGENT HANDLERS
// ==========================================

export async function listCalendarEvents(timeMin?: string, timeMax?: string): Promise<WorkspaceResponse> {
  try {
    const events = await connectorManager.listEvents({
      timeMin: timeMin || new Date().toISOString(),
      timeMax
    });
    return { success: true, data: events };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function createCalendarEvent(event: {
  summary: string;
  description?: string;
  start: string | Date;
  end: string | Date;
  attendees?: string[];
  location?: string;
}): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.createEvent(event);
    return {
      success: true,
      data: result,
      url: result?.htmlLink
    };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.deleteEvent(eventId);
    return { success: true, data: result };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

// ==========================================
// 4. GOOGLE DRIVE AGENT HANDLERS
// ==========================================

export async function searchDriveFiles(query = '', pageSize = 20): Promise<WorkspaceResponse> {
  try {
    const files = await connectorManager.searchFiles(query, pageSize);
    return { success: true, data: files };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

export async function createDriveFolder(name: string, parentFolderId?: string): Promise<WorkspaceResponse> {
  try {
    const folder = await connectorManager.createFolder(name, parentFolderId);
    return {
      success: true,
      data: folder,
      url: folder?.id ? `https://drive.google.com/drive/folders/${folder.id}` : undefined
    };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

// ==========================================
// 5. GOOGLE FORMS AGENT HANDLERS
// ==========================================

export async function createGoogleForm(title: string, description?: string, questions: any[] = []): Promise<WorkspaceResponse> {
  try {
    const result = await connectorManager.createForm({
      title,
      description,
      questions
    });
    return {
      success: true,
      data: result,
      url: result?.formUrl || result?.viewUrl
    };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

// ==========================================
// 6. UNIFIED WORKSPACE ACTION DISPATCHER
// ==========================================

export async function executeWorkspaceAction(action: string, params: Record<string, any> = {}): Promise<WorkspaceResponse> {
  switch (action) {
    case 'gmail_send':
      return sendGmailEmail({ to: params.to, subject: params.subject, body: params.body, isHtml: params.isHtml });
    case 'gmail_draft':
      return createGmailDraft({ to: params.to, subject: params.subject, body: params.body });
    case 'gmail_search':
      return searchGmailMessages(params.query, params.maxResults);
    case 'sheets_create':
      return createGoogleSheet(params.title, params.headers, params.initialRows);
    case 'sheets_read':
      return readGoogleSheet(params.spreadsheetId, params.range);
    case 'sheets_append':
      return appendGoogleSheetData(params.spreadsheetId, params.rows, params.range);
    case 'calendar_list':
      return listCalendarEvents(params.timeMin, params.timeMax);
    case 'calendar_create':
      return createCalendarEvent(params as any);
    case 'calendar_delete':
      return deleteCalendarEvent(params.eventId);
    case 'drive_search':
      return searchDriveFiles(params.query, params.pageSize);
    case 'drive_create_folder':
      return createDriveFolder(params.name, params.parentFolderId);
    case 'forms_create':
      return createGoogleForm(params.title, params.description, params.questions);
    default:
      return {
        success: false,
        error: `Unknown Google Workspace action: ${action}`,
        code: 'UNKNOWN_ACTION'
      };
  }
}

export default {
  sendGmailEmail,
  createGmailDraft,
  searchGmailMessages,
  createGoogleSheet,
  readGoogleSheet,
  appendGoogleSheetData,
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  searchDriveFiles,
  createDriveFolder,
  createGoogleForm,
  executeWorkspaceAction,
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
};

