import { createParser } from 'eventsource-parser';

//

const textDecoder = new TextDecoder();

//

export class EventStreamParseStream extends TransformStream {
  constructor() {
    let controller;
    const eventStreamParser = createParser(event => {
      if (event.type === 'event') {
        if (event.data !== '[DONE]') { // stream data
          const data = JSON.parse(event.data);
          const content = data.choices[0].delta.content;
          // if (typeof content === 'string') {
          if (content) {
            // processContent(content);
            controller.enqueue(content);
          }
        } else { // stream end
          // console.log('stream done');
        }
      }
    });

    super({
      transform: (chunk, _controller) => {
        controller = _controller;

        const s = textDecoder.decode(chunk);
        eventStreamParser.feed(s);
      },
    });
  }
}