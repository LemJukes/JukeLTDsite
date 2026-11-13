/*
 * C.A.T.S. translation engine.
 *
 * Pure functions, no DOM. Loaded as a plain script in the browser (exposes
 * window.CATS) and require()-able from Node for testing.
 *
 * How a translation is built:
 *   1. The text is split into sentences, and each sentence into word, number,
 *      punctuation and whitespace tokens. Whitespace and punctuation pass
 *      through untouched, so the shape of the original survives.
 *   2. Each sentence gets a mood from its punctuation and vocabulary
 *      (excited, asking, sad, cross, plain). Mood picks which sounds are likely.
 *   3. Words a dog actually knows (walk, treat, squirrel, vet...) get a
 *      specific vocal reaction instead of a generic bark.
 *   4. Every other word becomes a sound whose shape follows the word's length:
 *      grunts for one letter, clipped barks for short words, stretched barks
 *      for medium ones, double barks and howls for long ones.
 *   5. Numbers are barked out, up to the point a dog loses count.
 *   6. Now and then a play sneeze, sniff, pant or other odd noise slips in.
 *
 * Everything in the output is a sound a dog makes. No stage directions.
 * Anything shaped like an HTML tag is dropped from the input first.
 *
 * Output is deterministic: the same text, dialect and take always give the
 * same result. Randomness comes from a generator seeded with those three.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CATS = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- seeded randomness -------------------------------------------------

    function hash(str) {
        var h = 1779033703 ^ str.length;
        for (var i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
            h = (h << 13) | (h >>> 19);
        }
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^ (h >>> 16)) >>> 0;
    }

    function makeRng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---- sounds ------------------------------------------------------------
    // A sound is [before, stretchable letter, after, minimum repeats].
    // ['w','o','f',2] at 2 repeats is "woof", at 5 is "wooooof".

    var DIALECTS = {
        small: {
            label: 'Small dog',
            grunt: ['ip', 'yp', 'ap', 'rf'],
            bark: [['y', 'i', 'p', 1], ['y', 'a', 'p', 1], ['', 'a', 'rf', 1], ['r', 'u', 'ff', 1], ['y', 'e', 'lp', 1]],
            howl: [['ar', 'o', '', 2], ['y', 'i', '', 3], ['aw', 'o', '', 2]],
            growl: [['g', 'r', '', 2], ['r', 'r', 'f', 2]],
            whine: [['', 'e', '', 3], ['hn', 'n', '', 1], ['m', 'e', 'h', 1]],
            ask: [['ar', 'o', '', 2], ['mr', 'r', 'f', 1], ['y', 'i', 'p', 1]]
        },
        medium: {
            label: 'Medium dog',
            grunt: ['wf', 'rf', 'mf', 'hf'],
            bark: [['w', 'u', 'f', 1], ['w', 'o', 'f', 2], ['r', 'u', 'ff', 1], ['', 'a', 'rf', 1], ['b', 'a', 'rk', 1], ['w', 'u', 'rf', 1]],
            howl: [['aw', 'o', '', 3], ['ar', 'o', '', 2], ['ow', 'o', '', 2]],
            growl: [['g', 'r', '', 3], ['r', 'r', 'f', 2], ['hr', 'r', 'm', 1]],
            whine: [['hn', 'n', '', 2], ['', 'e', '', 3], ['mm', 'm', 'f', 1]],
            ask: [['ar', 'o', '', 2], ['hr', 'r', 'm', 1], ['r', 'u', 'h', 1]]
        },
        big: {
            label: 'Big dog',
            grunt: ['hf', 'mf', 'bf', 'wf'],
            bark: [['b', 'o', 'rk', 1], ['b', 'o', 'f', 2], ['w', 'o', 'f', 2], ['r', 'u', 'ff', 1], ['wh', 'u', 'ff', 1], ['h', 'u', 'ff', 1]],
            howl: [['aw', 'o', '', 3], ['b', 'o', '', 4], ['ow', 'o', '', 3]],
            growl: [['g', 'r', '', 4], ['hr', 'r', 'm', 2], ['r', 'r', 'gh', 2]],
            whine: [['hn', 'n', '', 2], ['mm', 'm', 'f', 2], ['h', 'm', 'ph', 1]],
            ask: [['hr', 'r', 'm', 2], ['r', 'o', '', 2], ['b', 'o', 'f', 2]]
        },
        hound: {
            label: 'Hound',
            grunt: ['rf', 'wf', 'ar', 'mf'],
            bark: [['ar', 'o', '', 2], ['bar', 'o', '', 2], ['w', 'o', 'f', 2], ['r', 'o', '', 2], ['', 'a', 'rf', 1]],
            howl: [['aw', 'o', '', 4], ['ar', 'o', '', 4], ['bar', 'o', '', 4], ['ow', 'o', '', 4]],
            growl: [['g', 'r', '', 3], ['r', 'r', 'f', 2]],
            whine: [['', 'o', '', 3], ['hn', 'n', '', 2], ['aw', 'w', '', 1]],
            ask: [['ar', 'o', '', 3], ['r', 'o', '', 2], ['bar', 'o', '', 2]]
        }
    };

    function shape(sound, repeats) {
        var n = Math.max(sound[3], Math.min(repeats, 9));
        return sound[0] + sound[1].repeat(n) + sound[2];
    }

    // ---- noises that are not barks ---------------------------------------

    var SNEEZE = ['pchoo', 'fnff', 'ptchf', 'hcchf', 'achff'];   // play sneezes
    var SNIFF = ['snff', 'snf snf', 'fnf fnf'];
    var PANT = ['hah hah hah', 'heh heh heh', 'hahf hahf'];
    var SIGH = ['hhhf', 'hmmf', 'pfff'];
    // Dropped in after a sentence now and then.
    var ODD = ['hrmph', 'mrrf', 'snff snff', 'hah hah', 'mlem', 'brrrf', 'a-roo', 'grmbl', 'nnff'];
    // Occasionally stands in for an ordinary word.
    var ODD_WORD = ['mrowf', 'brrf', 'rrowf', 'a-roo', 'wrruf', 'hrrmf', 'boowf', 'arrf'];

    // ---- vocabulary a dog recognises --------------------------------------
    // {B} loud bark, {b} bark, {g} growl, {w} whine, {h} howl,
    // {s} play sneeze, {n} sniff, {p} pant. Everything else is literal.

    var KNOWN = [
        [['walk', 'walks', 'walkies', 'walking', 'lead', 'leash'],
            ['{B}! {B}! {B}!', '{B}-{B}-{B}! {p}', '{h}! {B}!']],
        [['treat', 'treats', 'snack', 'snacks', 'biscuit', 'biscuits', 'cookie', 'bone'],
            ['{n} {b}?', '{w}... {b}?', 'mlem {b}']],
        [['ball', 'fetch', 'stick', 'frisbee', 'toy', 'play'],
            ['{B} {B}! {s}', '{s} {B}!', '{B}! {p}']],
        [['squirrel', 'squirrels', 'rabbit', 'pigeon', 'pigeons'],
            ['{B}!! {B}-{B}-{B}!!', '{g}... {B}!!!', '{B}! {B}! {B}!']],
        [['vet', 'bath', 'vacuum', 'hoover', 'fireworks', 'thunder', 'nails'],
            ['{w}...', '{w} {w}...', 'hnnf {w}']],
        [['cat', 'cats', 'kitten'],
            ['{g}...', '{g} {b}', '{n} {g}']],
        [['dinner', 'food', 'breakfast', 'hungry', 'eat', 'cheese', 'bacon', 'chicken', 'sausage', 'kibble', 'lunch'],
            ['mlem {b} {b}', '{B}! mlem mlem', '{n} {n} {b}?']],
        [['park', 'outside', 'car', 'ride', 'beach', 'garden', 'yard'],
            ['{B}! {p}', '{h}! {B}!', '{B} {B}! {s}']],
        [['no', 'bad', 'stop', 'off', 'naughty'],
            ['{w}', 'hmph', 'hrmf']],
        [['sit', 'stay', 'heel', 'wait'],
            ['{b}', 'hmf', '{w}?']],
        [['hello', 'hi', 'hey', 'home'],
            ['{B}! {B}!', '{h}! {p}', '{B}! {s}']],
        [['bye', 'goodbye', 'leaving', 'work', 'later'],
            ['{w}...', '{w} {h}', '{w}']],
        [['postman', 'mailman', 'doorbell', 'delivery', 'knock', 'door'],
            ['{B}! {B}! {B}! {B}!', '{g} {B}!!', '{B}!! {B}!!']],
        [['dog', 'dogs', 'puppy', 'puppies', 'pup'],
            ['{n} {n} {b}?', '{b}! {s}']],
        [['love', 'cuddle', 'cuddles', 'pet', 'pets', 'scratch', 'belly'],
            ['mlem mlem', '{p}', 'mrrrf']],
        [['sorry'],
            ['mlem', '{w} mlem']],
        [['bed', 'sleep', 'nap', 'tired', 'night', 'bedtime'],
            ['aaowwh', 'hhhmf', '{w} aaowwh']]
    ];
    var KNOWN_MAP = {};
    KNOWN.forEach(function (row) {
        row[0].forEach(function (word) { KNOWN_MAP[word] = row[1]; });
    });

    var PRAISE = ['{B}! {p}', '{s} {B}!', '{b} {b}! mlem', '{h}!'];
    var PRAISED = { boy: 1, girl: 1, dog: 1, pup: 1, puppy: 1, doggo: 1, job: 1 };

    var SAD = { sad: 1, miss: 1, alone: 1, lonely: 1, lost: 1, hurt: 1, cry: 1, crying: 1, gone: 1, poor: 1, sick: 1, unfortunately: 1 };
    var CROSS = { angry: 1, hate: 1, stupid: 1, annoying: 1, never: 1, wrong: 1, mine: 1, intruder: 1, stranger: 1 };

    // ---- tokenising --------------------------------------------------------

    var TOKEN = /(\s+)|([\p{L}]+(?:['’][\p{L}]+)*)|(\p{N}+)|([^\s\p{L}\p{N}]+)/gu;

    function tokenize(text) {
        var out = [], m;
        TOKEN.lastIndex = 0;
        while ((m = TOKEN.exec(text)) !== null) {
            if (m[1] !== undefined) out.push({ type: 'space', s: m[1] });
            else if (m[2] !== undefined) out.push({ type: 'word', s: m[2] });
            else if (m[3] !== undefined) out.push({ type: 'number', s: m[3] });
            else out.push({ type: 'punct', s: m[4] });
        }
        return out;
    }

    // A sentence ends after . ! ? or an ellipsis, or just before a line break.
    function sentences(tokens) {
        var all = [], cur = [];
        tokens.forEach(function (tok) {
            if (tok.type === 'space' && /\n/.test(tok.s) && cur.length) { all.push(cur); cur = []; }
            cur.push(tok);
            if (tok.type === 'punct' && /[.!?…]/.test(tok.s)) { all.push(cur); cur = []; }
        });
        if (cur.length) all.push(cur);
        return all;
    }

    function moodOf(sentence) {
        var end = '';
        var sad = false, cross = false, shouted = 0, words = 0;
        sentence.forEach(function (tok) {
            if (tok.type === 'punct' && /[.!?…]/.test(tok.s)) end = tok.s;
            if (tok.type !== 'word') return;
            words++;
            var w = tok.s.toLowerCase();
            if (SAD[w]) sad = true;
            if (CROSS[w]) cross = true;
            if (tok.s.length > 1 && tok.s === tok.s.toUpperCase() && tok.s !== tok.s.toLowerCase()) shouted++;
        });
        var mood = 'plain';
        if (sad) mood = 'sad';
        else if (cross) mood = 'cross';
        else if (end.indexOf('?') !== -1) mood = 'asking';
        else if (end.indexOf('!') !== -1 || (words > 1 && shouted === words)) mood = 'excited';
        return { mood: mood, asking: end.indexOf('?') !== -1, trailing: /\.\.\.|…/.test(end) };
    }

    // ---- translation -------------------------------------------------------

    function matchCase(sound, source) {
        var letters = source.replace(/[^\p{L}]/gu, '');
        if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return sound.toUpperCase();
        if (letters && letters[0] !== letters[0].toLowerCase()) return sound.charAt(0).toUpperCase() + sound.slice(1);
        return sound;
    }

    function translate(text, options) {
        options = options || {};
        var source = String(text);
        // Pasted markup is not speech. Drop anything shaped like a tag.
        // Where a tag sat between two gaps, keep one gap, not both.
        text = source.replace(/([ \t]*)<\/?[a-zA-Z][^<>]*>([ \t]*)/g, function (_, before, after) {
            return before && after ? before : before + after;
        });
        var dialectId = DIALECTS[options.dialect] ? options.dialect : 'medium';
        var d = DIALECTS[dialectId];
        var rng = makeRng(hash(source + '\u0000' + dialectId + '\u0000' + (options.take || 0)));
        var segments = [];
        var lastSound = null;

        function pick(list) { return list[Math.floor(rng() * list.length)]; }

        // Never the same sound twice running: that is what made v1 read as "wuf wuf wuf".
        function pickSound(pool) {
            var s = pick(pool);
            if (pool.length > 1) { while (s === lastSound) s = pick(pool); }
            lastSound = s;
            return s;
        }

        function push(type, s) {
            var prev = segments[segments.length - 1];
            // Two sounds never butt up against each other (a number typed hard against a word, "4x4").
            if (prev && prev.type === 'sound' && type === 'sound') {
                segments.push({ type: 'space', s: ' ' });
                prev = segments[segments.length - 1];
            }
            if (prev && prev.type === type) prev.s += s;
            else segments.push({ type: type, s: s });
        }

        // Fill in a reaction template and add it as one run of sound.
        function react(template, sourceWord, punctFollows) {
            if (punctFollows) template = template.replace(/[.!?]+$/, '');
            var filled = template.replace(/\{([Bbgwhsnp])\}/g, function (_, key) {
                if (key === 'g') return shape(pickSound(d.growl), 3);
                if (key === 'w') return shape(pickSound(d.whine), 2);
                if (key === 'h') return shape(pickSound(d.howl), 3);
                if (key === 's') return pick(SNEEZE);
                if (key === 'n') return pick(SNIFF);
                if (key === 'p') return pick(PANT);
                var bark = shape(pickSound(d.bark), 2);
                return key === 'B' ? bark.toUpperCase() : bark;
            });
            push('sound', matchCase(filled, sourceWord));
        }

        function wordSound(word, mood) {
            var len = word.replace(/[^\p{L}]/gu, '').length;
            if (len <= 1) return pick(d.grunt);

            var pool = d.bark;
            var roll = rng();
            if (mood === 'sad' && roll < 0.6) pool = d.whine;
            else if (mood === 'cross' && roll < 0.6) pool = d.growl;

            if (len === 2) return shape(pickSound(pool), 1);
            // Now and then, something that is not quite a bark.
            if (len >= 4 && rng() < 0.07) return pick(ODD_WORD);
            if (len <= 6) {
                var s = shape(pickSound(pool), 1 + Math.floor((len - 3) / 2));
                // Excited dogs repeat themselves.
                if (mood === 'excited' && rng() < 0.3) return s + '-' + s;
                return s;
            }
            if (len <= 9) {
                if (rng() < 0.45) {
                    var a = shape(pickSound(pool), 1), b = shape(pickSound(pool), 2);
                    return a + '-' + b;
                }
                return shape(pickSound(pool), Math.floor(len / 2));
            }
            // Long words are howled.
            if (pool === d.bark || rng() < 0.5) pool = d.howl;
            return shape(pickSound(pool), Math.floor(len / 2));
        }

        function number(tok) {
            var n = parseInt(tok.s, 10);
            if (n === 0) { push('sound', 'hff'); return; }
            var count = Math.min(n, 6);
            var barks = [];
            var sound = pickSound(d.bark);
            for (var i = 0; i < count; i++) barks.push(shape(sound, 1));
            // Past six, a dog loses count.
            push('sound', barks.join(' ') + (n > 6 ? ' ' + shape(pickSound(d.ask), 2) + '?' : ''));
        }

        // A stray noise held back until the next sentence starts, so it only
        // lands where there is a gap for it.
        var pending = null;
        function flushPending(nextTok) {
            if (pending && (!nextTok || nextTok.type === 'space')) {
                var tail = segments[segments.length - 1];
                if (tail && tail.type !== 'space') push('space', ' ');
                push('sound', pending.charAt(0).toUpperCase() + pending.slice(1));
                push('punct', SNEEZE.indexOf(pending) !== -1 ? '!' : '.');
            }
            pending = null;
        }

        sentences(tokenize(text)).forEach(function (sentence) {
            var m = moodOf(sentence);
            flushPending(sentence[0]);
            var wordIdx = [];
            sentence.forEach(function (tok, i) { if (tok.type === 'word') wordIdx.push(i); });
            var lastWord = wordIdx.length ? wordIdx[wordIdx.length - 1] : -1;
            var skip = -1;
            function punctAfter(i) { return !!sentence[i + 1] && sentence[i + 1].type === 'punct'; }

            sentence.forEach(function (tok, i) {
                if (tok.type === 'space' || tok.type === 'punct') { push(tok.type, tok.s); return; }
                if (tok.type === 'number') { number(tok); return; }
                if (i === skip) { segments.pop(); return; } // drop the space before a swallowed word

                var lower = tok.s.toLowerCase();

                // "good boy", "good girl", "good dog": one reaction for the pair.
                if (lower === 'good') {
                    var nextPos = wordIdx.indexOf(i) + 1;
                    var next = nextPos < wordIdx.length ? sentence[wordIdx[nextPos]] : null;
                    if (next && PRAISED[next.s.toLowerCase()]) {
                        react(pick(PRAISE), tok.s, punctAfter(wordIdx[nextPos]));
                        skip = wordIdx[nextPos];
                        return;
                    }
                }

                if (KNOWN_MAP[lower]) { react(pick(KNOWN_MAP[lower]), tok.s, punctAfter(i)); return; }

                if (m.asking && i === lastWord) {
                    push('sound', matchCase(shape(pickSound(d.ask), 2), tok.s));
                    return;
                }
                push('sound', matchCase(wordSound(tok.s, m.mood), tok.s));
            });

            // Maybe a stray noise after the sentence.
            pending = null;
            if (!wordIdx.length) return;
            if (m.trailing) { if (rng() < 0.6) pending = pick(SIGH); }
            else if (rng() < 0.16) pending = rng() < 0.45 ? pick(SNEEZE) : pick(ODD);
        });
        flushPending(null);

        // Trim whitespace left at either end (stripped tags, trailing input space).
        while (segments.length && segments[segments.length - 1].type === 'space') segments.pop();
        while (segments.length && segments[0].type === 'space') segments.shift();

        return {
            segments: segments,
            text: segments.map(function (s) { return s.s; }).join('')
        };
    }

    return {
        translate: translate,
        dialects: Object.keys(DIALECTS).map(function (id) { return { id: id, label: DIALECTS[id].label }; })
    };
});
