import * as sentenceSplitter from 'sentence-splitter';

//

// write a generator function which will parse AvatarCL
const skillRegex = /:([a-zA-Z0-9_]+?)::([a-zA-Z0-9_]+?):::\s*/;

//

class ResultContext {
  constructor({
    skills,
  }) {
    // members
    // this.defaultProgressiveSkill = defaultProgressiveSkill;

    // let localSrc = -1;

    // locals
    this.resultQueue = [];

    const handleMessage = (character, command, value) => {
      this.resultQueue.push({
        character,
        command,
        value,
        // src: localSrc,
      });
    };
    const processSentence = (character, command, sentence) => {
      // if (!sentence?.type) {
      //   debugger;
      // }
      if (sentence.type === 'Sentence') { // ignore Whitespace, Punctuation
        const text = sentence.raw.trim();
        handleMessage(character, command, text);
      }
    };
    const processSentenceText = (character, command, value, setValue, final) => {
      // split sentences
      const rawSentences = value.split('\n');

      // note: will assign back texts from segmented sentences, so need to add back `\n`, let both `abc\n` and `abc\ndef` unchanged.
      const loopCount = value.endsWith('\n') ? rawSentences.length : rawSentences.length - 1;
      for (let i = 0; i < loopCount; i++) {
        rawSentences[i] += '\n';
      }

      const sentences = rawSentences.flatMap(rawSentence => sentenceSplitter.split(rawSentence));
      
      // process all sentences except the last one
      while (sentences.length > 1) {
        processSentence(character, command, sentences.shift());
      }

      if (!final) { // if we're not done, set the value to the pending sentence
        const newValue = sentences.length > 0 ? sentences[0].raw.replace(/^\s+$/, '') : '';
        setValue(newValue);
      } else { // if we're done, flush the last sentence
        if (sentences.length > 0) {
          processSentence(character, command, sentences[0]);
        }
        setValue('');
      }
    };
    this.processResult = ({
      character,
      command,
      value,
      final,
      setValue,
      // src,
    }) => {
      // console.log('process result', {
      //   character,
      //   command,
      //   value,
      //   final,
      //   src,
      // });

      // localSrc = src;

      const skill = skills.get(command);
      // console.log('skill spec for command', skill);
      if (skill) {
        if (skill.spec.progressive === 'sentence') {
          processSentenceText(character, command, value, setValue, final);
        } else {
          if (final) {
            handleMessage(character, command, value);
          }
        }
      } else {
        console.warn('LLM generated unknown skill: ' + JSON.stringify(command));
        debugger;
      }
    };
  }
  flush() {
    const oldResults = this.resultQueue;
    this.resultQueue = [];
    return oldResults;
  }
}

//

