document.addEventListener('DOMContentLoaded', function() {
    const creditFiles = [
        {
            label: 'Credits & Experience',
            path: 'credits%20%26%20experience.md'
        }
    ];

    const buttonContainer = document.getElementById('credits-buttons');
    const textContent = document.getElementById('text-content');

    creditFiles.forEach(file => {
        const button = document.createElement('a');
        button.className = 'nav-button';
        button.textContent = file.label;
        button.addEventListener('click', () => loadText(file.path));
        buttonContainer.appendChild(button);
    });

    // Auto-open the primary credits document on page load.
    if (creditFiles.length > 0) {
        loadText(creditFiles[0].path);
    }

    async function loadText(filename) {
        try {
            const response = await fetch(filename);
            const markdown = await response.text();
            const text = renderMarkdown(markdown);

            textContent.innerHTML = `
                <button class="close-button">x</button>
                <div class="text">${text}</div>
            `;

            textContent.classList.add('visible');

            const closeButton = textContent.querySelector('.close-button');
            closeButton.addEventListener('click', () => {
                textContent.classList.remove('visible');
            });
        } catch (error) {
            console.error('Error loading text:', error);
        }
    }

    function renderMarkdown(markdown) {
        // Basic markdown support for this document: bold and line breaks.
        const escaped = markdown
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        return escaped
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\r?\n/g, '<br>');
    }
});
