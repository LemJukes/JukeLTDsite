/*
 * C.A.T.S. page behaviour. The translation itself lives in translator.js;
 * this file only wires the form to it and draws the result.
 */
(function () {
    'use strict';

    var STORE_KEY = 'cats:dialect';

    var form = document.getElementById('translator');
    var input = document.getElementById('inputText');
    var output = document.getElementById('output');
    var empty = document.getElementById('outputEmpty');
    var announcer = document.getElementById('announcer');
    var ball = document.getElementById('translateButton');
    var retake = document.getElementById('retakeButton');
    var copy = document.getElementById('copyButton');
    var reset = document.getElementById('resetButton');
    var dialectBox = document.getElementById('dialectOptions');

    var EMPTY_DEFAULT = empty.textContent;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    var take = 0;          // bumped by "Say it differently"
    var lastSource = '';   // text the current output was made from
    var lastText = '';     // plain-text translation, for Copy
    var timer = null;

    // ---- dialect picker ----

    function savedDialect() {
        try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    }

    function buildDialects() {
        var saved = savedDialect();
        var ids = CATS.dialects.map(function (d) { return d.id; });
        var current = ids.indexOf(saved) !== -1 ? saved : 'medium';
        CATS.dialects.forEach(function (d) {
            var radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'dialect';
            radio.id = 'dialect-' + d.id;
            radio.value = d.id;
            radio.checked = d.id === current;
            var label = document.createElement('label');
            label.htmlFor = radio.id;
            label.textContent = d.label;
            dialectBox.appendChild(radio);
            dialectBox.appendChild(label);
        });
    }

    function dialect() {
        var checked = dialectBox.querySelector('input:checked');
        return checked ? checked.value : 'medium';
    }

    // ---- drawing ----

    function stopTyping() {
        if (timer !== null) { clearTimeout(timer); timer = null; }
    }

    function setTools(enabled) {
        retake.disabled = copy.disabled = reset.disabled = !enabled;
    }

    function showEmpty(message) {
        stopTyping();
        output.textContent = '';
        empty.textContent = message;
        empty.hidden = false;
        lastText = '';
        announcer.textContent = '';
        setTools(false);
        reset.disabled = input.value === '';
    }

    // Segments are added as text nodes and spans via textContent, never as
    // HTML, so whatever was typed cannot be interpreted as markup.
    function draw(result) {
        stopTyping();
        output.textContent = '';
        empty.hidden = true;
        lastText = result.text;
        setTools(true);

        var nodes = result.segments.map(function (seg) {
            if (seg.type === 'space') return { node: document.createTextNode(''), s: seg.s };
            var span = document.createElement('span');
            span.className = seg.type;
            return { node: span, s: seg.s };
        });

        if (reduceMotion.matches) {
            nodes.forEach(function (n) { n.node.textContent = n.s; output.appendChild(n.node); });
            announcer.textContent = result.text;
            return;
        }

        // Type it out. Long translations speed up so the wait stays under ~3s.
        var total = result.text.length;
        var delay = Math.max(6, Math.min(34, 3000 / Math.max(total, 1)));
        var i = 0, pos = 0;

        (function step() {
            if (i >= nodes.length) { timer = null; announcer.textContent = result.text; return; }
            var n = nodes[i];
            if (pos === 0) output.appendChild(n.node);
            pos++;
            n.node.textContent = n.s.slice(0, pos);
            if (pos >= n.s.length) { i++; pos = 0; }
            timer = setTimeout(step, delay);
        })();
    }

    function throwBall() {
        if (reduceMotion.matches) return;
        ball.classList.remove('is-thrown');
        void ball.offsetWidth; // restart the animation
        ball.classList.add('is-thrown');
    }

    // ---- actions ----

    function run() {
        var text = input.value;
        if (!text.trim()) {
            showEmpty('Nothing to translate. Type something in the Human box first.');
            input.focus();
            return;
        }
        var result = CATS.translate(text, { dialect: dialect(), take: take });
        if (!result.text) {
            showEmpty('Nothing in that for a dog to react to. Try some words.');
            return;
        }
        lastSource = text;
        throwBall();
        draw(result);
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        take = 0;
        run();
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            take = 0;
            run();
        }
    });

    input.addEventListener('input', function () {
        if (!lastText) reset.disabled = input.value === '';
    });

    retake.addEventListener('click', function () {
        take++;
        run();
    });

    dialectBox.addEventListener('change', function () {
        try { localStorage.setItem(STORE_KEY, dialect()); } catch (e) { /* storage blocked: not remembered */ }
        // Re-translate what is on screen so the change is visible straight away.
        if (lastText && input.value === lastSource) run();
    });

    copy.addEventListener('click', function () {
        if (!lastText) return;
        var done = function () {
            copy.textContent = 'Copied';
            setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
        };
        var fallback = function () {
            var ta = document.createElement('textarea');
            ta.value = lastText;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            if (ok) done(); else copy.textContent = 'Copy failed';
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(lastText).then(done, fallback);
        } else {
            fallback();
        }
    });

    reset.addEventListener('click', function () {
        input.value = '';
        take = 0;
        lastSource = '';
        showEmpty(EMPTY_DEFAULT);
        input.focus();
    });

    buildDialects();
})();
