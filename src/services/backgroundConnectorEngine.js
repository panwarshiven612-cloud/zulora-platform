import connectorManager from './connectorManager';
import { driveAuth } from '../config/firebaseDrive';
import { uploadFileToDrive } from './zuloraDriveService';

const escapeQuery = value => encodeURIComponent(value);
const getHeader = (headers = [], name) => headers.find(header => header.name?.toLowerCase() === name)?.value || '';

function extractMessageCount(prompt) {
  const match = String(prompt).match(/\b(?:last|top|recent|latest)\s+(\d{1,2})\b/i)
    || String(prompt).match(/\b(\d{1,2})\s+(?:latest|recent)\s+(?:emails?|messages?)\b/i);
  return Math.min(20, Math.max(1, Number(match?.[1]) || 5));
}

export function detectConnectorTask(prompt) {
  const text = String(prompt || '').trim();
  const asksGmail = ( /\b(gmail|inbox|emails?)\b/i.test(text)
    || /\b(send|draft|compose)\b.{0,50}\bemail\b/i.test(text) )
    && /\b(read|review|summari[sz]e|check|find|search|last|recent|latest|send|draft|inbox)\b/i.test(text);
  const asksCalendar = ( /\b(calendar|events?)\b/i.test(text)
    || /\b(schedule|book|create)\b.{0,40}\b(meeting|appointment)\b/i.test(text) )
    && /\b(list|show|view|upcoming|schedule|create|add|book)\b/i.test(text);
  const asksForms = /\b(forms?|responses?)\b/i.test(text)
    && /\b(read|sync|fetch|show|list|responses?)\b/i.test(text);
  const asksSheets = /\b(spreadsheet|google\s*sheets?|sheets?)\b/i.test(text)
    && /\b(read|append|add|write|update|summari[sz]e|export|put|save)\b/i.test(text);
  if (asksGmail) return 'gmail';
  if (asksCalendar) return 'calendar';
  if (asksForms) return 'forms';
  if (asksSheets) return 'sheets';
  return null;
}

