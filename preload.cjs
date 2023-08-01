const {
  ipcRenderer,
  contextBridge,
} = require('electron')

/* ipcRenderer.on('desktop-capture', (event, data) => {
  window.postMessage({
    method: 'desktop-capture',
    data,
  }, '*');
}); */

ipcRenderer.on('desktop-captures', (event, data) => {
  window.postMessage({
    method: 'desktop-captures',
    data,
  }, '*');
});

ipcRenderer.on('active-window', (event, data) => {
  window.postMessage({
    method: 'active-window',
    data,
  }, '*');
});

ipcRenderer.on('global-key', (event, data) => {
  window.postMessage({
    method: 'global-key',
    data,
  }, '*');
});

ipcRenderer.on('global-mouse', (event, data) => {
  window.postMessage({
    method: 'global-mouse',
    data,
  }, '*');
});

ipcRenderer.on('clipboard-update', (event, data) => {
  window.postMessage({
    method: 'clipboard-update',
    data,
  }, '*');
});

ipcRenderer.on('settings-hover', (event, data) => {
  window.postMessage({
    method: 'settings-hover',
    data,
  }, '*');
});

ipcRenderer.on('devtools-opened', (event, data) => {
  window.postMessage({
    method: 'devtools-opened',
    data,
  }, '*');
});

//

let nextId = 0;
const cbs = new Map();
ipcRenderer.on('electron-response', (event, data) => {
  const {id} = data;
  const cb = cbs.get(id);
  if (cb) {
    const {
      error,
      result,
    } = data;
    if (error !== void 0) {
      cb(error);
      cbs.delete(id);
    } else if (result !== void 0) {
      cb(null, result);
      cbs.delete(id);
    } else {
      console.warn('invalid electron response', data);
      throw new Error('invalid electron response');
    }
  } else {
    console.warn('no callback for id', id);
  }
});

//

const makePromise = () => {
  let resolve, reject;
  const p = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  p.resolve = resolve;
  p.reject = reject;
  return p;
};

//

// class Terminal extends EventTarget {
//   constructor() {
//     super();
//   }
// }

// class Browser extends EventTarget {
//   constructor() {
//     super();
//   }
// }

// const terminals = new Map();
// const browsers = new Map();

// Expose the method to the renderer process using contextBridge
contextBridge.exposeInMainWorld('electronIpc', {
  toggleDevTools() {
    ipcRenderer.send('toggle-dev-tools');
  },
  createTerminalWindow({
    cols,
    rows,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('create-terminal-window', {
      id: nextId,
      cols,
      rows,
    });
    return p;
  },
  closeTerminalWindow({
    terminalId,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('close-terminal-window', {
      id: nextId,
      terminalId,
    });
    return p;
  },
  terminalWrite({
    terminalId,
    data,
  }) {
    ipcRenderer.send('terminal-write', {
      terminalId,
      data,
    });
  },
  createBrowserWindow({
    url,
    width,
    height,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('create-browser-window', {
      id: nextId,
      url,
      width,
      height,
    });
    return p;
  },
  closeBrowserWindow({
    browserId,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('close-browser-window', {
      id: nextId,
      browserId,
    });
    return p;
  },
  browserBack({
    browserId,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('browser-back', {
      id: nextId,
      browserId,
    });
    return p;
  },
  browserForward({
    browserId,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('browser-forward', {
      id: nextId,
      browserId,
    });
    return p;
  },
  browserGo({
    browserId,
    url,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('browser-go', {
      id: nextId,
      browserId,
      url,
    });
    return p;
  },
  browserMouseMove({
    browserId,
    x,
    y,
  }) {
    ipcRenderer.send('browser-mousemove', {
      // id: nextId,
      browserId,
      x,
      y,
    });
    // return p;
  },
  browserClick({
    browserId,
    x,
    y,
    button,
  }) {
    ipcRenderer.send('browser-click', {
      // id: nextId,
      browserId,
      x,
      y,
      button,
    });
    // return p;
  },
  browserWheel({
    browserId,
    x,
    y,
    deltaX,
    deltaY,
  }) {
    ipcRenderer.send('browser-wheel', {
      // id: nextId,
      browserId,
      x,
      y,
      deltaX,
      deltaY,
    });
    // return p;
  },
  browserKeyPress({
    browserId,
    // x,
    // y,
    keyCode,
  }) {
    console.log('send key press', {
      // id: nextId,
      browserId,
      // x,
      // y,
      keyCode,
    });

    ipcRenderer.send('browser-keypress', {
      // id: nextId,
      browserId,
      // x,
      // y,
      keyCode,
    });
    // return p;
  },
  runBrowserFunction({
    browserId,
    functionString,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('run-browser-function', {
      id: nextId,
      browserId,
      functionString,
    });
    return p;
  },
  browserAddSolid() {
    ipcRenderer.send('browser-add-solid', {
      // browserId,
    });
  },
  browserRemoveSolid() {
    ipcRenderer.send('browser-remove-solid', {
      // browserId,
    });
  },
  /* enableDeviceEmulation({
    width,
    height,
  }) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('enable-device-emulation', {
      id: nextId,
      width,
      height,
    });
    return p;
  },
  disableDeviceEmulation() {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('disable-device-emulation', {
      id: nextId,
    });
    return p;
  }, */
  screenshotPage() {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      // console.log('got screenshot result', {error, result});
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('screenshot-page', {
      id: nextId,
    });
    return p;
  },
  screenshotDesktop(/*w, h*/) {
    const p = makePromise();
    cbs.set(++nextId, (error, result) => {
      // console.log('got screenshot result', {error, result});
      if (error) {
        p.reject(error);
      } else {
        p.resolve(result);
      }
    });
    ipcRenderer.send('screenshot-desktop', {
      id: nextId,
      // w,
      // h,
    });
    return p;
  },
});

//

ipcRenderer.on('terminal-read', (event, data) => {
  // console.log('got terminal read', data);
  window.postMessage({
    method: 'terminal-read',
    data,
  });
});

//

ipcRenderer.on('window-metrics', (event, data) => {
  // console.log('got terminal read', data);
  window.postMessage({
    method: 'window-metrics',
    data,
  });
});

//

ipcRenderer.on('browser-paint', (event, data) => {
  // console.log('got browser-paint', data);
  window.postMessage({
    method: 'browser-paint',
    data,
  });
});