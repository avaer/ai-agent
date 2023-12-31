# avaer's AI Agent Dump

A random collection of useful embodied AI agent code I wrote, and actively use in my projects.

It's not a complete project, but it should be easy to port this over into your own, locally running realtime agent systems.

## Contents
- `lib` contains the main interfaces used to communicate with the backend, as well as the realtime perception driver.
- `electron.cjs` contains the core electron driver which reads the screen.
- `preload.js` contains the web environment hook injected into the browser context.
- `clients.js` contains memory, perception, and other interface code.

## Remote AIs
The system calls out to these AIs running remotely:
- https://github.com/avaer/sam-blip2
  - for captioning/segmentation
- https://github.com/avaer/doctr
  - for on-screen OCR
