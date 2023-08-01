const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');
const electron = require('electron');

const {BrowserWindow, screen, desktopCapturer, ipcMain} = electron;
const activeWin = require('active-win');

//

const dev = process.env.ELECTRON_ENV === 'development';
const port = parseInt(process.env.PORT, 10) || 4443;

//

const findNodePath = (startPath) => {
  let currentPath = startPath;

  while (currentPath !== path.parse(currentPath).root) {
    const nodeDir = path.join(currentPath, 'node');
    if (fs.existsSync(nodeDir)) {
      const files = fs.readdirSync(nodeDir);
      const nodeVersionName = files.find(f => f.startsWith('node-v') && fs.lstatSync(path.join(nodeDir, f)).isDirectory());
      if (nodeVersionName) {
        const nodeVersionPath = path.join(nodeDir, nodeVersionName);
        let nodePath;
        if (os.platform() === 'win32') {
          nodePath = path.join(nodeVersionPath, 'node.exe');
        } else {
          nodePath = path.join(nodeVersionPath, 'bin', 'node');
        }
        return nodePath;
      }
    }
    currentPath = path.join(currentPath, '..');
  }

  return 'node';
};
let cwd = __dirname;
const nodePath = findNodePath(cwd);

//

const loggedProcesses = [];
const _logProcess = childProcess => {
  loggedProcesses.push(childProcess);

  childProcess.on('close', (exitCode, signal) => {
    console.log(
      `${childProcess.name} process exited with code ${exitCode} and signal ${signal}`,
    );
  });
};

const getCaptureWindowSources = async () => {
  let sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: 0,
      height: 0,
    },
  });
  // console.log('got raw sources', sources);
  sources = sources.map(source => {
    const {id, name} = source;
    return {
      id,
      name,
    };
  });
  return sources;
};
const waitForBrowserLoad = (browserWindow) => new Promise((accept, reject) => {
  const cleanup = () => {
    browserWindow.webContents.removeListener('did-finish-load', didFinishLoad);
    browserWindow.webContents.removeListener('did-fail-load', didFailLoad);
  };

  const didFinishLoad = () => {
    cleanup();
    accept();
  };

  const didFailLoad = (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    cleanup();
    reject(new Error('Failed to load url: ' + errorCode + ' ' + errorDescription));
  };

  browserWindow.webContents.once('did-finish-load', didFinishLoad);
  browserWindow.webContents.once('did-fail-load', didFailLoad);
});

//

