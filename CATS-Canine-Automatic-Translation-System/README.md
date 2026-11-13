# C.A.T.S. — Canine Automatic Translation System

An automated translation system for human to canine communication. Developed by Juke LTD. in conjunction with Dogs for a Better Humanity.

Live copy: <https://jukeltd.com/CATS-Canine-Automatic-Translation-System/>

Code in this repository was generated with AI/LLM tooling; all design choices and responsibility lie squarely with the developer.

## Running it

Open `index.html` in a browser. No build step, no install, no dependencies. The only network request is a Google Fonts stylesheet for Fredoka; without it the page falls back to a system rounded font.

## Files

| File | Role |
|---|---|
| `index.html` | Page markup |
| `styles.css` | All styling |
| `translator.js` | The translation engine. Pure functions, no DOM. Exposes `window.CATS`; also `require()`-able in Node |
| `script.js` | Wires the form to the engine and draws the result |

## How the translation works

1. Text is split into sentences, then into words, numbers, punctuation and whitespace. Punctuation, spacing and line breaks pass through unchanged.
2. Each sentence gets a mood from its punctuation and vocabulary: excited (`!` or all caps), asking (`?`), sad, cross, or plain. Mood changes which sounds are likely.
3. Words a dog knows (walk, treat, ball, squirrel, vet, cat, dinner, postman, "good boy" and so on) get a specific vocal reaction.
4. Every other word becomes a sound shaped by its length: a grunt for one letter, a clipped bark for two, stretched barks for medium words, double barks for long ones and howls for very long ones. The same sound is never used twice running. Now and then an odd vocalisation stands in for a word.
5. Numbers are barked out one bark per count, up to six, after which the dog loses count.
6. Capitalisation carries over: `Word` gives `Woof`, `WORD` gives `WOOF`.
7. Occasionally a play sneeze, sniff, pant or grumble follows a sentence.

Everything in the output is a sound a dog makes: no stage directions, no described actions. Anything shaped like an HTML tag is removed from the input before translating, and output is written to the page as text, never as markup.

Four dialects (small dog, medium dog, big dog, hound) each have their own sound pools.

Output is deterministic. The same text and dialect always produce the same translation. "Say it differently" changes the seed to get another version of the same text.

## Changing it

- New recognised words or reactions: the `KNOWN` table in `translator.js`. In a reaction, `{B}` is a loud bark, `{b}` a bark, `{g}` a growl, `{w}` a whine, `{h}` a howl, `{s}` a play sneeze, `{n}` a sniff and `{p}` a pant. Anything else is literal, so keep it to sounds.
- New dialect: add an entry to `DIALECTS` with all six pools (`grunt`, `bark`, `howl`, `growl`, `whine`, `ask`). The picker is built from that table, so no HTML change is needed.
- A sound is `[before, stretched letter, after, minimum repeats]`: `['w', 'o', 'f', 2]` is "woof" at its shortest.

## Design note

The palette is blue and yellow only. Dogs are dichromats and those are the hues they can tell apart.

## Licence

MIT. See `LICENSE`.