async function readRecentGmail(count) {
  const result = await connectorManager.apiFetch(
    'gmail',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${count}&q=${escapeQuery('in:inbox')}`
  );
  const ids = (result.messages || []).slice(0, count);
  const messages = await Promise.all(ids.map(async item => {
    const message = await connectorManager.apiFetch(
      'gmail',
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
    );
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
  const result = await connectorManager.apiFetch(
    'sheets',
    `https://www.googleapis.com/drive/v3/files?q=${escapeQuery("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}&orderBy=modifiedTime%20desc&pageSize=6&fields=files(id,name,modifiedTime,webViewLink)`
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

async function autoSaveReport(provider, data) {
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

export async function listUpcomingCalendarEvents(maxResults = 8) {
  const timeMin = new Date().toISOString();
  const query = new URLSearchParams({
    timeMin, maxResults: String(maxResults), singleEvents: 'true', orderBy: 'startTime'
  });
  const result = await connectorManager.apiFetch(
    'calendar',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`
  );
  return result.items || [];
}

export async function listGoogleFormResponses(formId, maxResults = 20) {
  const query = new URLSearchParams({ pageSize: String(maxResults) });
  const result = await connectorManager.apiFetch(
    'forms',
    `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses?${query}`
  );
  return result.responses || [];
}

function parseCalendarEvent(prompt) {
  const explicitDateTime = String(prompt).match(/\b(20\d{2}-\d{2}-\d{2})[T\s]+(\d{1,2}:\d{2})(?::\d{2})?\b/);
  if (!explicitDateTime) return null;
  const startDate = new Date(`${explicitDateTime[1]}T${explicitDateTime[2]}:00`);
  if (Number.isNaN(startDate.getTime())) return null;
  const title = String(prompt)
    .replace(/\b(?:please\s+)?(?:schedule|create|add|book)\b/i, '')
    .replace(/\b(?:calendar|event|meeting|appointment)\b/ig, '')
    .replace(/\b20\d{2}-\d{2}-\d{2}[T\s]+\d{1,2}:\d{2}(?::\d{2})?\b/, '')
    .replace(/\b(?:on|at|for|in my)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  return {
    summary: title || 'Zulora calendar event',
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() }
  };
}

export async function createGoogleCalendarEvent(event) {
  return connectorManager.apiFetch('calendar', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST', body: JSON.stringify(event)
  });
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
          return { handled: true, provider, data: draft, text: `Created a Gmail draft to ${to} with the subject “${subject}”.` };
        }
        await connectorManager.sendGmailMessage({ to, subject, body });
        return { handled: true, provider, data: [], text: `Sent the email to ${to} with the subject “${subject}”.` };
      }
      const emails = await readRecentGmail(extractMessageCount(request));
      const output = formatEmailReport(emails);
      const wantsSheet = /\b(sheet|spreadsheet|sheets|export)\b/i.test(request);
      let sheetNote = '';
      if (wantsSheet && emails.length) {
        const id = spreadsheetIdFromPrompt(request);
        if (!id) {
          const candidates = await getRecentSpreadsheets();
          if (candidates.length === 1) {
            await appendRows(candidates[0].id, [['Date', 'From', 'Subject', 'Preview'], ...emails.map(email => [email.date, email.sender, email.subject, email.preview])]);
            sheetNote = `\n\nAppended the email details to [${candidates[0].name}](${candidates[0].webViewLink || `https://docs.google.com/spreadsheets/d/${candidates[0].id}`}).`;
          } else if (candidates.length) {
            sheetNote = `\n\nI found these spreadsheets. Tell me which one to update:\n${candidates.map(file => `- ${file.name}: ${file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`}`).join('\n')}`;
          } else {
            sheetNote = '\n\nTo export these rows, connect Google Sheets and provide a spreadsheet link. No spreadsheet was changed.';
          }
        } else {
          await appendRows(id, [['Date', 'From', 'Subject', 'Preview'], ...emails.map(email => [email.date, email.sender, email.subject, email.preview])]);
          sheetNote = `\n\nAppended ${emails.length} email rows to the requested spreadsheet.`;
        }
      }
      const driveNote = await autoSaveReport('Gmail', emails);
      return { handled: true, provider, data: emails, text: `${output}${sheetNote}${driveNote}` };
    }

    if (provider === 'sheets') {
      const id = spreadsheetIdFromPrompt(request);
      if (!id) {
        const files = await getRecentSpreadsheets();
        if (!files.length) return { handled: true, provider, data: [], text: 'I could not find any spreadsheets. Include a Google Sheets link or create a spreadsheet, then try again.' };
        return { handled: true, provider, data: files, text: `Your recently modified spreadsheets:\n${files.map(file => `- [${file.name}](${file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`})`).join('\n')}\n\nInclude one of these links when you want me to update a sheet.` };
      }
      if (/\b(read|show|view)\b/i.test(request)) {
        const metadata = await connectorManager.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties.title`);
        const firstSheet = metadata.sheets?.[0]?.properties?.title || 'Sheet1';
        const range = encodeURIComponent(`'${firstSheet.replace(/'/g, "''")}'!A1:Z30`);
        const result = await connectorManager.apiFetch('sheets', `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}`);
        const values = result.values || [];
        const driveNote = await autoSaveReport('Sheets', values);
        return { handled: true, provider, data: values, text: `Spreadsheet data:\n\n${values.map(row => row.join(' | ')).join('\n') || '(No values in the first 30 rows.)'}${driveNote}` };
      }
      return { handled: true, provider, data: [], text: 'I found the spreadsheet. To append data, ask me to include or export specific information from this chat; the source data was not specified.' };
    }

    if (provider === 'calendar') {
      if (/\b(create|add|book|schedule)\b/i.test(request)) {
        const event = parseCalendarEvent(request);
        if (!event) return { handled: true, provider, data: [], text: 'I have not created an event. Provide a title and a clear date/time such as “2026-10-03 15:30” so Calendar can schedule it accurately.' };
        const created = await createGoogleCalendarEvent(event);
        return { handled: true, provider, data: created, text: `Created “${created.summary || event.summary}” on Calendar for ${created.start?.dateTime || event.start.dateTime}.` };
      }
      const events = await listUpcomingCalendarEvents(10);
      const driveNote = await autoSaveReport('Calendar', events);
      const text = events.length ? `Upcoming Calendar events:\n${events.map(event => `- ${event.summary || '(untitled)'} — ${event.start?.dateTime || event.start?.date || 'time not set'}`).join('\n')}${driveNote}` : 'There are no upcoming Calendar events.';
      return { handled: true, provider, data: events, text };
    }

    const formId = request.match(/forms\/d\/(?:e\/)?([\w-]+)/i)?.[1] || request.match(/\bform\s+(?:id\s+)?([\w-]{8,})/i)?.[1];
    if (!formId) return { handled: true, provider, data: [], text: 'Include a Google Form URL or form ID so I know which response set to read.' };
    const responses = await listGoogleFormResponses(formId);
    const driveNote = await autoSaveReport('Google-Forms', responses);
    return {
      handled: true,
      provider,
      data: responses,
      text: responses.length ? `Retrieved ${responses.length} form responses.\n\n${responses.map((response, index) => `${index + 1}. Submitted ${response.lastSubmittedTime || 'date unavailable'} — ${Object.entries(response.answers || {}).map(([key, answer]) => `${key}: ${(answer.textAnswers?.answers || []).map(item => item.value).join(', ')}`).join('; ')}`).join('\n')}${driveNote}` : 'This form has no responses.'
    };
  } catch (error) {
    onStatus('Connector request needs attention');
    return { handled: true, provider, error, text: `I couldn't complete the ${provider} request: ${error.message}` };
  }
}

export default executeConnectorTask;
