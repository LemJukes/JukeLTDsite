document.addEventListener('DOMContentLoaded', function() {
    const buttonGrid = document.getElementById('buttonGrid');
    const tooltip = document.getElementById('tooltip');
    const resultText = document.getElementById('resultText');

    const symbols = [
        { symbol: '✅', label: 'Success' },
        { symbol: '➕', label: 'Advantage' },
        { symbol: '❌', label: 'Failure' },
        { symbol: '⚠️', label: 'Threat' },
        { symbol: '✨', label: 'Triumph' },
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

    window.copyToClipboard = function() {
        navigator.clipboard.writeText(resultText.textContent).then(() => {
            alert('Copied to clipboard');
        }, (err) => {
            alert('Failed to copy');
        });
    };

    window.clearResult = function() {
        resultText.textContent = '';
    };
});