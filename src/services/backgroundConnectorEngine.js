import connectorManager from './connectorManager';
import { driveAuth } from '../config/firebaseDrive';
import { uploadFileToDrive } from './zuloraDriveService';

const getHeader = (headers = [], name) => headers.find(header => header.name?.toLowerCase() === name)?.value || '';

export function extractMessageCount(prompt) {
  const text = String(prompt || '');
  const match = text.match(/\b(?:last|top|recent|latest|first)\s+(\d{1,3})\b/i)
    || text.match(/\b(\d{1,3})\s+(?:latest|recent|first|last)\s+(?:e-?mails?|gmails?|messages?)\b/i);
  if (/\ball\b.{0,30}\btoday\b|\btoday\b.{0,30}\ball\b/i.test(text)) return 500;
  if (/\b(?:few|several)\s+(?:latest|recent|newest)\b/i.test(text)) return 5;
  if (/\b(?:couple|two)\s+(?:latest|recent|newest)\b/i.test(text)) return 2;
  return Math.min(500, Math.max(1, Number(match?.[1]) || 5));
}

export function gmailQueryFromPrompt(prompt, now = new Date(), baseQuery = 'in:inbox') {
  const text = String(prompt || '');
  const base = String(baseQuery || 'in:inbox').trim();
  if (/\b(?:after|before|newer_than|older_than):/i.test(base)) return base;
  const dayCount = text.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/i);
  const start = new Date(now);
  let end;
  if (/\btoday\b/i.test(text)) {
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (/\byesterday\b/i.test(text)) {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (dayCount) {
    start.setDate(start.getDate() - Math.min(365, Number(dayCount[1]) || 1));
  } else {
    return base;
  }
  return `${base}${base ? ' ' : ''}after:${Math.floor(start.getTime() / 1000)}${end ? ` before:${Math.floor(end.getTime() / 1000)}` : ''}`;
}

export function detectConnectorTask(prompt) {
  const text = String(prompt || '').trim();
  const asksGmail = ( /\b(gmails?|inbox|e-?mails?|mail messages?)\b/i.test(text)
    || /\b(send|draft|compose)\b.{0,50}\bemail\b/i.test(text) )
    && /\b(read|review|summari[sz]e|check|find|search|fetch|get|retrieve|extract|tell|show|last|recent|latest|first|send|draft|inbox|today|all)\b/i.test(text);
  const asksCalendar = ( /\b(calendar|events?|meetings?|schedule|agenda)\b/i.test(text)
    || /\b(schedule|book|create)\b.{0,40}\b(meeting|appointment)\b/i.test(text) )
    && /\b(list|show|view|upcoming|schedule|agenda|create|add|book|delete|remove|cancel|tomorrow|today|last|past|next)\b/i.test(text);
  const asksForms = /\b(forms?|responses?)\b/i.test(text)
    && /\b(read|sync|fetch|show|list|responses?)\b/i.test(text);
  const asksGoogleDrive = /\bgoogle\s+drive\b/i.test(text)
    && /\b(list|show|search|find|download|open|manage|delete|trash|inspect)\b/i.test(text);
  const asksSheets = /\b(spreadsheet|google\s*sheets?|sheets?)\b/i.test(text)
    && /\b(read|append|add|write|update|summari[sz]e|export|put|save|create|make)\b/i.test(text);
  if (asksGmail) return 'gmail';
  if (asksCalendar) return 'calendar';
  if (asksForms) return 'forms';
  if (asksSheets) return 'sheets';
  if (asksGoogleDrive) return 'drive';
  return null;
}

async function readRecentGmail(count, query = 'in:inbox', readAll = false) {
  const ids = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ maxResults: String(readAll ? 500 : Math.min(500, count - ids.length)), q: query });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await connectorManager.apiFetch('gmail', `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
    if (!result || typeof result !== 'object' || (result.messages !== undefined && !Array.isArray(result.messages))
      || (!Array.isArray(result.messages) && !Number.isFinite(Number(result.resultSizeEstimate)))) {
      throw new Error('Gmail returned an invalid inbox response. No inbox result is reported.');
    }
    ids.push(...(result.messages || []));
    pageToken = result.nextPageToken || '';
  } while (pageToken && (readAll || ids.length < count));
  const selectedIds = readAll ? ids : ids.slice(0, count);
  const messages = await Promise.all(selectedIds.map(async item => {
    if (!item?.id) throw new Error('Gmail returned a message without an ID. No inbox result is reported.');
    const message = await connectorManager.apiFetch(
      'gmail',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
    );
    if (!message?.id || !message?.threadId) throw new Error('Gmail returned an invalid message record. No inbox result is reported.');
    const headers = message.payload?.headers || [];
    return {
      id: message.id,
      sender: getHeader(headers, 'from'),
      subject: getHeader(headers, 'subject') || '(no subject)',
      date: getHeader(headers, 'date'),
      preview: String(message.snippet || '').replace(/\s+/g, ' ').trim()
    };
  }));
  return messages;
}

function formatEmailReport(messages) {
  if (!messages.length) return 'Your Gmail inbox has no matching messages.';
  return [
    `Found ${messages.length} recent inbox email${messages.length === 1 ? '' : 's'}:`,
    '',
    ...messages.map((item, index) => [
      `${index + 1}. **${item.subject}**`,
      `   From: ${item.sender || 'Unknown sender'}`,
      `   Date: ${item.date || 'Unknown date'}`,
      `   Preview: ${item.preview || '(no preview)'}`
    ].join('\n'))
  ].join('\n');
}

function spreadsheetIdFromPrompt(prompt) {
  return String(prompt).match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/i)?.[1] || '';
}

async function getRecentSpreadsheets() {
  const query = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: 'modifiedTime desc',
    pageSize: '6',
    fields: 'files(id,name,modifiedTime,webViewLink)'
  });
  const result = await connectorManager.apiFetch(
    'drive',
    `https://www.googleapis.com/drive/v3/files?${query}`
  );
  return result.files || [];
}