class Parser /*extends EventTarget*/ {
  constructor({
    skills,
  }) {
    // super();

    this.skills = skills;
    this.defaultProgressiveSkill = Array.from(this.skills.values())
      .find(skill => skill.spec.progressive === 'sentence');

    this.done = false;
    this.currentContext = null;
    this.lastSkillContext = null;
  }
  #makeResultContext() {
    return new ResultContext({
      skills: this.skills,
    });
  }
  #llmError(reasonString) {
    console.error('parser stopped due to LLM error: ' + reasonString);

    this.done = true;
    this.currentContext = null;
  }

  write(s) {
    const resultContext = this.#makeResultContext();

    if (!this.done) {
      if (!this.currentContext) {
        this.currentContext = {
          value: '',
        };
      }

      const _processHead = () => {
        const match = this.currentContext.value.match(skillRegex);
        if (match && match.index !== 0) { // if we have a skill match but not at the beginning
          if (this.lastSkillContext) { // if there was a previous skill context
            const {
              character,
            } = this.lastSkillContext;

            const first = this.currentContext.value.slice(0, match.index); // everything up to the first label
            const rest = this.currentContext.value.slice(match.index); // first label and everything after

            this.currentContext.value = first;

            // output the value as if it were the main skill, by the previous character
            resultContext.processResult({
              character,
              command: this.defaultProgressiveSkill.spec.name,
              value: first,
              final: true,
              setValue: (v) => {
                this.currentContext.value = v;
              },
              // src: 1,
            });
            this.currentContext = {
              value: rest,
            };
          } else { // else if there was no previous skill context, llm error
            this.#llmError('no previous skill context');
            return true;
          }
        }
        return false;
      };
      const _processMain = () => {
        const match = this.currentContext.value.match(skillRegex);
        if (match) { // if we have a skill match
          const [_, character, command] = match;
          const valueOffset = match.index + match[0].length;
          const value = this.currentContext.value.slice(valueOffset);

          const skill = this.skills.get(command);
          if (skill) { // the skill better exist
            // console.log('match skill', skill, value);

            if (skill.spec.progressive === 'sentence') { // if it's a progressive skill
              // find the next match, which terminates this skill
              const nextMatch = value
                .match(skillRegex);
              if (nextMatch) { // if there is a next match, terminate the skill
                const first = this.currentContext.value.slice(valueOffset, valueOffset + nextMatch.index); // first skill, sans label
                const rest = this.currentContext.value.slice(valueOffset + nextMatch.index); // pending next skill

                this.currentContext.value = first;

                resultContext.processResult({
                  character,
                  command,
                  value: first,
                  final: true,
                  setValue: (v) => {
                    this.currentContext.value = v;
                  },
                  // src: 2,
                });

                this.currentContext = {
                  value: rest,
                };
                this.lastSkillContext = {
                  character,
                  command,
                };
              } else { // else if there is no next match, do not terminate the skill but instead process it unfinally
                const head = this.currentContext.value.slice(0, valueOffset); // everything up to the first label
                const first = value; // first skill, sans label

                this.currentContext.value = first;

                resultContext.processResult({
                  character,
                  command,
                  value: first,
                  final: false,
                  setValue: (v) => {
                    // console.log('update value', {
                    //   v,
                    //   currentValue: this.currentContext.value,
                    //   head,
                    // });
                    this.currentContext.value = v;
                  },
                  // src: 3,
                });

                // keep the current context
                this.currentContext.value = head + this.currentContext.value;

                this.lastSkillContext = {
                  character,
                  command,
                };
              }
            } else { // else if it's a non-progressive skill
              // find the next new line, which terminates this skill
              const newLineMatch = value.match(/\n/);
              if (newLineMatch) {
                const first = this.currentContext.value.slice(valueOffset, valueOffset + newLineMatch.index); // first skill, up to newline
                const rest = this.currentContext.value.slice(valueOffset + newLineMatch.index + newLineMatch[0].length); // rest after newline

                this.currentContext.value = first;

                // console.log('split first rest', {
                //   first,
                //   rest,
                // });

                resultContext.processResult({
                  character,
                  command,
                  value: first,
                  final: true,
                  setValue: (v) => {
                    this.currentContext.value = v;
                  },
                  // src: 4,
                });

                this.currentContext = {
                  value: rest,
                };
                this.lastSkillContext = {
                  character,
                  command,
                };
              } else {
                // no new line on a non-progressive skill, so do nothing
              }
            }
          } else { // else if the skill does not exist, we don't know what to do. so, llm error
            this.#llmError('skill does not exist: ' + command);
            return true;
          }
        } else { // else if there is no skill match (yet)
          // wait for more input
          // console.log('no skill match yet', [this.currentContext.value]);
        }
        return false;
      };
      const processCharacter = c => {
        this.currentContext.value += c;

        return _processHead() || _processMain();
      };
      const processContent = content => {
        const contentCharacters = [...content]; // split emojis
        for (let i = 0; i < contentCharacters.length; i++) {
          const c = contentCharacters[i];
          const isDone = processCharacter(c);
          if (isDone) {
            return true;
          }
        }
        return false;
      };
      processContent(s);
    }

    return resultContext.flush();
  }
  end() {
    // console.log('parser end', this.currentContext);

    const resultContext = this.#makeResultContext();

    if (this.currentContext) { // if there is any tail to flush
      const match = this.currentContext.value.match(skillRegex);
      if (match) { // if there was a skill match, flush it as final
        const [_, character, command] = match;
        const valueOffset = match.index + match[0].length;
        const value = this.currentContext.value.slice(valueOffset);

        // const skill = Array.from(this.skills.values())
        //   .find(s => s.name === command);
        const skill = this.skills.get(command);

        // console.log('parser end skill', skill, value);

        if (skill) { // the skill better exist
          // if it's a progressive skill, capture the full value string
          // otherwise, capture only the first line
          let valueString = value;
          if (skill.spec.progressive === 'sentence') { // if it's a progressive skill
            // nothing
          } else {
            const match = value.match(/^([\s\S]*?)\n/);
            if (match) {
              valueString = match[1];
            }
          }

          // console.log('parser end valueString', valueString);

          const first = valueString;
          this.currentContext.value = first;

          // whether it's a progressive or non-progressive skill, flush it as final
          resultContext.processResult({
            character,
            command,
            value: first,
            final: true,
            setValue: (v) => {
              this.currentContext.value = v;
            },
            // src: 5,
          });

          this.currentContext = null;
          // console.log('match 3');
        } else { // else if there was no skill match, llm error
          this.#llmError('skill does not exist: ' + command);
          // console.log('match 4');
        }
      } else { // else if there was no skill match
        // console.log('match 5', [this.currentContext.value, skillRegex]);
        if (this.lastSkillContext) { // if there was a previous skill context
          const {
            character,
          } = this.lastSkillContext;

          const first = this.currentContext.value;

          resultContext.processResult({
            character,
            command: this.defaultProgressiveSkill.spec.name,
            value: first,
            final: true,
            setValue: (v) => {
              this.currentContext.value = v;
            },
            // src: 6,
          });
        } else { // else if there was no previous skill context, llm error
          this.#llmError('no previous skill context');
        }
      }
    }

    return resultContext.flush();
  }
  getCurrentText() {
    return this.currentContext ? this.currentContext.value : '';
  }
}
// globalThis.Parser = Parser;

