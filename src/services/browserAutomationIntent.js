const BROWSER_ACTION = /\b(?:click|double[- ]click|type|fill|enter|select|press|scroll|navigate|open|close|switch|download|submit|inspect|read|scrape)\b/i;
const EXPLICIT_AUTOMATION_TARGET = /\b(?:browser|dom)\s+automation\b|\b(?:automate|automating|automation\s+of)\s+(?:the\s+)?(?:browser|dom)\b|\bcomputer\s+(?:plugin|agent)\b/i;
const ACTIVE_BROWSER_SURFACE = /\b(?:my|current|active|open)\s+(?:web\s*browser|browser|tab|page|webpage)\b|\b(?:in|on|using|through|with)\s+(?:my|current|active|open)\s+(?:browser|tab|page)\b|\b(?:browser|tab)\s+(?:at|for)\s+(?:https?:\/\/|www\.)/i;

export function isExplicitBrowserAutomationIntent(prompt) {
  const text = String(prompt || '');
  return BROWSER_ACTION.test(text)
    && (EXPLICIT_AUTOMATION_TARGET.test(text) || ACTIVE_BROWSER_SURFACE.test(text));
}

export default isExplicitBrowserAutomationIntent;