async function appendRows(spreadsheetId, rows) {
  const metadata = await connectorManager.apiFetch(
    'sheets',
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`
  );
  const firstSheet = metadata.sheets?.[0]?.properties?.title || 'Sheet1';
  const range = encodeURIComponent(`'${firstSheet.replace(/'/g, "''")}'!A:D`);
  return connectorManager.apiFetch(
    'sheets',
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  );
}

async function writeSheetRange(spreadsheetId, range, rows) {
  const encodedRange = encodeURIComponent(range);
  return connectorManager.apiFetch(
    'sheets',
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: rows }) }
  );
}

async function autoSaveReport(provider, data, prompt) {
  // Google API results stay in the requested connector workflow unless the user
  // explicitly asks to copy or export the report to Zulora Drive.
  const asksForDriveCopy = /\b(?:save|store|copy|back\s*up|export)\b.{0,60}\b(?:zulora\s+)?drive\b|\b(?:zulora\s+)?drive\b.{0,60}\b(?:save|store|copy|back\s*up|export)\b/i.test(String(prompt || ''));
  if (!asksForDriveCopy) return '';
  if (!driveAuth.currentUser || !Array.isArray(data) || !data.length) return '';
  try {
    const file = new File(
      [JSON.stringify({ source: provider, generatedAt: new Date().toISOString(), data }, null, 2)],
      `${provider}-report-${Date.now()}.json`,
      { type: 'application/json' }
    );
    const saved = await uploadFileToDrive(file, 'AI Reports');
    return `\n\nSaved a copy to Zulora Drive as **${saved.name}**.`;
  } catch (error) {
    return `\n\nThe ${provider} report is ready, but Drive could not save its copy: ${error.message}`;
  }
}

export async function listConnectorSpreadsheets() {
  return getRecentSpreadsheets();
}