const tests = [
  // no parse
  ({skills}) => {
    const p = new Parser({
      skills,
    });
    console.assert(p.getCurrentText() === '');
    const result = p.write('abc');

    console.assert(result.length === 0);
    console.assert(p.getCurrentText() === 'abc');
  },
  // single progressive message
  ({skills}) => {
    const p = new Parser({
      skills,
    });

    {
      console.assert(p.getCurrentText() === '');
    }
    
    {
      const result = p.write(`\
:Stevia::TEXT:::Hey there! What's up? I'm Stevia, a cute anime girl who loves giving advice in the metaverse!`);
      
      // console.log('got result', result);
      console.assert(result.length === 2);
      
      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'TEXT');
      console.assert(result[0].value === `Hey there!`);

      console.assert(result[1].character === 'Stevia');
      console.assert(result[1].command === 'TEXT');
      console.assert(result[1].value === `What's up?`);

      // console.log('got current text', {currentText: p.getCurrentText()});
      console.assert(p.getCurrentText() === `:Stevia::TEXT:::I'm Stevia, a cute anime girl who loves giving advice in the metaverse!`);
    }

    {
      const result = p.end();

      console.assert(result.length === 1);

      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'TEXT');
      console.assert(result[0].value === `I'm Stevia, a cute anime girl who loves giving advice in the metaverse!`);

      console.assert(p.getCurrentText() === '');
    }
  },
  // multiple progressive messages
  ({skills}) => {
    const p = new Parser({
      skills,
    });

    {
      const result = p.write(`\
:Stevia::TEXT:::Hey there! First try`);
      // console.log('got result 1', result);
      console.assert(result.length === 1);
      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'TEXT');
      console.assert(result[0].value === `Hey there!`);

      const result2 = p.write(`\
:Stevia::TEXT:::I cut you off and `);
      // console.log('got result 2', result2);
      console.assert(result2.length === 1);
      console.assert(result2[0].character === 'Stevia');
      console.assert(result2[0].command === 'TEXT');
      console.assert(result2[0].value === `First try`);

      const result3 = p.write(`\
this is the end of that.`);
      console.assert(result3.length === 0);

      const result4 = p.end();
      console.assert(result4.length === 1);
      console.assert(result4[0].character === 'Stevia');
      console.assert(result4[0].command === 'TEXT');
      console.assert(result4[0].value === `I cut you off and this is the end of that.`);
    }
  },
  // single non-progressive messages
  ({skills}) => {
    {
      const p = new Parser({
        skills,
      });

      const result = p.write(`\
:Stevia::MOOD:::joy
`);
      console.assert(result.length === 1);
      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'MOOD');
      console.assert(result[0].value === `joy`);
    }
    
    {
      const p = new Parser({
        skills,
      });

      const result = p.write(`\
:Stevia::MOOD:::sorrow`);
      console.assert(result.length === 0);

      const result2 = p.end();
      console.assert(result2.length === 1);
      console.assert(result2[0].character === 'Stevia');
      console.assert(result2[0].command === 'MOOD');
      console.assert(result2[0].value === `sorrow`);
    }
  },
  // multiple non-progressive messages
  ({skills}) => {
    {
      const p = new Parser({
        skills,
      });

      const result = p.write(`\
:Stevia::MOOD:::joy
:Stevia::EMOTE:::victory
`);
      console.assert(result.length === 2);

      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'MOOD');
      console.assert(result[0].value === `joy`);

      console.assert(result[1].character === 'Stevia');
      console.assert(result[1].command === 'EMOTE');
      console.assert(result[1].value === `victory`);
    }
    
    {
      const p = new Parser({
        skills,
      });

      const result = p.write(`\
:Stevia::MOOD:::sorrow
:Stevia::EMOTE:::sad`);

      console.assert(result.length === 1);

      console.log('got result 1', result);
      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'MOOD');
      console.assert(result[0].value === `sorrow`);

      const result2 = p.end();
      console.log('got result 2', result2);
      console.assert(result2.length === 1);
      console.assert(result2[0].character === 'Stevia');
      console.assert(result2[0].command === 'EMOTE');
      console.assert(result2[0].value === `sad`);
    }
  },
  // trailing progressive messages
  ({skills}) => {
    {
      const p = new Parser({
        skills,
      });

      const result = p.write(`\
:Stevia::MOOD:::joy
I'm feeling happy.`);
      console.assert(result.length === 1);

      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'MOOD');
      console.assert(result[0].value === `joy`);

      const result2 = p.end();

      console.assert(result2.length === 1);

      console.assert(result2[0].character === 'Stevia');
      console.assert(result2[0].command === 'TEXT');
      console.assert(result2[0].value === `I'm feeling happy.`);
    }

    {
      const p = new Parser({
        skills,
      });

      const result = p.write(`\
:Stevia::MOOD:::joy
I'm feeling happy.
:Stevia::MOOD:::sorrow
Now I'm feeling sad.`);
      console.assert(result.length === 3);

      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'MOOD');
      console.assert(result[0].value === `joy`);

      console.assert(result[1].character === 'Stevia');
      console.assert(result[1].command === 'TEXT');
      console.assert(result[1].value === `I'm feeling happy.`);

      console.assert(result[2].character === 'Stevia');
      console.assert(result[2].command === 'MOOD');
      console.assert(result[2].value === `sorrow`);

      const result2 = p.end();

      console.assert(result2.length === 1);

      console.assert(result2[0].character === 'Stevia');
      console.assert(result2[0].command === 'TEXT');
      console.assert(result2[0].value === `Now I'm feeling sad.`);
    }
  },
  // multiple messages with line indexes
  ({skills}) => {
    const p = new Parser({
      skills,
    });

    {
      console.assert(p.getCurrentText() === '');
    }
    
    {
      const result = p.write(`\
:Stevia::TEXT:::For the fourth choice question on the JavaScript quiz, the choices are:

1. Throws an error
2. Ignores the statements
3. Gives a warning
4. None of the above

Feel free to let me know if you need help with the correct answer or if you have any other question! I'm Stevia, a cute anime girl who loves giving advice in the metaverse!`);
      
      // console.log('got result', result);
      console.assert(result.length === 10);
      
      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'TEXT');
      console.assert(result[0].value === `For the fourth choice question on the JavaScript quiz, the choices are:`);

      console.assert(result[1].character === 'Stevia');
      console.assert(result[1].command === 'TEXT');
      console.assert(result[1].value === `1.`);

      console.assert(result[2].character === 'Stevia');
      console.assert(result[2].command === 'TEXT');
      console.assert(result[2].value === `Throws an error`);

      console.assert(result[3].character === 'Stevia');
      console.assert(result[3].command === 'TEXT');
      console.assert(result[3].value === `2.`);

      console.assert(result[4].character === 'Stevia');
      console.assert(result[4].command === 'TEXT');
      console.assert(result[4].value === `Ignores the statements`);

      console.assert(result[5].character === 'Stevia');
      console.assert(result[5].command === 'TEXT');
      console.assert(result[5].value === `3.`);

      console.assert(result[6].character === 'Stevia');
      console.assert(result[6].command === 'TEXT');
      console.assert(result[6].value === `Gives a warning`);

      console.assert(result[7].character === 'Stevia');
      console.assert(result[7].command === 'TEXT');
      console.assert(result[7].value === `4.`);

      console.assert(result[8].character === 'Stevia');
      console.assert(result[8].command === 'TEXT');
      console.assert(result[8].value === `None of the above`);

      console.assert(result[9].character === 'Stevia');
      console.assert(result[9].command === 'TEXT');
      console.assert(result[9].value === `Feel free to let me know if you need help with the correct answer or if you have any other question!`);

      // console.log('got current text', {currentText: p.getCurrentText()});
      console.assert(p.getCurrentText() === `:Stevia::TEXT:::\n\nI'm Stevia, a cute anime girl who loves giving advice in the metaverse!`);
    }

    {
      const result = p.end();

      console.assert(result.length === 1);

      console.assert(result[0].character === 'Stevia');
      console.assert(result[0].command === 'TEXT');
      console.assert(result[0].value === `I'm Stevia, a cute anime girl who loves giving advice in the metaverse!`);

      console.assert(p.getCurrentText() === '');
    }
  },
]
const testParser = ({
  skills,
}) => {
  const o = {
    skills,
  };
  for (const test of tests) {
    test(o);
  }
  console.log('all tests passed!');
};
// globalThis.testParser = testParser;

//

const nop = () => {};
export class AvatarMLStreamParser extends TransformStream {
  constructor({
    skills,
    onMessage = nop,
    onData = nop,
    signal,
  }) {
    const parser = new Parser({
      skills,
    });
    const flushEvents = events => {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        onMessage(event);
      }
    };

    super({
      transform: (chunk, controller) => {
        onData(chunk);

        // console.log('write chunk', chunk);
        const events = parser.write(chunk);
        // console.log('got parser events', events);
        flushEvents(events);
      },
      flush(controller) {
        const events = parser.end();
        flushEvents(events);
      },
    });
  }
}
// globalThis.AvatarMLStreamParser = AvatarMLStreamParser;