import connectorManager from './connectorManager';

const text = description => ({ type: 'STRING', description });
const integer = description => ({ type: 'INTEGER', description });
const rowValues = { type: 'ARRAY', description: 'Rows to append; each row is an array of cell values.', items: { type: 'ARRAY', items: { type: 'STRING' } } };
const fn = (provider, description, properties, required = []) => ({ provider, description, parameters: { type: 'OBJECT', properties, ...(required.length ? { required } : {}) } });

const GOOGLE_FUNCTIONS = Object.freeze({
  send_email: fn('gmail', 'Send an email from the active Gmail account. Only call when the user explicitly asks to send it.', { to: text('Recipient email address'), subject: text('Email subject'), body: text('Email body') }, ['to', 'subject', 'body']),
  read_inbox: fn('gmail', 'Read recent Gmail messages matching a Gmail search query.', { query: text('Gmail search query'), max_results: integer('Number of messages, from 1 to 20') }, ['query']),
  summarize_emails: fn('gmail', 'Fetch Gmail messages for the requested period or query so you can summarize their contents.', { query: text('Gmail search query, for example newer_than:7d'), max_results: integer('Number of messages, from 1 to 20') }, ['query']),
  search_threads: fn('gmail', 'Search and return full matching Gmail conversation threads.', { query: text('Gmail search query'), max_results: integer('Number of threads, from 1 to 20') }, ['query']),
  create_event: fn('calendar', 'Create an event in Google Calendar. Use ISO 8601 times including timezone.', { title: text('Event title'), start_time: text('ISO 8601 start time with timezone'), end_time: text('ISO 8601 end time with timezone'), description: text('Optional description') }, ['title', 'start_time', 'end_time']),
  list_events: fn('calendar', 'List events in Google Calendar for the requested time range.', { time_min: text('ISO 8601 start time'), time_max: text('ISO 8601 end time') }, ['time_min', 'time_max']),
  delete_event: fn('calendar', 'Delete a specific Google Calendar event only when the user explicitly requests deletion.', { event_id: text('Calendar event ID') }, ['event_id']),
  append_row: fn('sheets', 'Append one or more rows to a Google Sheet.', { spreadsheet_id: text('Spreadsheet ID from its URL'), range: text('A1 notation range'), values: rowValues }, ['spreadsheet_id', 'range', 'values']),
  read_range: fn('sheets', 'Read values from a Google Sheet range.', { spreadsheet_id: text('Spreadsheet ID from its URL'), range: text('A1 notation range') }, ['spreadsheet_id', 'range']),
  create_sheet: fn('sheets', 'Create a new Google spreadsheet with the given title.', { title: text('New spreadsheet title') }, ['title']),
  get_form: fn('forms', 'Read a Google Form structure by form ID.', { form_id: text('Google Form ID') }, ['form_id']),
  read_form_responses: fn('forms', 'Read responses from a Google Form by form ID.', { form_id: text('Google Form ID'), max_results: integer('Maximum responses, from 1 to 500') }, ['form_id']),
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

export function getGoogleConnectorFunctionDeclarations(activeProviders = connectorManager.getActiveGoogleProviders()) {
  const providers = new Set(activeProviders);
  return Object.entries(GOOGLE_FUNCTIONS)
    .filter(([, declaration]) => providers.has(declaration.provider))
    .map(([name, declaration]) => ({ name, description: declaration.description, parameters: declaration.parameters }));
}

export function getGoogleConnectorToolInstructions(activeProviders = connectorManager.getActiveGoogleProviders()) {
  const providers = new Set(activeProviders);
  const labels = ['gmail', 'calendar', 'sheets', 'forms', 'drive'].filter(provider => providers.has(provider))
    .map(provider => ({ gmail: 'Gmail', calendar: 'Google Calendar', sheets: 'Google Sheets', forms: 'Google Forms', drive: 'Google Drive' })[provider]);
  if (!labels.length) return '';
  return `You are equipped with active connectors for ${labels.join(', ')}. When a request asks you to send or read email, summarize email threads, schedule or list or delete a calendar event, read or write Sheets, inspect Forms, or find/download/manage Drive files, call the matching connector function immediately using the user's active session. Never claim you lack access when a connector function is available. Ask a concise follow-up if required details are missing. Only claim a write or deletion succeeded after its function returns success. Never delete or trash anything unless the user explicitly asked for that action.`;
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
      case 'send_email': case 'send_gmail':
        result = await connectorManager.sendGmailMessage({ to: requiredText(args, 'to'), subject: requiredText(args, 'subject'), body: requiredText(args, 'body') }); break;
      case 'read_inbox': case 'summarize_emails': case 'read_emails':
        result = await connectorManager.readEmails({ query: String(args.query || 'in:inbox'), max_results: Math.min(20, Math.max(1, Number(args.max_results) || 5)) }); break;
      case 'search_threads':
        result = await connectorManager.searchGmailThreads({ query: String(args.query || 'in:inbox'), max_results: args.max_results }); break;
      case 'create_event': case 'create_calendar_event':
        result = await connectorManager.createCalendarEvent({ title: requiredText(args, 'title'), start_time: requiredText(args, 'start_time'), end_time: requiredText(args, 'end_time'), description: String(args.description || '') }); break;
      case 'list_events': case 'get_calendar_events':
        result = await connectorManager.getCalendarEvents({ time_min: requiredText(args, 'time_min'), time_max: requiredText(args, 'time_max') }); break;
      case 'delete_event':
        result = await connectorManager.deleteCalendarEvent({ event_id: requiredText(args, 'event_id') }); break;
      case 'append_row': case 'append_sheet_row': {
        const values = Array.isArray(args.values) ? args.values : [];
        if (!values.length) throw new Error('At least one row of values is required.');
        result = await connectorManager.appendSheetRow({ spreadsheet_id: requiredText(args, 'spreadsheet_id'), range: requiredText(args, 'range'), values }); break;
      }
      case 'read_range': case 'read_sheet_data':
        result = await connectorManager.readSheetData({ spreadsheet_id: requiredText(args, 'spreadsheet_id'), range: requiredText(args, 'range') }); break;
      case 'create_sheet':
        result = await connectorManager.createSpreadsheet({ title: requiredText(args, 'title') }); break;
      case 'get_form':
        result = await connectorManager.getGoogleForm({ form_id: requiredText(args, 'form_id') }); break;
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
    onProgress?.({ label: `${provider || 'Google'} request failed`, status: 'error', detail: error.message });
    throw error;
  }
}

export function isGoogleReconnectError(error) {
  return /HTTP\s*(401|403)|needs to be connected again|reconnect|token.{0,20}(expired|invalid)/i.test(String(error?.message || error || ''));
}
