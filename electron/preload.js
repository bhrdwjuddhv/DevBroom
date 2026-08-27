const { contextBridge, ipcRenderer } = require('electron')

const on = (channel, cb) => {
  const h = (_e, data) => cb(data)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

// The renderer gets exactly this and nothing else: no fs, no path, no ipcRenderer.
contextBridge.exposeInMainWorld('devbroom', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  addFolders: () => ipcRenderer.invoke('folders:add'),
  addExclusion: () => ipcRenderer.invoke('folders:pickExclusion'),

  scan: () => ipcRenderer.invoke('scan:start'),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: (cb) => on('scan:progress', cb),

  deleteItems: (items) => ipcRenderer.invoke('items:delete', items),
  onDeleteProgress: (cb) => on('delete:progress', cb),

  diskFree: (target) => ipcRenderer.invoke('disk:free', target),

  reports: () => ipcRenderer.invoke('reports:list'),
  deleteReport: (id) => ipcRenderer.invoke('reports:delete', id),
  clearReports: () => ipcRenderer.invoke('reports:clear'),

  aiList: () => ipcRenderer.invoke('ai:list'),
  aiDownload: (id) => ipcRenderer.invoke('ai:download', id),
  aiCancelDownload: () => ipcRenderer.invoke('ai:cancelDownload'),
  aiRemove: (id) => ipcRenderer.invoke('ai:remove', id),
  aiFacts: (payload) => ipcRenderer.invoke('ai:facts', payload),
  aiExplain: (payload) => ipcRenderer.invoke('ai:explain', payload),
  onAiDownloadProgress: (cb) => on('ai:download-progress', cb),
  onAiToken: (cb) => on('ai:token', cb),

  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url)
})