export async function listUpcomingCalendarEvents(maxResults = 8, { timeMin, timeMax } = {}) {
  const query = new URLSearchParams({
    timeMin: timeMin || new Date().toISOString(), maxResults: String(maxResults), singleEvents: 'true', orderBy: 'startTime'
  });
  if (timeMax) query.set('timeMax', timeMax);
  const result = await connectorManager.apiFetch(
    'calendar',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`
  );
  if (!result || typeof result !== 'object' || (result.items !== undefined && !Array.isArray(result.items))
    || (!Array.isArray(result.items) && result.kind !== 'calendar#events')) {
    throw new Error('Google Calendar returned an invalid event-list response. No schedule result is reported.');
  }
  return result.items || [];
}

export function parseCalendarTimeRange(prompt, now = new Date()) {
  const text = String(prompt || '').toLowerCase();
  const lastDays = text.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/);
  const nextDays = text.match(/\b(?:next|coming)\s+(\d{1,3})\s+days?\b/);
  const makeLocalDay = offset => {
    const start = new Date(now);
    start.setDate(start.getDate() + offset);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { timeMin: start.toISOString(), timeMax: end.toISOString() };
  };
  if (lastDays) {
    const timeMax = new Date(now);
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - Math.min(365, Number(lastDays[1]) || 1));
    return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
  }
  if (nextDays) {
    const timeMin = new Date(now);
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + Math.min(365, Number(nextDays[1]) || 1));
    return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
  }
  if (/\btomorrow\b/.test(text)) return makeLocalDay(1);
  if (/\btoday\b/.test(text)) return makeLocalDay(0);
  const date = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (date) {
    const target = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    target.setHours(0, 0, 0, 0);
    const end = new Date(target);
    end.setDate(end.getDate() + 1);
    return { timeMin: target.toISOString(), timeMax: end.toISOString() };
  }
  return null;
}

export function extractCalendarEventCount(prompt) {
  const text = String(prompt || '');
  const match = text.match(/\b(?:last|top|recent|latest|upcoming|next|first)\s+(\d{1,4})\b/i)
    || text.match(/\b(\d{1,4})\s+(?:latest|recent|upcoming|next|first|last)\s+(?:calendar\s+)?(?:events?|meetings?|appointments?)\b/i);
  return Math.min(2500, Math.max(1, Number(match?.[1]) || 10));
}

export async function listGoogleFormResponses(formId, maxResults = 20) {
  const query = new URLSearchParams({ pageSize: String(maxResults) });
  const result = await connectorManager.apiFetch(
    'forms',
    `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses?${query}`
  );
  return result.responses || [];
}

export function parseCalendarEvent(prompt) {
  const text = String(prompt || '');
  const explicitDateTime = text.match(/\b(20\d{2}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  const startDate = explicitDateTime
    ? new Date(`${explicitDateTime[1]}T${explicitDateTime[2].padStart(2, '0')}:${explicitDateTime[3]}:00`)
    : new Date();

  let dateExpression = explicitDateTime?.[0] || '';
  if (!explicitDateTime) {
    const relativeDay = text.match(/\b(day\s+after\s+tomorrow|tomorrow|today)\b/i)?.[0]?.toLowerCase();
    if (relativeDay === 'tomorrow') startDate.setDate(startDate.getDate() + 1);
    else if (relativeDay === 'day after tomorrow') startDate.setDate(startDate.getDate() + 2);

    const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekdayMatch = text.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (weekdayMatch && !relativeDay) {
      const target = weekdayNames.indexOf(weekdayMatch[1].toLowerCase());
      const days = (target - startDate.getDay() + 7) % 7 || 7;
      startDate.setDate(startDate.getDate() + days);
    }
    dateExpression = relativeDay || weekdayMatch?.[0] || '';
  }

  const timeMatch = explicitDateTime
    ? null
    : text.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
      || text.match(/\bat\s+(\d{1,2}):(\d{2})\b/i)
      || text.match(/\bat\s+(\d{1,2})\b/i);
  if (!explicitDateTime && !timeMatch) return null;
  if (!explicitDateTime) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    const meridiem = String(timeMatch[3] || '').toLowerCase().replace(/\./g, '');
    if (hour > 23 || minute > 59) return null;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    startDate.setHours(hour, minute, 0, 0);
  }
  if (Number.isNaN(startDate.getTime())) return null;

  const timeExpression = timeMatch?.[0] || '';
  const title = text
    .replace(/\b(?:please|can you|could you|would you|book|schedule|create|add|set up|put)\b/ig, ' ')
    .replace(/\b(?:my|a|an|the|google|calendar|event|meeting|appointment)\b/ig, ' ')
    .replace(dateExpression ? new RegExp(dateExpression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/, ' ')
    .replace(timeExpression ? new RegExp(timeExpression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/, ' ')
    .replace(/\b(?:on|at|for|in|tomorrow|today|next)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  return {
    summary: title || 'Calendar meeting',
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() }
  };
}

export async function createGoogleCalendarEvent(event) {
  const created = await connectorManager.apiFetch('calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST', body: JSON.stringify(event)
  });
  if (!created?.id) throw new Error('Google Calendar did not return an event ID. The event is not reported as created.');
  return { ...created, verified: true };
}

export async function executeConnectorTask(prompt, { onStatus = () => {} } = {}) {
  const provider = detectConnectorTask(prompt);
  if (!provider) return null;
  const request = String(prompt || '');
  try {
    onStatus(`Using ${provider} native API connector…`);
    if (provider === 'gmail') {
      if (/\b(send|draft|compose)\b/i.test(request)) {
        const to = request.match(/\bto\s+([\w.+-]+@[\w.-]+\.[a-z]{2,})/i)?.[1];
        const subject = request.match(/\bsubject\s*:?\s*["“]?(.+?)(?=["”]?\s+\b(?:body|message|saying)\b|$)/i)?.[1]?.replace(/["”]+$/g, '').trim();
        const body = request.match(/\b(?:body|message|saying)\s*:?\s*["“]?([\s\S]+)$/i)?.[1]?.replace(/["”]+$/g, '').trim();
        const missing = [!to && 'recipient address', !subject && 'subject', !body && 'message body'].filter(Boolean);
        if (missing.length) return { handled: true, provider, data: [], text: `I have not sent anything. Please provide the ${missing.join(', ')} so I can ${/\bdraft\b|\bcompose\b/i.test(request) ? 'prepare a draft' : 'send the message'}.` };
        if (/\bdraft\b|\bcompose\b/i.test(request)) {
          const draft = await connectorManager.createGmailDraft({ to, subject, body });
          return { handled: true, executed: true, provider, data: draft, text: `Created a Gmail draft to ${to} with the subject “${subject}”.` };
        }
        const sent = await connectorManager.sendGmailMessage({ to, subject, body });
        const verified = sent.verified === true && Boolean(sent.id && sent.threadId);
        return {
          handled: true,
          executed: verified,
          provider,
          data: sent,
          emailDispatch: verified ? { success: true, to, subject, messageId: sent.id, threadId: sent.threadId } : undefined,
          text: verified ? `Email dispatched successfully to ${to}.` : 'Gmail did not confirm delivery; the email was not reported as sent.'
        };
      }
      const allToday = /\ball\b.{0,30}\btoday\b|\btoday\b.{0,30}\ball\b/i.test(request);
      const emails = await readRecentGmail(extractMessageCount(request), gmailQueryFromPrompt(request), allToday);
      const output = formatEmailReport(emails);
      const wantsSheet = /\b(sheet|spreadsheet|sheets|export)\b/i.test(request);
      let sheetNote = '';
      if (wantsSheet) {
        const id = spreadsheetIdFromPrompt(request);
        const createNew = /\b(?:create|new|make)\b.{0,40}\b(?:sheet|spreadsheet)\b|\b(?:sheet|spreadsheet)\b.{0,40}\b(?:create|new)\b/i.test(request)
          || (!id && !/\b(?:append|update|add\s+to|existing)\b/i.test(request));
        const rows = [
          ['Sender Name & Email', 'Subject', 'Snippet / Summary', 'Timestamp'],
          ...emails.map(email => [email.sender, email.subject, email.preview, email.date])
        ];
        if (createNew) {
          onStatus('Creating and populating the Google Sheet');
          const populated = await connectorManager.createAndPopulateSpreadsheet({ title: `Gmail Export ${new Date().toLocaleDateString()}`, rows });
          sheetNote = `\n\nCreated and populated [${populated.spreadsheet.title}](${populated.spreadsheet.url}) with ${emails.length} email rows.`;
        } else if (!id) {
          const candidates = await getRecentSpreadsheets();
          if (candidates.length === 1) {
            if (!emails.length) throw new Error('No matching Gmail messages were available to append. No spreadsheet was changed.');
            await appendRows(candidates[0].id, [['Date', 'From', 'Subject', 'Preview'], ...emails.map(email => [email.date, email.sender, email.subject, email.preview])]);
            sheetNote = `\n\nAppended the email details to [${candidates[0].name}](${candidates[0].webViewLink || `https://docs.google.com/spreadsheets/d/${candidates[0].id}`}).`;
          } else if (candidates.length) {
            sheetNote = `\n\nI found these spreadsheets. Tell me which one to update:\n${candidates.map(file => `- ${file.name}: ${file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`}`).join('\n')}`;
          } else {
            sheetNote = '\n\nTo append these rows, provide a Google Sheets link. No spreadsheet was changed.';
          }
        } else {
          if (!emails.length) throw new Error('No matching Gmail messages were available to append. No spreadsheet was changed.');
          await appendRows(id, [['Date', 'From', 'Subject', 'Preview'], ...emails.map(email => [email.date, email.sender, email.subject, email.preview])]);
          sheetNote = `\n\nAppended ${emails.length} email rows to the requested spreadsheet.`;
        }
      }
      const driveNote = await autoSaveReport('Gmail', emails, request);
      return { handled: true, executed: true, provider, data: emails, text: `${output}${sheetNote}${driveNote}` };
    }

    if (provider === 'sheets') {
      let id = spreadsheetIdFromPrompt(request);
      if (!id) {
        const files = await getRecentSpreadsheets();
        if (!files.length) return { handled: true, provider, data: [], text: 'I could not find any spreadsheets. Include a Google Sheets link or create a spreadsheet, then try again.' };
        if (files.length === 1 && /\b(?:append|add|write|update|put|save)\b/i.test(request)) id = files[0].id;
        else return { handled: true, provider, data: files, text: `Your recently modified spreadsheets:\n${files.map(file => `- [${file.name}](${file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`})`).join('\n')}\n\nInclude a spreadsheet link when you want me to update a particular sheet.` };
      }
      if (/\b(read|show|view)\b/i.test(request)) {
        const metadata = await connectorManager.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties.title`);
        const firstSheet = metadata.sheets?.[0]?.properties?.title || 'Sheet1';
        const range = encodeURIComponent(`'${firstSheet.replace(/'/g, "''")}'!A1:Z30`);
        const result = await connectorManager.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}`);
        const values = result.values || [];
        const driveNote = await autoSaveReport('Sheets', values, request);
        return { handled: true, provider, data: values, text: `Spreadsheet data:\n\n${values.map(row => row.join(' | ')).join('\n') || '(No values in the first 30 rows.)'}${driveNote}` };
      }
      if (/\b(?:append|add|write|insert|update|put|save)\b/i.test(request)) {
        const quoted = request.match(/["“]([^"”]+)["”]/)?.[1]?.trim();
        const range = request.match(/\b(?:range|cell)\s+([A-Z]+\d+(?::[A-Z]+\d+)?)\b/i)?.[1];
        const textToWrite = quoted || request.match(/\b(?:append|add|write|insert|update|put|save)\s+([\s\S]+?)(?=\s+to\s+(?:the\s+)?(?:google\s+)?(?:sheet|spreadsheet)|$)/i)?.[1]
          ?.replace(/\b(?:range|cell)\s+[A-Z]+\d+(?::[A-Z]+\d+)?\b/i, '')
          ?.replace(/\s+/g, ' ').trim();
        if (!textToWrite) return { handled: true, provider, data: [], text: 'No spreadsheet cell was changed. Include the exact text to write, optionally in quotes; I will append a row unless you provide a cell range.' };
        const rows = [textToWrite.split(/\s*\|\s*|\t|\s*,\s*/).map(value => value.trim()).filter(Boolean)];
        if (range) {
          await writeSheetRange(id, range, rows);
          return { handled: true, provider, data: rows, text: `Updated ${range} in the requested spreadsheet.` };
        }
        await appendRows(id, rows);
        return { handled: true, provider, data: rows, text: 'Appended the requested row to the spreadsheet.' };
      }
      return { handled: true, provider, data: [], text: 'I found the spreadsheet. Tell me what to read, or provide the exact row to append.' };
    }

    if (provider === 'calendar') {
      if (/\b(create|add|book|schedule)\b/i.test(request)) {
        const event = parseCalendarEvent(request);
        if (!event) return { handled: true, provider, data: [], text: 'I have not created an event. Provide a title and a clear date/time such as “2026-10-03 15:30” so Calendar can schedule it accurately.' };
        const created = await createGoogleCalendarEvent({ ...event, reminders: { useDefault: true } });
        return { handled: true, executed: created.verified === true && Boolean(created.id), provider, data: created, text: `Created “${created.summary || event.summary}” on Calendar for ${created.start?.dateTime || event.start.dateTime}.` };
      }
      const range = parseCalendarTimeRange(request);
      const events = await listUpcomingCalendarEvents(extractCalendarEventCount(request), range || {});
      const wantsSheet = /\b(sheet|spreadsheet|sheets|export)\b/i.test(request);
      let sheetNote = '';
      if (wantsSheet) {
        const rows = [
          ['Meeting', 'Start', 'End', 'Location', 'Description', 'Calendar Event Link'],
          ...events.map(event => [event.summary || '(untitled)', event.start?.dateTime || event.start?.date || '', event.end?.dateTime || event.end?.date || '', event.location || '', event.description || '', event.htmlLink || ''])
        ];
        const id = spreadsheetIdFromPrompt(request);
        if (id) {
          if (events.length) {
            await appendRows(id, rows);
            sheetNote = `\n\nAppended ${events.length} calendar events to the requested spreadsheet.`;
          } else {
            sheetNote = '\n\nThere were no Calendar events in this time range to append.';
          }
        } else {
          onStatus('Creating and populating the Google Sheet');
          const populated = await connectorManager.createAndPopulateSpreadsheet({ title: `Calendar Export ${new Date().toLocaleDateString()}`, rows });
          sheetNote = `\n\nCreated and populated [${populated.spreadsheet.title}](${populated.spreadsheet.url}) with ${events.length} calendar events.`;
        }
      }
      const driveNote = `${sheetNote}${await autoSaveReport('Calendar', events, request)}`;
      const text = events.length ? `Upcoming Calendar events:\n${events.map(event => `- ${event.summary || '(untitled)'} — ${event.start?.dateTime || event.start?.date || 'time not set'}`).join('\n')}${driveNote}` : 'There are no upcoming Calendar events.';
      return { handled: true, executed: true, provider, data: events, text };
    }

    const formId = request.match(/forms\/d\/(?:e\/)?([\w-]+)/i)?.[1] || request.match(/\bform\s+(?:id\s+)?([\w-]{8,})/i)?.[1];
    if (!formId) return { handled: true, provider, data: [], text: 'Include a Google Form URL or form ID so I know which response set to read.' };
    const responses = await listGoogleFormResponses(formId);
    const driveNote = await autoSaveReport('Google-Forms', responses, request);
    return {
      handled: true,
      provider,
      data: responses,
      text: responses.length ? `Retrieved ${responses.length} form responses.\n\n${responses.map((response, index) => `${index + 1}. Submitted ${response.lastSubmittedTime || 'date unavailable'} — ${Object.entries(response.answers || {}).map(([key, answer]) => `${key}: ${(answer.textAnswers?.answers || []).map(item => item.value).join(', ')}`).join('; ')}`).join('\n')}${driveNote}` : 'This form has no responses.'
    };
  } catch (error) {
    onStatus('Connector request needs attention');
    const needsReconnect = /OAuth Permission Required|needs to be connected again|re-?connect|HTTP 401|HTTP 403|token is expired/i.test(error.message || '');
    if (needsReconnect && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('zulora-connector-reauth-required', { detail: { provider } }));
    }
    const text = needsReconnect
      ? `OAuth Permission Required: Please re-connect your Gmail/Calendar account to continue with ${provider}.`
      : `I couldn't complete the ${provider} request: ${error.message}`;
    return { handled: true, executed: false, provider, error, needsReconnect, text };
  }
}

export default executeConnectorTask;
