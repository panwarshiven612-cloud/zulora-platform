/**
 * workspace.ts — Google Workspace & Zulora Drive Agent Dispatcher
 * =================================================================
 * Provides seamless, strongly-typed execution for Google Workspace services:
 * Gmail (send, draft, search, read, and inbox analysis), Google Sheets,
 * Google Calendar, Google Forms, and full Zulora Drive Firestore/Storage synchronization.
 */

import {
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
} from '../config/google';
import connectorManager from '../../services/connectorManager';
import { zuloraDriveService } from '../../services/zuloraDriveService';

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
  badge?: string;
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
  const isAuthError = status === 401 || status === 403 || message.includes('OAuth') || message.includes('client credentials') || message.includes('not signed in') || message.includes('expired');
  const code = error?.code || (status === 401
    ? 'GOOGLE_OAUTH_REQUIRED'
    : status === 503
      ? 'GOOGLE_OAUTH_UNAVAILABLE'
      : isAuthError
        ? 'GOOGLE_OAUTH_ERROR'
        : 'WORKSPACE_ERROR');
  return {
    success: false,
    error: isAuthError ? 'Connector not signed in' : message,
    code,
    badge: 'Connector not signed in',
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

/**
 * Live Gmail reader: fetches recent emails with snippet, sender, subject, date
 */
export async function readGmailEmails(options: {
  query?: string;
  maxResults?: number;
  allResults?: boolean;
} = {}): Promise<WorkspaceResponse> {
  try {
    const emails = await connectorManager.readEmails({
      query: options.query || 'in:inbox',
      max_results: options.maxResults || 5,
      all_results: Boolean(options.allResults)
    });
    return { success: true, data: emails };
  } catch (err: any) {
    return handleWorkspaceError(err);
  }
}

/**
 * Live Gmail inbox analysis: aggregates unread counts, top senders, and recent threads
 */
export async function analyzeGmailInbox(options: {
  query?: string;
  maxResults?: number;
} = {}): Promise<WorkspaceResponse> {
  try {
    const analysis = await connectorManager.analyzeInbox({
      query: options.query || 'in:inbox',
      max_results: options.maxResults || 10
    });
    return { success: true, data: analysis };
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
// 4. GOOGLE DRIVE & ZULORA DRIVE HANDLERS
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

/**
 * Saves uploaded image, generated MP4, or file artifact directly to Zulora Drive Storage & Firestore
 */
export async function saveToZuloraDrive(
  fileOrBlob: File | Blob,
  folderPath = 'AI Generated',
  fileName?: string
): Promise<WorkspaceResponse> {
  try {
    const file = fileOrBlob instanceof File
      ? fileOrBlob
      : new File([fileOrBlob], fileName || `artifact_${Date.now()}`, { type: fileOrBlob.type || 'application/octet-stream' });
    const uploaded = await zuloraDriveService.uploadFileToDrive(file, folderPath);
    return {
      success: true,
      data: uploaded,
      url: uploaded?.downloadURL || uploaded?.url
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to save to Zulora Drive',
      code: 'ZULORA_DRIVE_UPLOAD_FAILED'
    };
  }
}

/**
 * Retrieves files from Zulora Drive for current user
 */
export async function listZuloraDriveFiles(folderPath = ''): Promise<WorkspaceResponse> {
  try {
    const files = await zuloraDriveService.listFiles(folderPath);
    return { success: true, data: files };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to list Zulora Drive files',
      code: 'ZULORA_DRIVE_LIST_FAILED'
    };
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
    case 'gmail_read':
      return readGmailEmails({ query: params.query, maxResults: params.maxResults, allResults: params.allResults });
    case 'gmail_analyze':
      return analyzeGmailInbox({ query: params.query, maxResults: params.maxResults });
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
    case 'zulora_drive_save':
      return saveToZuloraDrive(params.file, params.folderPath, params.fileName);
    case 'zulora_drive_list':
      return listZuloraDriveFiles(params.folderPath);
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
  readGmailEmails,
  analyzeGmailInbox,
  createGoogleSheet,
  readGoogleSheet,
  appendGoogleSheetData,
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  searchDriveFiles,
  createDriveFolder,
  saveToZuloraDrive,
  listZuloraDriveFiles,
  createGoogleForm,
  executeWorkspaceAction,
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URIS,
  GOOGLE_DEFAULT_REDIRECT_URI,
  GOOGLE_WORKSPACE_SCOPES
};
