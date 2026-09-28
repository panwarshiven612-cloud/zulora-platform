// Ping the Zulora web app tab to check connection status
document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({}, (tabs) => {
    const zuloraTab = tabs.find(t => t.url && (
      t.url.includes('localhost') || t.url.includes('zulora')
    ));
    const dot  = document.getElementById('dot');
    const text = document.getElementById('statusText');
    if (zuloraTab) {
      dot.classList.add('connected');
      text.textContent = 'Connected to Zulora AI ✓';
    } else {
      text.textContent = 'Open Zulora AI to connect';
    }
  });
});
