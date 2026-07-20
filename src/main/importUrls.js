const { saveImageFromUrl } = require('./storage');
const { insertSave } = require('./db');
const { notifySaved, notifyDuplicate } = require('./notify');

async function importUrls(urls) {
  const candidates = Array.isArray(urls) ? urls : [urls];
  if (candidates.length === 0) throw new Error('importUrls called without any URLs');

  const records = [];
  const errors = [];

  for (const url of candidates) {
    try {
      const imgData = await saveImageFromUrl(url);
      if (imgData.duplicateOf) {
        notifyDuplicate(imgData.existing);
        records.push({ ok: true, duplicate: true, record: imgData.existing });
      } else {
        const record = insertSave(imgData);
        notifySaved(record);
        records.push({ ok: true, duplicate: false, record });
      }
      break;
    } catch (err) {
      errors.push({ url, error: err.message });
    }
  }

  if (records.length === 0 && errors.length > 0) {
    throw new Error(
      `All ${errors.length} URL(s) failed:\n${errors.map(e => `${e.url}: ${e.error}`).join('\n')}`
    );
  }

  return { records, errors };
}

module.exports = { importUrls };