const bindDesktopCapture = async electronWindow => {
  const recurse = () => {
    (async () => {
      const sources = await getCaptureWindowSources();

      if (!electronWindow.isDestroyed()) {
        electronWindow.webContents.send('desktop-captures', {
          sources,
        });
      }

      trigger();
    })();
  };
  const trigger = () => {
    setTimeout(recurse, 1000);
  };
  recurse();
};
const bindGlobalIoListener = electronWindow => {
  const robotJsProcess = child_process.spawn(nodePath, ['robotjs.cjs'], {
    stdio: [
      'pipe',
      'pipe',
      'pipe',
      'ipc',
    ],
    cwd: __dirname,
    env: {
      ...process.env,
      // ...this.getEnv(),
      // PORT: this.port.toString(),
    },
  });

  // read from ipc
  const message = m => {
    // console.log('got robotjs message', m);
    
    const {
      type,
    } = m;
    switch (type) {
      case 'global-key': {
        let {name, state} = m;

        name = name?.toLowerCase();
        state = state?.toLowerCase();

        electronWindow.webContents.send('global-key', {
          name,
          state,
        });
        break;
      }
      case 'global-mouse': {
        const mousePosition = m.mousePosition;

        electronWindow.webContents.send('global-mouse', {
          mousePosition,
        });
        break;
      }
      case 'clipboard-update': {
        // const clipboard = m.clipboard;

        // get clipboard contents
        const textContent = electron.clipboard.readText();

        electronWindow.webContents.send('clipboard-update', {
          textContent,
        });
        break;
      }
      default: {
        throw new Error(`unknown message type: ${type}`);
      }
    }
  };
  robotJsProcess.stdout.pipe(process.stdout);
  robotJsProcess.stderr.pipe(process.stderr);
  robotJsProcess.on('message', message);

  // when the window is closed, remove the listener
  electronWindow.on('closed', () => {
    // robotJsProcess.kill();
    robotJsProcess.removeListener('message', message);
  });
};
let devToolsOpen = dev;
let settingsHover = false;
let browserSolids = 0;
const bindStateListeners = electronWindow => {
  const _updateTransparency = () => {
    if (devToolsOpen || browserSolids > 0) {
      electronWindow.setIgnoreMouseEvents(false);
      if (!electronWindow.isFocused()) {
        app.focus({
          steal: true,
        });
        electronWindow.focus();
      }

      electronWindow.setAlwaysOnTop(false);
    } else {
      electronWindow.setIgnoreMouseEvents(true);
      if (electronWindow.isFocused()) {
        electronWindow.blur();
      }
      electronWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    electronWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: !devToolsOpen,
    });
  };

  electronWindow.webContents.on('devtools-opened', () => {
    electronWindow.webContents.send('devtools-opened', {
      open: true,
    });
    devToolsOpen = true;

    _updateTransparency();
  });
  electronWindow.webContents.on('devtools-closed', () => {
    electronWindow.webContents.send('devtools-opened', {
      open: false,
    });
    devToolsOpen = false;

    _updateTransparency();
  });

  ipcMain.on('browser-add-solid', () => {
    browserSolids++;
    _updateTransparency();
  });
  ipcMain.on('browser-remove-solid', () => {
    browserSolids--;
    _updateTransparency();
  });

  const rightWidthIn = 10;
  const rightWidthOut = 400;

  const interval = setInterval(() => {
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    // const workAreaDimensions = primaryDisplay.workAreaSize;
    const screenDimensions = primaryDisplay.bounds;
    const {width, height} = screenDimensions;

    const windowPosition = electronWindow.getPosition();
    const mouseScreenPos = electron.screen.getCursorScreenPoint();
    const mouseWindowPos = {
      x: mouseScreenPos.x - windowPosition[0],
      y: mouseScreenPos.y - windowPosition[1],
    };

    // get the web contents coordinates within the window
    const webContentsBounds = electronWindow.getContentBounds();
    // get the dev tools coordinates
    // const devToolsBounds = electronWindow.webContents.getDevToolsWebContents().getBounds();

    electronWindow.webContents.send('window-metrics', {
      x: windowPosition[0],
      y: windowPosition[1],
      width: webContentsBounds.width,
      height: webContentsBounds.height,
      displayWidth: width,
      displayHeight: height,
      mouseX: mouseWindowPos.x,
      mouseY: mouseWindowPos.y,
    });

    // get the fully resolved X distance of the mouse from the right edge of the contents
    const diffX = (webContentsBounds.x + webContentsBounds.width) - mouseWindowPos.x;
    if (!settingsHover && (diffX < rightWidthIn)) {
      settingsHover = true;
      // console.log('hover true');

      electronWindow.webContents.send('settings-hover', {
        hover: true,
      });
      _updateTransparency();
    } else if (settingsHover && (width - mouseWindowPos.x > rightWidthOut)) {
      settingsHover = false;
      // console.log('hover false');

      electronWindow.webContents.send('settings-hover', {
        hover: false,
      });
      _updateTransparency();
    }
  }, 10);
  electronWindow.on('closed', () => {
    clearInterval(interval);
  });

  if (dev) {
    electronWindow.webContents.openDevTools({
      // mode: 'detach',
    });
  }
  _updateTransparency();
};
const bindActiveWindowCapture = async electronWindow => {
  const recurse = () => {
    (async () => {
      let o = null;
      try {
        o = await activeWin({});
      } catch (err) {
        console.warn(err);
      }
      if (o) {
        // console.log('got active win', o);
        const {
          title,
          bounds,
          memoryUsage,
          owner: {
            name,
            bundleId,
            path,
            processId,
          },
        } = o;

        const myProcessId = process.pid;
        if (processId !== myProcessId) {
          if (!electronWindow.isDestroyed()) {
            electronWindow.webContents.send('active-window', {
              title,
              name,
              bundleId,
              path,
              bounds,
              memoryUsage,
              processId,
            });
          }
        }
      }

      trigger();
    })();
  };
  const trigger = () => {
    setTimeout(recurse, 100);
  };
  recurse();
};
const bindClipboardCapture = async electronWindow => {
  let lastTextContent = '';
  const interval = setInterval(() => {
    const textContent = electron.clipboard.readText();
    if (textContent !== lastTextContent) {
      lastTextContent = textContent;

      electronWindow.webContents.send('clipboard-update', {
        textContent,
      });
    }
  }, 500);

  electronWindow.on('closed', () => {
    clearInterval(interval);
  });
};
const bindListeners = async electronWindow => {
  const _bindDevToolsListener = () => {
    ipcMain.on('toggle-dev-tools', (event, message) => {
      if (electronWindow.webContents.isDevToolsOpened()) {
        electronWindow.webContents.closeDevTools();
      } else {
        electronWindow.webContents.openDevTools();
      }
    });
  };
  _bindDevToolsListener();

  const _bindTerminalListener = () => {
    // terminal create
    let nextTerminalId = 0;
    const terminals = new Map();
    ipcMain.on('create-terminal-window', (event, message) => {
      const {
        id,
        cols,
        rows,
      } = message;

      // console.log('create terminal window', {id, cols, rows});

      const platform = os.platform();
      const isWindows = platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || 'bash');
      const cp = child_process.spawn(
        nodePath,
        isWindows ? [
          'pty.cjs',
          cols,
          rows,
          shell,
        ] : [
          'pty.cjs',
          cols,
          rows,
          shell,
          '-il',
        ],
        {
          env: process.env,
        }
      );

      const terminalId = ++nextTerminalId;
      terminals.set(terminalId, cp);

      // on terminal exit
      cp.on('exit', (code, signal) => {
        // console.log('terminal exit', {code, signal});
        terminals.delete(terminalId);

        electronWindow.webContents.send('terminal-exit', {
          terminalId,
          code,
          signal,
        });
      });

      // pipe stdout/stderr to the browser
      const pipeFd = (stream, fd) => {
        stream.on('data', data => {
          const dataString = data.toString('utf8');
          electronWindow.webContents.send('terminal-read', {
            terminalId,
            fd,
            data: dataString,
          });
        });
      };
      pipeFd(cp.stdout, 1);
      pipeFd(cp.stderr, 2);

      // respond
      electronWindow.webContents.send('electron-response', {
        id,
        result: {
          terminalId,
        },
      });
    });
    ipcMain.on('close-terminal-window', (event, message) => {
      const {id, terminalId} = message;

      const cp = terminals.get(terminalId);
      if (cp) {
        cp.kill();
        terminals.delete(terminalId);

        electronWindow.webContents.send('electron-response', {
          id,
          result: {
            terminalId,
          },
        });
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find terminal with id: ' + terminalId).stack,
        });
      }
    });

    // terminal i/o
    ipcMain.on('terminal-write', (event, message) => {
      const {terminalId, data} = message;
      const cp = terminals.get(terminalId);
      if (cp) {
        const b = Buffer.from(data, 'utf8');
        cp.stdin.write(b);
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find terminal with id: ' + terminalId).stack,
        });
      }
    });
    ipcMain.on('terminal-end', (event, message) => {
      const {terminalId} = message;
      const cp = terminals.get(terminalId);
      if (cp) {
        cp.stdin.end();
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find terminal with id: ' + terminalId).stack,
        });
      }
    });
  };
  _bindTerminalListener();

  const _bindBrowserListener = () => {
    // browser create
    let nextBrowserId = 0;
    const browsers = new Map();
    ipcMain.on('create-browser-window', async (event, message) => {
      const {
        id,
        url,
        width,
        height,
      } = message;
      // console.log('create browser window', {url, width, height});

      const browserWindow = new BrowserWindow({
        width,
        height,

        x: -width,
        y: -height,

        useContentSize: true,
        // useContentSize: false,

        hasShadow: false,

        frame: false,
        // transparent: true,

        acceptFirstMouse: true,

        // show: false,
        skipTaskbar: true,
        // focusable: false,
        movable: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        closable: false,

        enableLargerThanScreen: true,

        webPreferences: {
          // preload: path.join(app.getAppPath(), 'preload.cjs'),
          // offscreen: true,
        },
      });
      browserWindow.lastX = -1;
      browserWindow.lastY = -1;

      // log console messages
      browserWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        // console.log('browser console message', {level, message, line, sourceId});
        console.log('console:', message);
      });
      // log uncaught exceptions/promises
      browserWindow.webContents.on('uncaught-exception', (event, message, source, line, column, error) => {
        // console.log('browser uncaught exception', {message, source, line, column, error});
        console.log('uncaught exception:', error.stack);
      });

      const browserId = ++nextBrowserId;
      browsers.set(browserId, browserWindow);

      /* browserWindow.webContents.setFrameRate(60);
      browserWindow.webContents.on('paint', (event, dirty, image) => {
        const imageBuffer = image.toPNG();

        // if window is still open
        if (!electronWindow.isDestroyed()) {
          electronWindow.webContents.send('browser-paint', {
            browserId,
            imageBuffer,
          });
        }
      }); */

      // console.log('browser window created', {browserId});

      // on window close
      browserWindow.once('closed', () => {
        browsers.delete(browserId);

        if (!electronWindow.isDestroyed()) {
          electronWindow.webContents.send('browser-exit', {
            browserId,
          });
        }
      });

      // console.log('loading 1');

      // load the url
      if (typeof url === 'string' && url) {
        browserWindow.loadURL(url);
      } else {
        browserWindow.loadURL('about:blank');
      }

      // console.log('loading 2');

      const sourceId = browserWindow.getMediaSourceId(electronWindow);

      // console.log('loading 3', {sourceId});

      // respond
      electronWindow.webContents.send('electron-response', {
        id,
        result: {
          browserId,
          sourceId,
        },
      });
    });
    ipcMain.on('close-browser-window', async (event, message) => {
      const {
        id,
        browserId,
      } = message;

      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        browserWindow.close();
        browsers.delete(browserId);

        // respond
        electronWindow.webContents.send('electron-response', {
          id,
          result: {
            browserId,
          },
        });
      } else {
        electronWindow.webContents.send('electron-response', {
          id,
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });

    // browser i/o
    ipcMain.on('browser-go', async (event, message) => {
      const {
        id,
        browserId,
        url,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        browserWindow.loadURL(url);

        try {
          await waitForBrowserLoad(browserWindow);
        } catch (err) {
          browserWindow.webContents.send('electron-response', {
            id,
            error: err.stack,
          });
        }
      } else {
        electronWindow.webContents.send('electron-response', {
          id,
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('browser-back', async (event, message) => {
      const {
        browserId,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        browserWindow.webContents.goBack();

        try {
          await waitForBrowserLoad(browserWindow);
        } catch (err) {
          electronWindow.webContents.send('electron-error', {
            error: err.stack,
          });
        }
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('browser-forward', async (event, message) => {
      const {
        browserId,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        browserWindow.webContents.goForward();

        try {
          await waitForBrowserLoad(browserWindow);
        } catch (err) {
          electronWindow.webContents.send('electron-error', {
            error: err.stack,
          });
        }
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('browser-mousemove', (event, message) => {
      const {
        browserId,
        x,
        y,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        browserWindow.webContents.sendInputEvent({
          type: 'mouseMove',
          x,
          y,
        });
        browserWindow.lastX = x;
        browserWindow.lastY = y;
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('browser-click', (event, message) => {
      const {
        browserId,
        x,
        y,
        button,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        const button2 = (() => {
          switch (button) {
            case 0: return 'left';
            case 1: return 'middle';
            case 2: return 'right';
            default: return 'left';
          }
        })();
        // setTimeout(() => {
          // browserWindow.focus();
          browserWindow.webContents.sendInputEvent({
            type: 'mouseDown',
            x,
            y,
            button: button2,
            clickCount: 1,
          });
          browserWindow.webContents.sendInputEvent({
            type: 'mouseUp',
            x,
            y,
            button: button2,
            clickCount: 1,
          });
          browserWindow.lastX = x;
          browserWindow.lastY = y;
        // }, 1000);

        /* function focusInputAt(browserWindow, x, y) {
          if (!(browserWindow instanceof BrowserWindow)) {
            throw new Error('Invalid BrowserWindow reference');
          }
        
          browserWindow.webContents.executeJavaScript(`
            (function() {
              const elementAtPoint = document.elementFromPoint(${x}, ${y});
              // if (elementAtPoint && elementAtPoint.tagName === 'INPUT') {
              if (elementAtPoint?.focus) {
                console.log('focusing input element 1');
                console.log('focusing input element 2', elementAtPoint);
                elementAtPoint.focus();
                return true;
              }
              return false;
            })()
          `).then(success => {
            if (success) {
              console.log('Input element focused');
            } else {
              console.log('No input element found at the given coordinates');
            }
          }).catch(error => {
            console.error('Error executing JavaScript:', error);
          });
        }
        focusInputAt(browserWindow, x, y); */
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('browser-wheel', (event, message) => {
      const {
        browserId,
        x,
        y,
        deltaX,
        deltaY,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        const deltaX2 = -deltaX;
        const deltaY2 = -deltaY;
        browserWindow.webContents.sendInputEvent({
          type: 'mouseWheel',
          x,
          y,
          deltaX: deltaX2,
          deltaY: deltaY2,
        });
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('browser-keypress', (event, message) => {
      const {
        browserId,
        keyCode,
      } = message;
      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        // console.log('key press', keyCode);

        // function sendInputAt(browserWindow, x, y, key) {
        //   // if (!(browserWindow instanceof BrowserWindow)) {
        //   //   throw new Error('Invalid BrowserWindow reference');
        //   // }
        //   // console.log('execute', x, y);

        //   browserWindow.webContents.executeJavaScript(`
        //     (function() {
        //       const elementAtPoint = document.elementFromPoint(${x}, ${y});
        //       if (elementAtPoint && (elementAtPoint.tagName === 'INPUT' || elementAtPoint.tagName === 'TEXTAREA')) {
        //         elementAtPoint.focus();
        //         console.log('focusing input element:' + elementAtPoint.tagName);

        //         // elementAtPoint.value += ${JSON.stringify(key)};
                
        //         // if (!elementAtPoint.value) {
        //         //   elementAtPoint.value += 'x';
        //         // } else {
        //         //   // select the input
        //         //   elementAtPoint.setSelectionRange(0, elementAtPoint.value.length);
        //         // }
        //         return true;
        //       }
        //       return false;
        //     })()
        //   `).then(success => {
        //     if (success) {
        //       console.log('Input element focused');
        //     } else {
        //       console.log('No input element found at the given coordinates');
        //     }
        //   }).catch(error => {
        //     console.error('Error executing JavaScript:', error);
        //   });
        // }
        // sendInputAt(browserWindow, browserWindow.lastX, browserWindow.lastY, keyCode);

        // console.log('send', keyCode);
        browserWindow.webContents.sendInputEvent({
          type: 'char',
          keyCode,
        });
        // browserWindow.webContents.sendInputEvent({
        //   type: 'keyDown',
        //   keyCode,
        // });
        // browserWindow.webContents.sendInputEvent({
        //   type: 'keyUp',
        //   keyCode,
        // });
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
    ipcMain.on('run-browser-function', (event, message) => {
      const {
        id,
        browserId,
        functionString,
      } = message;

      // console.log('browser run function', id, browserId, functionString?.length);

      const browserWindow = browsers.get(browserId);
      if (browserWindow) {
        (async () => {
          const result = await browserWindow.webContents.executeJavaScript('('+functionString+')()');
          // console.log('got result', {result});
          electronWindow.webContents.send('electron-response', {
            id,
            result,
          });
        })();
      } else {
        electronWindow.webContents.send('electron-error', {
          error: new Error('Could not find browser with id: ' + browserId).stack,
        });
      }
    });
  };
  _bindBrowserListener();

  const _bindDesktopScreenshotListener = () => {
    ipcMain.on('screenshot-desktop', async (event, message) => {
      const {
        id,
        // w,
        // h,
      } = message;

      const primaryDisplay = screen.getPrimaryDisplay();
      const devicePixelRatio = primaryDisplay.scaleFactor;
      const screenDimensions = primaryDisplay.bounds;
      let {width, height} = screenDimensions;
      width *= devicePixelRatio;
      height *= devicePixelRatio;

      // get the desktop source
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width,
          height,
        },
      });
      // console.log('got sources', sources);

      // read back the thumbnail image
      try {
        if (sources.length > 0) {
          const source = sources[0];
          const thumbnail = source.thumbnail; // NativeImage
          // const screenshotB64 = thumbnail.toDataURL();
          const pngBuffer = thumbnail.toPNG();
          const screenshotB64 = 'data:image/png;base64,' + pngBuffer.toString('base64');
          // respond with the thumbnail image
          electronWindow.webContents.send('electron-response', {
            id,
            result: {
              width,
              height,
              devicePixelRatio,
              screenshotB64,
            },
          });
        } else {
          throw new Error('No sources found');
        }
      } catch (err) {
        // respond with the error
        electronWindow.webContents.send('electron-error', {
          error: err.stack,
        });
      }
    });
  };
  _bindDesktopScreenshotListener();

  const _bindPageListeners = () => {
    /* ipcMain.on('enable-device-emulation', async (event, message) => {
      const {
        id,
        width,
        height,
      } = message;
      console.log('enable device emulation 1', {id, width, height});

      // close dev tools
      electronWindow.webContents.closeDevTools();

      // electronWindow.webContents.enableDeviceEmulation({
      //   screenPosition: 'mobile',
      //   screenSize: {
      //     width,
      //     height,
      //   },
      //   viewPosition: {
      //     x: 0,
      //     y: 0,
      //   },
      //   deviceScaleFactor: 1,
      //   scale: 1,
      // });
      electronWindow.oldContentSize = electronWindow.getContentSize();
      electronWindow.setContentSize(width, height);
      // electronWindow.oldSize = electronWindow.getSize();
      // electronWindow.setSize(width, height);

      console.log('enable device emulation 2', {id, width, height});

      electronWindow.webContents.send('electron-response', {
        id,
        result: null,
      });
    });
    ipcMain.on('disable-device-emulation', async (event, message) => {
      const {
        id,
      } = message;
      console.log('disable device emulation 1', {id, oldContentSize: electronWindow.oldContentSize});

      electronWindow.setContentSize(...electronWindow.oldContentSize);
      // electronWindow.setSize(...electronWindow.oldSize);
      // electronWindow.webContents.disableDeviceEmulation();

      console.log('disable device emulation 2', {id});

      electronWindow.webContents.send('electron-response', {
        id,
        result: null,
      });
    }); */
    
    ipcMain.on('screenshot-page', async (event, message) => {
      const {
        id,
      } = message;
      // console.log('screenshot request', {id});

      const nativeImage = await electronWindow.webContents.capturePage();
      const {
        width,
        height,
      } = nativeImage.getSize();

      const imageBuffer = nativeImage.toPNG();
      const imageBufferB64 = imageBuffer.toString('base64');
      // console.log('screenshot response', {id, imageBufferB64: imageBufferB64.length});
      electronWindow.webContents.send('electron-response', {
        id,
        result: {
          width,
          height,
          imageBufferB64,
        },
      });
    });
  };
  _bindPageListeners();
};


const makeWaitForExit = cp => {
  let exited = false;
  cp.on('close', (code, signal) => {
    exited = true;
  });

  return to => {
    if (!exited) {
      return new Promise((accept, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('timeout in process: ' + cp.name));
        }, to);

        const close = (code, signal) => {
          accept(code);
          cleanup();
        };
        cp.on('close', close);
        cp.on('error', err => {
          reject(err);
          cleanup();
        });
        const cleanup = () => {
          cp.removeListener('close', close);
          cp.removeListener('error', reject);
          clearTimeout(timeout);
        };
      });
    } else {
      return Promise.resolve();
    }
  };
};

const listenForExit = () => {
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  const killall = async () => {
    quitted = true;
    // console.log('quit 2');
    for (const cp of loggedProcesses) {
      console.log('kill pid', cp.name, cp.pid);
      try {
        process.kill(cp.pid, 'SIGINT');
      } catch (err) {
        if (err.code !== 'ESRCH') {
          console.warn(err.stack);
        }
      }
    }
    await Promise.all(loggedProcesses.map(cp => cp.waitForExit(10 * 1000)));
  };
  const data = key => {
    if (key === '\x03') {
      // ctrl-c
      (async () => {
        await killall();
        process.exit();
      })();
    } else if (key === 'q') {
      (async () => {
        await killall();
        process.exit();
      })();
    }
  };
  process.stdin.on('data', data);

  process.on('exit', async () => {
    console.log('try to kill all 1');
    await killall();
    console.log('try to kill all 2');
  });
};
listenForExit();

const _waitForRegex = (process, regex) => {
  return new Promise((resolve, reject) => {
    const onerror = err => {
      reject(err);
      cleanup();
    };
    process.on('error', onerror);

    process.stdout.setEncoding('utf8');
    const ondata = data => {
      if (regex.test(data)) {
        resolve();
        cleanup();
      }
    };
    process.stdout.on('data', ondata);

    const cleanup = () => {
      process.removeListener('error', onerror);
      process.stdout.removeListener('data', ondata);
    };
  });
};

const _startApp = async () => {
  const appProcess = child_process.spawn(nodePath, ['index.mjs'], {
    cwd,
    env: process.env,
    // uid: oldUid,
    stdio: 'pipe',
  });
  appProcess.name = 'app';
  appProcess.waitForExit = makeWaitForExit(appProcess);

  appProcess.stdout.pipe(process.stdout);
  appProcess.stderr.pipe(process.stderr);

  _logProcess(appProcess);

  await _waitForRegex(appProcess, /Listening/i);

  return appProcess;
};

const app = electron.app;
const p = (() => {
  let accept, reject;
  const p = new Promise((a, r) => {
    accept = a;
    reject = r;
  });
  p.accept = accept;
  p.reject = reject;
  return p;
})();
app.on('ready', () => {
  p.accept();
});

(async () => {
  await _startApp();

  console.log("I'm ready!")

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  await p;

  {
    const primaryDisplay = screen.getPrimaryDisplay();
    const {width: globalWidth, height: globalHeight} = primaryDisplay.workAreaSize;

    const mainWindow = new BrowserWindow({
      width: globalWidth,
      height: globalHeight,

      x: 0,
      y: 0,

      // alwaysOnTop: true,
      hasShadow: false,

      frame: false,
      transparent: true,

      acceptFirstMouse: true,

      webPreferences: {
        preload: path.join(app.getAppPath(), 'preload.cjs'),
      },

      resizable: false
    });

    mainWindow.loadURL(`https://local.webaverse.com:${port}/companion.html`);

      // on load
    mainWindow.webContents.on('did-finish-load', () => {
      bindDesktopCapture(mainWindow);
      bindGlobalIoListener(mainWindow);
      bindStateListeners(mainWindow);
      bindActiveWindowCapture(mainWindow);
      bindClipboardCapture(mainWindow);
      bindListeners(mainWindow);
    });

    // error
    mainWindow.webContents.on('did-fail-load', err => {
      console.log('did fail load', err);
    });
  }
})();
