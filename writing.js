document.addEventListener('DOMContentLoaded', function() {
    const writingFiles = [
        'gravity-baby.txt',
        // Add more files as they're created
    ];

    const buttonContainer = document.getElementById('writing-buttons');
    const textContent = document.getElementById('text-content');

    writingFiles.forEach(file => {
        const button = document.createElement('a');
        button.className = 'nav-button';
        button.textContent = file.replace('.txt', '').replace(/-/g, ' ');
        button.addEventListener('click', () => loadText(file));
        buttonContainer.appendChild(button);
    });

    async function loadText(filename) {
        try {
            const response = await fetch(`Writing Files/${filename}`);
            const text = await response.text();
            
            textContent.innerHTML = `
                <button class="close-button">×</button>
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
});

