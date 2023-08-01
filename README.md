This is the core code of the MoeMate AI agent I wrote.

It's not complete code, but should be easy to port this over into your own realtime agent systems.

## Contents
- `lib` contains the main interfaces used to communicate with the backend, as well as the realtime perception driver.
- `electron.cjs` contains the core electron driver which reads the screen.
- `preload.js` contains the web environment hook injected into the browser context.

## Remote AIs
The system calls out to these AIs running remotely:
- https://github.com/avaer/sam-blip2
  - for captioning/segmentation
- https://github.com/avaer/doctr
  - for on-screen OCR
