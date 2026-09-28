# Bundled offline assets

- Tesseract.js 7.0.0 and Tesseract.js Core 7.0.0: local browser worker and all six SIMD/LSTM core variants.
- English OCR data: `eng.traineddata` from the Tesseract `4.0.0_best` dataset (LSTM-only, Apache-2.0).
- jsPDF 4.2.1 and html2canvas 1.4.1: local page-to-PDF export.
- `dom-selectors.js`: reusable search, prompt, message, email, submit, and response selector dictionaries.
- `audio/`: generated 48 kHz, stereo, 24-bit WAV status prompts.

OCR runs with the English model fully offline. PDF export uses the bundled libraries and the current tab's rendered page. Cross-origin images may be omitted by the browser's canvas security rules.

See the LICENSE files beside the corresponding libraries and trained data.
