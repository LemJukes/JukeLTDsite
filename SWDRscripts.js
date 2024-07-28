document.addEventListener('DOMContentLoaded', function() {
    const buttonGrid = document.getElementById('buttonGrid');
    const tooltip = document.getElementById('tooltip');
    const resultText = document.getElementById('resultText');
    const copyButton = document.getElementById('copyButton');

    const symbols = [
        { symbol: '✅', label: 'Success' },
        { symbol: '➕', label: 'Advantage' },
        { symbol: '✨', label: 'Triumph' },
        { symbol: '❌', label: 'Failure' },
        { symbol: '⚠️', label: 'Threat' },
        { symbol: '💀', label: 'Despair' },
    ];

    symbols.forEach(item => {
        const span = document.createElement('span');
        span.textContent = item.symbol;
        span.addEventListener('mouseenter', () => {
            tooltip.textContent = item.label;
            tooltip.style.display = 'block';
        });
        span.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        span.addEventListener('click', () => {
            resultText.textContent += item.symbol + ' ';
        });
        buttonGrid.appendChild(span);
    });

    copyButton.addEventListener('click', copyToClipboard);

    function copyToClipboard() {
        const textToCopy = resultText.innerText;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy)
                .then(() => {
                    copyButton.disabled = true;
                    copyButton.textContent = 'Results Copied';
                    setTimeout(() => {
                        copyButton.disabled = false;
                        copyButton.textContent = 'Copy to Clipboard';
                    }, 3000);
                })
                .catch(err => showTooltip('Failed to copy!'));
        } else {
            fallbackCopyTextToClipboard(textToCopy);
        }
    }

    function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = 0;
        textArea.style.left = 0;
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = 0;
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                copyButton.disabled = true;
                copyButton.textContent = 'Results Copied';
                setTimeout(() => {
                    copyButton.disabled = false;
                    copyButton.textContent = 'Copy to Clipboard';
                }, 3000);
            } else {
                showTooltip('Failed to copy!');
            }
        } catch (err) {
            showTooltip('Failed to copy!');
        }
        document.body.removeChild(textArea);
    }

    window.clearResult = function() {
        resultText.textContent = '';
    };

    function showTooltip(message) {
        tooltip.textContent = message;
        tooltip.style.display = 'block';
        setTimeout(() => tooltip.style.display = 'none', 2000);
    }
});
