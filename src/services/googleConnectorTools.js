import connectorManager from './connectorManager';

const stringSchema = description => ({ type: 'STRING', description });
const GOOGLE_FUNCTIONS = Object.freeze({
  send_gmail: {
    provider: 'gmail',
    description: 'Send an email from the connected Gmail account. Only call when the user asked to send it.',
    parameters: {
      type: 'OBJECT',
      properties: { to: stringSchema('Recipient email address'), subject: stringSchema('Email subject'), body: stringSchema('Email body') },
      required: ['to', 'subject', 'body']
    }
  },
  read_emails: {
    provider: 'gmail',
    description: 'Search and read recent messages from the connected Gmail account.',
    parameters: {
      type: 'OBJECT',
      properties: { query: stringSchema('Gmail search query, such as newer_than:7d or from:person@example.com'), max_results: { type: 'INTEGER', description: 'Maximum number of messages to return, from 1 to 20' } },
      required: ['query']
    }
  },
  create_calendar_event: {
    provider: 'calendar',
    description: 'Create an event in the connected Google Calendar. Use ISO 8601 start and end times with a timezone.',
    parameters: {
      type: 'OBJECT',
      properties: { title: stringSchema('Event title'), start_time: stringSchema('ISO 8601 start time with timezone'), end_time: stringSchema('ISO 8601 end time with timezone'), description: stringSchema('Optional event description') },
      required: ['title', 'start_time', 'end_time']
    }
  },
  get_calendar_events: {
    provider: 'calendar',
    description: 'List events from the connected Google Calendar within the requested time range.',
    parameters: {
      type: 'OBJECT',
      properties: { time_min: stringSchema('ISO 8601 start of the time range'), time_max: stringSchema('ISO 8601 end of the time range') },
      required: ['time_min', 'time_max']
    }
  },
  append_sheet_row: {
    provider: 'sheets',
    description: 'Append one or more rows to a range in a connected Google spreadsheet.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spreadsheet_id: stringSchema('Google spreadsheet ID from its URL'),
        range: stringSchema('A1 notation range, including the sheet name when known'),
        values: { type: 'ARRAY', description: 'Rows to append; each row is an array of cell values', items: { type: 'ARRAY', items: { type: 'STRING' } } }
      },
      required: ['spreadsheet_id', 'range', 'values']
    }
  },
  read_sheet_data: {
    provider: 'sheets',
    description: 'Read values from an A1 notation range in a connected Google spreadsheet.',
    parameters: {
      type: 'OBJECT',
      properties: { spreadsheet_id: stringSchema('Google spreadsheet ID from its URL'), range: stringSchema('A1 notation range, including the sheet name') },
      required: ['spreadsheet_id', 'range']
    }
  }
});

export function getGoogleConnectorFunctionDeclarations(activeProviders = connectorManager.getActiveGoogleProviders()) {
  const providers = new Set(activeProviders);
  return Object.entries(GOOGLE_FUNCTIONS)
    .filter(([, declaration]) => providers.has(declaration.provider))
    .map(([name, declaration]) => ({ name, description: declaration.description, parameters: declaration.parameters }));
}

export function getGoogleConnectorToolInstructions(activeProviders = connectorManager.getActiveGoogleProviders()) {
  const labels = [...new Set(activeProviders.map(provider => ({ gmail: 'Gmail', calendar: 'Google Calendar', sheets: 'Google Sheets' }[provider])).filter(Boolean))];
  if (!labels.length) return '';
  const actions = [
    activeProviders.includes('calendar') ? 'schedule a meeting or list calendar events' : '',
    activeProviders.includes('gmail') ? 'send an email or read and summarize emails' : '',
    activeProviders.includes('sheets') ? 'read or write spreadsheet data' : ''
  ].filter(Boolean);
  return `You are equipped with active connectors for ${labels.join(', ')}. When the user asks to ${actions.join(', ')}, ALWAYS call the corresponding connector tool using the user's active session. Never claim you lack access if a connector tool is available. Ask a concise follow-up if a required detail is missing. Only report an action as successful after its connector tool returns success.`;
}

const requiredText = (args, key) => {
  const value = String(args?.[key] || '').trim();
  if (!value) throw new Error(`The ${key.replaceAll('_', ' ')} is required.`);
  return value;
};

export async function executeGoogleConnectorFunction(name, args = {}) {
  switch (name) {
    case 'send_gmail':
      return connectorManager.sendGmailMessage({ to: requiredText(args, 'to'), subject: requiredText(args, 'subject'), body: requiredText(args, 'body') });
    case 'read_emails':
      return connectorManager.readEmails({ query: String(args.query || 'in:inbox'), max_results: Math.min(20, Math.max(1, Number(args.max_results) || 5)) });
    case 'create_calendar_event':
      return connectorManager.createCalendarEvent({
        title: requiredText(args, 'title'),
        start_time: requiredText(args, 'start_time'),
        end_time: requiredText(args, 'end_time'),
        description: String(args.description || '')
      });
    case 'get_calendar_events':
      return connectorManager.getCalendarEvents({ time_min: requiredText(args, 'time_min'), time_max: requiredText(args, 'time_max') });
    case 'append_sheet_row': {
      const values = Array.isArray(args.values) ? args.values : [];
      if (!values.length) throw new Error('At least one row of values is required.');
      return connectorManager.appendSheetRow({ spreadsheet_id: requiredText(args, 'spreadsheet_id'), range: requiredText(args, 'range'), values });
    }
    case 'read_sheet_data':
      return connectorManager.readSheetData({ spreadsheet_id: requiredText(args, 'spreadsheet_id'), range: requiredText(args, 'range') });
    default:
      throw new Error(`Unknown Google connector function: ${name}`);
  }
}

export function isGoogleReconnectError(error) {
  return /HTTP\s*(401|403)|needs to be connected again|reconnect|token.{0,20}(expired|invalid)/i.test(String(error?.message || error || ''));
}
