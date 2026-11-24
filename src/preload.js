'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  info: () => call('app:info'),
  windowControl: (a) => call('window:control', a),
  read: (key) => call('store:read', key),
  write: (key, value) => call('store:write', key, value),
  copyText: (text) => call('clipboard:writeText', text),
  readText: () => call('clipboard:readText'),
  readImage: () => call('clipboard:readImage'),
  copyImage: (b64) => call('clipboard:writeImage', b64),
  saveFile: (name, b64) => call('file:save', name, b64),
  saveMany: (files) => call('file:saveMany', files),
  captureScreens: () => call('screen:capture'),
  keepAwake: (on) => call('power:keepAwake', on),
  openExternal: (url) => call('shell:openExternal', url),
  on: (channel, fn) => {
    const allowed = ['window:state'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});
