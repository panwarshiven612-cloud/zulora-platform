import connectorManager from './connectorManager';
import { scanComputerSystem } from './browserAgentEngine';

const text = description => ({ type: 'STRING', description });
const integer = description => ({ type: 'INTEGER', description });
const rowValues = { type: 'ARRAY', description: 'Rows to append; each row is an array of cell values.', items: { type: 'ARRAY', items: { type: 'STRING' } } };
const fn = (provider, description, properties, required = []) => ({ provider, description, parameters: { type: 'OBJECT', properties, ...(required.length ? { required } : {}) } });

function normalizeToolSchema(schema, typeCase, { openAi = false } = {}) {
  const normalized = {};
  const type = String(schema?.type || '').toUpperCase();
  if (type) normalized.type = typeCase === 'lower' ? type.toLowerCase() : type;
  if (typeof schema?.description === 'string') normalized.description = schema.description;
  if (Array.isArray(schema?.enum)) normalized.enum = schema.enum;
  if (Array.isArray(schema?.required) && schema.required.length) normalized.required = schema.required;
  if (schema?.properties && typeof schema.properties === 'object') {
    normalized.properties = Object.fromEntries(Object.entries(schema.properties)
      .map(([key, value]) => [key, normalizeToolSchema(value, typeCase, { openAi })]));
  }
  if (schema?.items) normalized.items = normalizeToolSchema(schema.items, typeCase, { openAi });
  if (openAi && type === 'OBJECT') normalized.additionalProperties = false;
  return normalized;
}

export function toGeminiFunctionDeclaration({ name, description, parameters }) {
  return { name, description, parameters: normalizeToolSchema(parameters, 'upper') };
}

export function toOpenAiFunctionTool({ name, description, parameters }, { closeObjects = true } = {}) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: normalizeToolSchema(parameters, 'lower', { openAi: closeObjects })
    }
  };
}

const snakeCase = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

