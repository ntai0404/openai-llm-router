const checkbox = document.getElementById('autoTemporary');
chrome.storage.sync.get({ autoTemporary: true }, ({ autoTemporary }) => {
  checkbox.checked = autoTemporary;
});
checkbox.addEventListener('change', () => {
  chrome.storage.sync.set({ autoTemporary: checkbox.checked });
});
