const button = globalThis.document.querySelector('#run');
const result = globalThis.document.querySelector('#result');
button.addEventListener('click', async () => {
  button.disabled = true;
  result.textContent = 'Running';
  try {
    const report = await globalThis.__TAURI__.core.invoke('probe_storage');
    result.textContent = JSON.stringify(report);
  } catch {
    result.textContent = 'Failed';
  } finally {
    button.disabled = false;
  }
});