export function normalizeGoogleConnectorArguments(rawArguments, functionName = '') {
  let parsed = rawArguments;
  if (typeof parsed === 'string') {
    const source = parsed.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    try { parsed = JSON.parse(source); }
    catch {
      const objectStart = source.indexOf('{');
      const objectEnd = source.lastIndexOf('}');
      if (objectStart < 0 || objectEnd <= objectStart) throw new Error(`The ${functionName || 'connector'} tool returned malformed JSON arguments.`);
      try { parsed = JSON.parse(source.slice(objectStart, objectEnd + 1)); }
      catch { throw new Error(`The ${functionName || 'connector'} tool returned malformed JSON arguments.`); }
    }
  }
  if (parsed == null) parsed = {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The ${functionName || 'connector'} tool arguments must be a JSON object.`);
  }
  for (const wrapper of ['arguments', 'args', 'input', 'parameters']) {
    if (typeof parsed[wrapper] === 'string') return normalizeGoogleConnectorArguments(parsed[wrapper], functionName);
    if (parsed[wrapper] && typeof parsed[wrapper] === 'object' && !Array.isArray(parsed[wrapper])) {
      parsed = parsed[wrapper];
      break;
    }
  }
  const normalizeKeys = value => Array.isArray(value)
    ? value.map(normalizeKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeCase(key), normalizeKeys(item)]))
      : value;
  const args = normalizeKeys(parsed);
  if (!args.to) args.to = args.recipient || args.email_to || args.recipient_email || args.email;
  if (!args.subject) args.subject = args.email_subject;
  if (!args.body) args.body = args.body_html || args.email_body || args.message_body || args.message || args.content || args.text;
  if (!args.title) args.title = args.summary || args.spreadsheet_title;
  if (!args.name) args.name = args.folder_name;
  if (args.max_results !== undefined && args.max_results !== '') {
    const maxResults = Number(args.max_results);
    if (Number.isFinite(maxResults)) args.max_results = maxResults;
  }
  return args;
}

const GOOGLE_FUNCTIONS = Object.freeze({
  workspace_create_folder_sheet_email_metrics: fn('workspace', 'Run a verified, ordered workflow: create a Google Drive folder, create and format a Google spreadsheet inside it, read sent Gmail metrics, then write those metrics into the spreadsheet. Use the names and optional Gmail query supplied by the user.', {
    folder_name: text('Name for the new Google Drive folder'),
    spreadsheet_title: text('Title for the new Google spreadsheet'),
    gmail_query: text('Optional Gmail search query; defaults to in:sent')
  }, ['folder_name', 'spreadsheet_title']),
  gmail_send_email: fn('gmail', 'Send an email only when the user explicitly asks to send it. The Gmail connector formats the body as a responsive HTML email and confirms success with a message ID and thread ID. Never claim delivery unless this function succeeds.', { recipient: text('Recipient email address'), subject: text('Email subject'), body_html: text('Email body as HTML or plain text; do not return source code unless the user asks for code') }, ['recipient', 'subject', 'body_html']),
  gmail_read_inbox: fn('gmail', 'Fetch recent, real messages from the connected Gmail inbox.', { max_results: integer('Number of recent inbox messages, from 1 to 20') }),
  gmail_search_messages: fn('gmail', 'Search Gmail and return matching messages with their sender, subject, date, and content.', { query: text('Gmail search expression, such as from:person@example.com or newer_than:7d') }, ['query']),
  calendar_create_event: fn('calendar', 'Create a Google Calendar event and return the event ID from the Calendar API. Use ISO 8601 times with timezone.', { summary: text('Event title'), start_time: text('ISO 8601 start time with timezone'), end_time: text('ISO 8601 end time with timezone'), description: text('Optional event description') }, ['summary', 'start_time', 'end_time']),
  calendar_list_events: fn('calendar', 'Retrieve upcoming Google Calendar events in the requested time window.', { time_min: text('ISO 8601 start time with timezone'), time_max: text('ISO 8601 end time with timezone') }, ['time_min', 'time_max']),
  sheets_create_spreadsheet: fn('sheets', 'Create a Google spreadsheet. If folder_id is supplied, place it in that Google Drive folder.', { title: text('New spreadsheet title'), folder_id: text('Optional Google Drive folder ID') }, ['title']),
  sheets_append_data: fn('sheets', 'Append one or more rows to a Google spreadsheet using an A1 notation range.', { spreadsheet_id: text('Spreadsheet ID from its URL'), range: text('A1 notation range, for example Sheet1!A:Z'), values: rowValues }, ['spreadsheet_id', 'range', 'values']),
  drive_create_folder: fn('drive', 'Create a new folder in the connected Google Drive account.', { folder_name: text('New folder name') }, ['folder_name']),
  computer_scan_system: fn('computer', 'Ask the installed Zulora Computer Plugin over its live extension IPC bridge for a browser and active-tab scan. Report only the returned scan fields; never simulate a scan.', { scope: { type: 'STRING', enum: ['active_browser'], description: 'Scan the connected browser agent and the active tab.' } }, ['scope']),
  send_email: fn('gmail', 'Send an email from the active Gmail account. Only call when the user explicitly asks to send it. Construct rich HTML in the body silently.', { to: text('Recipient email address'), subject: text('Email subject'), body: text('Email body (HTML or text)') }, ['to', 'subject', 'body']),
  send_rich_email: fn('gmail', 'Construct and send rich HTML emails in the background using UTF-8 encoding. Do not output raw HTML in final chat response unless asked.', { to: text('Recipient email address'), subject: text('Email subject'), body: text('Rich HTML email body') }, ['to', 'subject', 'body']),
  reply_and_draft: fn('gmail', 'Automatically compose drafts and reply to email threads based on user directive.', { to: text('Recipient email address'), subject: text('Email subject'), body: text('Email body (HTML or text)'), thread_id: text('Optional thread ID to reply to'), is_draft: { type: 'BOOLEAN', description: 'True to save as draft instead of sending' } }, ['to', 'subject', 'body']),
  analyze_inbox: fn('gmail', 'Read, filter, inspect, and summarize inbox messages (e.g., analyze all my emails, count today emails, highlight urgent senders).', { query: text('Gmail search query e.g. "in:inbox" or "newer_than:1d"'), max_results: integer('Number of messages, from 1 to 50') }),
  read_inbox: fn('gmail', 'Read recent Gmail messages matching a Gmail search query.', { query: text('Gmail search query'), max_results: integer('Number of messages, from 1 to 20') }, ['query']),
  summarize_emails: fn('gmail', 'Fetch Gmail messages for the requested period or query so you can summarize their contents.', { query: text('Gmail search query, for example newer_than:7d'), max_results: integer('Number of messages, from 1 to 20') }, ['query']),
  search_threads: fn('gmail', 'Search and return full matching Gmail conversation threads.', { query: text('Gmail search query'), max_results: integer('Number of threads, from 1 to 20') }, ['query']),
  create_event: fn('calendar', 'Create an event in Google Calendar. Use ISO 8601 times including timezone.', { title: text('Event title'), start_time: text('ISO 8601 start time with timezone'), end_time: text('ISO 8601 end time with timezone'), description: text('Optional description') }, ['title', 'start_time', 'end_time']),
  schedule_events: fn('calendar', 'Book single meetings or batch-schedule weekly routines/tasks via Calendar API.', {
    title: text('Title if single event'), start_time: text('Start time if single event'), end_time: text('End time if single event'), description: text('Optional description'),
    events: { type: 'ARRAY', description: 'Batch events list', items: { type: 'OBJECT', properties: { title: text('Event title'), start_time: text('Start time'), end_time: text('End time'), description: text('Description') } } }
  }),
  analyze_calendar: fn('calendar', 'Fetch and inspect upcoming schedule (e.g., analyze all my meetings, show my weekly schedule, find free slots).', { time_min: text('ISO 8601 start time'), time_max: text('ISO 8601 end time') }),
  list_events: fn('calendar', 'List events in Google Calendar for the requested time range.', { time_min: text('ISO 8601 start time'), time_max: text('ISO 8601 end time') }, ['time_min', 'time_max']),
  delete_event: fn('calendar', 'Delete a specific Google Calendar event only when the user explicitly requests deletion.', { event_id: text('Calendar event ID') }, ['event_id']),
  append_row: fn('sheets', 'Append one or more rows to a Google Sheet.', { spreadsheet_id: text('Spreadsheet ID from its URL'), range: text('A1 notation range'), values: rowValues }, ['spreadsheet_id', 'range', 'values']),
  read_range: fn('sheets', 'Read values from a Google Sheet range.', { spreadsheet_id: text('Spreadsheet ID from its URL'), range: text('A1 notation range') }, ['spreadsheet_id', 'range']),
  create_sheet: fn('sheets', 'Create a new Google spreadsheet with the given title.', { title: text('New spreadsheet title') }, ['title']),
  create_drive_folder: fn('drive', 'Create a new Google Drive folder with the given name.', { name: text('New folder name') }, ['name']),
  get_form: fn('forms', 'Read a Google Form structure by form ID.', { form_id: text('Google Form ID') }, ['form_id']),
  read_form_responses: fn('forms', 'Read responses from a Google Form by form ID.', { form_id: text('Google Form ID'), max_results: integer('Maximum responses, from 1 to 500') }, ['form_id']),
  create_form: fn('forms', 'Create a new Google Form with a title, optional description, and an optional list of questions. Each question has: title (string), type (text|paragraph|multiple_choice|checkbox), required (boolean), options (array of strings for choice types).', {
    title: text('Form title'),
    description: text('Optional form description'),
    questions: { type: 'ARRAY', description: 'Array of question objects with title, type, required, options fields', items: { type: 'OBJECT', properties: { title: text('Question text'), type: text('text, paragraph, multiple_choice, or checkbox'), required: { type: 'BOOLEAN', description: 'Whether question is required' }, options: { type: 'ARRAY', description: 'Options for choice questions', items: { type: 'STRING' } } } } }
  }, ['title']),
  manage_files: fn('drive', 'List or inspect Google Drive files, or move a file to trash when the user explicitly requests it.', { action: { type: 'STRING', enum: ['list', 'get', 'trash'], description: 'Drive action' }, file_id: text('File ID for get or trash'), name: text('Optional file name search for list'), max_results: integer('Maximum file results') }, ['action']),
  download_file: fn('drive', 'Download a Google Drive file for inline analysis. Only files up to 2 MB are returned.', { file_id: text('Google Drive file ID') }, ['file_id']),
  list_drive: fn('drive', 'List recent Google Drive files or search for files by name.', { query: text('Optional file name search'), max_results: integer('Maximum results, from 1 to 100') }),
  // Keep the earlier function names enabled for chats and providers that still emit them.
  send_gmail: fn('gmail', 'Send an email from Gmail.', { to: text('Recipient email address'), subject: text('Email subject'), body: text('Email body') }, ['to', 'subject', 'body']),
  read_emails: fn('gmail', 'Search and read recent Gmail messages.', { query: text('Gmail search query'), max_results: integer('Number of messages') }, ['query']),
  create_calendar_event: fn('calendar', 'Create a Google Calendar event.', { title: text('Event title'), start_time: text('ISO 8601 start time'), end_time: text('ISO 8601 end time'), description: text('Optional description') }, ['title', 'start_time', 'end_time']),
  get_calendar_events: fn('calendar', 'List Google Calendar events.', { time_min: text('ISO 8601 start'), time_max: text('ISO 8601 end') }, ['time_min', 'time_max']),
  append_sheet_row: fn('sheets', 'Append rows to a Google Sheet.', { spreadsheet_id: text('Spreadsheet ID'), range: text('A1 range'), values: rowValues }, ['spreadsheet_id', 'range', 'values']),
  read_sheet_data: fn('sheets', 'Read a Google Sheet range.', { spreadsheet_id: text('Spreadsheet ID'), range: text('A1 range') }, ['spreadsheet_id', 'range'])
});

export function getGoogleConnectorFunctionDeclarations(activeProviders = connectorManager.getActiveGoogleProviders(), prompt = '') {
  const providers = new Set(activeProviders);
  const workspaceWorkflow = isWorkspaceMetricsWorkflowRequest(prompt)
    && ['drive', 'sheets', 'gmail'].every(provider => providers.has(provider));
  const names = [
    ...(providers.has('gmail') ? ['gmail_read_inbox', 'gmail_send_email', 'gmail_search_messages', 'reply_and_draft'] : []),
    ...(providers.has('calendar') ? ['calendar_list_events', 'calendar_create_event', 'delete_event'] : []),
    ...(providers.has('sheets') ? ['sheets_create_spreadsheet', 'sheets_append_data', 'read_range'] : []),
    ...(providers.has('drive') ? ['drive_create_folder', 'list_drive', 'manage_files', 'download_file'] : []),
    ...(providers.has('forms') ? ['get_form', 'read_form_responses', 'create_form'] : []),
    ...(providers.has('computer') ? ['computer_scan_system'] : []),
    ...(workspaceWorkflow ? ['workspace_create_folder_sheet_email_metrics'] : [])
  ];
  if (!names.length) return [];
  return names.filter(name => GOOGLE_FUNCTIONS[name])
    .map(name => ({ name, description: GOOGLE_FUNCTIONS[name].description, parameters: GOOGLE_FUNCTIONS[name].parameters }));
}

export function isWorkspaceMetricsWorkflowRequest(prompt = '') {
  const text = String(prompt || '').toLowerCase();
  const asksFolder = /\b(?:create|make|add|set\s+up)\b.{0,60}\b(?:folder|directory)\b|\b(?:folder|directory)\b.{0,60}\b(?:create|make|add)\b/i.test(text);
  const asksSpreadsheet = /\b(?:spreadsheet|google\s*sheet|sheets)\b/i.test(text)
    && /\b(?:create|make|build|new|populate|fill|write|add)\b/i.test(text);
  const asksSentMetrics = /\b(?:gmail|sent\s+(?:emails?|mail)|email(?:s)?\s+stats?)\b/i.test(text)
    && /\b(?:stats?|metrics?|count|how\s+many|read|fetch|retrieve|analy[sz]e|report|populate)\b/i.test(text);
  return asksFolder && asksSpreadsheet && asksSentMetrics;
}

export function classifyGoogleConnectorIntents(prompt = '') {
  const text = String(prompt || '').toLowerCase();
  const intents = [];
  if (/\b(?:gmail|inbox|e-?mails?|mail messages?)\b/.test(text)
    && /\b(?:send|read|review|summari[sz]e|draft|compose|search|check|show|list|find|retrieve|fetch|latest|recent|analy[sz]e|stats?|metrics?|count|how\s+many)\b/.test(text)) intents.push('gmail');
  if (/\b(?:spreadsheet|google\s*sheets?)\b/.test(text)
    && /\b(?:read|append|write|update|add|create|make|populate|fill|list|show|find|search|format)\b/.test(text)) intents.push('sheets');
  if (/\b(?:drive|folder|directory|drive\s+file)\b/.test(text)
    && /\b(?:list|show|search|find|download|open|manage|delete|trash|inspect|create|make|move)\b/.test(text)) intents.push('drive');
  if (/\b(?:calendar|events?|meetings?|appointments?)\b/.test(text)
    && /\b(?:schedule|book|create|list|show|check|find|delete|remove|cancel|upcoming|analy[sz]e)\b/.test(text)) intents.push('calendar');
  if (/\b(?:google\s+)?forms?\b/.test(text)
    && /\b(?:read|create|make|build|show|list|responses?)\b/.test(text)) intents.push('forms');
  return [...new Set(intents)];
}

export function getGoogleConnectorToolInstructions(activeProviders = connectorManager.getActiveGoogleProviders()) {
  const providers = new Set(activeProviders);
  const labels = ['gmail', 'calendar', 'sheets', 'forms', 'drive', 'computer'].filter(provider => providers.has(provider))
    .map(provider => ({ gmail: 'Gmail', calendar: 'Google Calendar', sheets: 'Google Sheets', forms: 'Google Forms', drive: 'Google Drive', computer: 'the Zulora Computer Plugin' })[provider]);
  if (!labels.length) return '';
  return `You are equipped with active connectors for ${labels.join(', ')}. When a request asks you to send or read email, analyze inbox, compose drafts, schedule or list or analyze calendar events, read or write Sheets, inspect Forms, find/download/manage Drive files, or scan the computer, call the matching connector function using the live connected API or extension. Never claim an action succeeded until its function result confirms success. When sending or drafting emails, construct clean, professional HTML in the body. Do NOT output raw HTML in your chat response unless the user explicitly requested source code. Never claim you lack access when a connector function is available.`;
}

export function getGoogleConnectorFunctionProvider(name) {
  return GOOGLE_FUNCTIONS[name]?.provider || '';
}

const requiredText = (args, key) => {
  const value = String(args?.[key] || '').trim();
  if (!value) throw new Error(`The ${key.replaceAll('_', ' ')} is required.`);
  return value;
};

export async function executeGoogleConnectorFunction(name, args = {}, { onProgress } = {}) {
  const provider = getGoogleConnectorFunctionProvider(name);
  onProgress?.({ label: `Authenticating ${provider || 'Google'} API`, status: 'running' });
  try {
    let result;
    switch (name) {
      case 'workspace_create_folder_sheet_email_metrics':
        result = await connectorManager.createFolderSpreadsheetEmailMetrics({
          folder_name: requiredText(args, 'folder_name'),
          spreadsheet_title: requiredText(args, 'spreadsheet_title'),
          gmail_query: String(args.gmail_query || 'in:sent'),
          onProgress
        });
        break;
      case 'gmail_send_email': case 'send_email': case 'send_gmail': case 'send_rich_email':
        result = await connectorManager.sendGmailMessage({ to: requiredText(args, 'to'), subject: requiredText(args, 'subject'), body: requiredText(args, 'body') }); break;
      case 'reply_and_draft':
        result = await connectorManager.replyAndDraft({
          to: requiredText(args, 'to'),
          subject: requiredText(args, 'subject'),
          body: requiredText(args, 'body'),
          thread_id: args.thread_id,
          is_draft: Boolean(args.is_draft)
        }); break;
      case 'analyze_inbox':
        result = await connectorManager.analyzeInbox({ query: String(args.query || 'in:inbox'), max_results: Math.min(50, Math.max(1, Number(args.max_results) || 10)) }); break;
      case 'gmail_read_inbox': case 'read_inbox': case 'summarize_emails': case 'read_emails':
        result = await connectorManager.readEmails({ query: String(args.query || 'in:inbox'), max_results: Math.min(20, Math.max(1, Number(args.max_results) || 5)) }); break;
      case 'gmail_search_messages':
        result = await connectorManager.readEmails({ query: requiredText(args, 'query'), max_results: Math.min(20, Math.max(1, Number(args.max_results) || 10)) }); break;
      case 'search_threads':
        result = await connectorManager.searchGmailThreads({ query: String(args.query || 'in:inbox'), max_results: args.max_results }); break;
      case 'calendar_create_event': case 'create_event': case 'create_calendar_event':
        result = await connectorManager.createCalendarEvent({ title: requiredText(args, 'title'), start_time: requiredText(args, 'start_time'), end_time: requiredText(args, 'end_time'), description: String(args.description || '') }); break;
      case 'computer_scan_system':
        result = await scanComputerSystem(); break;
      case 'schedule_events':
        result = await connectorManager.scheduleEvents({
          events: args.events,
          title: args.title,
          start_time: args.start_time,
          end_time: args.end_time,
          description: args.description
        }); break;
      case 'analyze_calendar':
        result = await connectorManager.analyzeCalendar({ time_min: args.time_min, time_max: args.time_max }); break;
      case 'calendar_list_events': case 'list_events': case 'get_calendar_events':
        result = await connectorManager.getCalendarEvents({ time_min: requiredText(args, 'time_min'), time_max: requiredText(args, 'time_max') }); break;
      case 'delete_event':
        result = await connectorManager.deleteCalendarEvent({ event_id: requiredText(args, 'event_id') }); break;
      case 'sheets_append_data': case 'append_row': case 'append_sheet_row': {
        const values = Array.isArray(args.values) ? args.values : [];
        if (!values.length) throw new Error('At least one row of values is required.');
        result = await connectorManager.appendSheetRow({ spreadsheet_id: requiredText(args, 'spreadsheet_id'), range: requiredText(args, 'range'), values }); break;
      }
      case 'read_range': case 'read_sheet_data':
        result = await connectorManager.readSheetData({ spreadsheet_id: requiredText(args, 'spreadsheet_id'), range: requiredText(args, 'range') }); break;
      case 'sheets_create_spreadsheet': case 'create_sheet':
        result = await connectorManager.createSpreadsheet({ title: requiredText(args, 'title'), folder_id: String(args.folder_id || '').trim() }); break;
      case 'drive_create_folder': case 'create_drive_folder':
        result = await connectorManager.createDriveFolder({ name: requiredText(args, 'name') }); break;
      case 'get_form':
        result = await connectorManager.getGoogleForm({ form_id: requiredText(args, 'form_id') }); break;
      case 'create_form':
        result = await connectorManager.createGoogleForm({
          title: requiredText(args, 'title'),
          description: String(args.description || ''),
          questions: Array.isArray(args.questions) ? args.questions : []
        });
        result = { ...result, message: `✅ Google Form created! [Edit Form](${result.formUrl}) · [Preview](${result.viewUrl})` };
        break;
      case 'read_form_responses':
        result = await connectorManager.getGoogleFormResponses({ form_id: requiredText(args, 'form_id'), max_results: args.max_results }); break;
      case 'manage_files':
        result = await connectorManager.manageGoogleDriveFile({ action: String(args.action || 'list'), file_id: String(args.file_id || ''), name: String(args.name || ''), max_results: args.max_results }); break;
      case 'download_file':
        result = await connectorManager.downloadGoogleDriveFile({ file_id: requiredText(args, 'file_id') }); break;
      case 'list_drive':
        result = await connectorManager.listGoogleDriveFiles({ query: String(args.query || ''), max_results: args.max_results }); break;
      default: throw new Error(`Unknown Google connector function: ${name}`);
    }
    onProgress?.({ label: `${provider || 'Google'} request complete`, status: 'done' });
    return result;
  } catch (error) {
    if (provider === 'workspace' && !error.connectorProvider) {
      const message = String(error.message || '');
      error.connectorProvider = /(?:Google\s+)?Drive/i.test(message) ? 'drive'
        : /(?:Google\s+)?Sheets/i.test(message) ? 'sheets'
          : /Gmail/i.test(message) ? 'gmail' : 'workspace';
    }
    onProgress?.({ label: `${provider || 'Google'} request failed`, status: 'error', detail: error.message });
    throw error;
  }
}

export function isGoogleReconnectError(error) {
  return error?.code === 'OAUTH_REQUIRED' || /HTTP\s*(401|403)|needs to be connected again|reconnect|token.{0,20}(expired|invalid)|OAuth Permission Required/i.test(String(error?.message || error || ''));
}
