// Background Orrery Effect Scripts
const planets = [
    { name: "Mercury", distance: 0.4, radius: 0.38, period: 88, eccentricity: 0.205 },
    { name: "Venus", distance: 0.7, radius: 0.95, period: 225, eccentricity: 0.007 },
    { name: "Earth", distance: 1.0, radius: 1.0, period: 365, eccentricity: 0.017 },
    { name: "Mars", distance: 1.5, radius: 0.53, period: 687, eccentricity: 0.094 },
    { name: "Jupiter", distance: 5.2, radius: 11.2, period: 4333, eccentricity: 0.049 },
    { name: "Saturn", distance: 9.5, radius: 9.45, period: 10759, eccentricity: 0.056 },
    { name: "Uranus", distance: 19.8, radius: 4.0, period: 30687, eccentricity: 0.046 },
    { name: "Neptune", distance: 30.1, radius: 3.88, period: 60190, eccentricity: 0.010 }
];

const orrery = document.getElementById('orrery');
const orrerySize = Math.min(window.innerWidth, window.innerHeight);
const centerX = window.innerWidth / 2;
const centerY = window.innerHeight / 2;
const maxDistance = planets[planets.length - 1].distance;

const scale = (orrerySize / 1) / (maxDistance + 0.5); // Scale to fit the entire system within the window

planets.forEach(planet => {
    const planetElement = document.createElement('div');
    planetElement.className = 'planet';
    planetElement.id = planet.name;
    const radius = planet.radius * scale * 5; // Scaled for better visibility

    planetElement.style.width = `${radius}px`;
    planetElement.style.height = `${radius}px`;
    orrery.appendChild(planetElement);
});

function updatePositions(time) {
    planets.forEach(planet => {
        const planetElement = document.getElementById(planet.name);
        const distance = planet.distance * scale;
        const angle = (time / planet.period) * 2 * Math.PI * 0.125;
        
        // Apply elliptical orbit using the eccentricity
        const eccentricity = planet.eccentricity;
        const a = distance; // Semi-major axis
        const b = distance * Math.sqrt(1 - eccentricity * eccentricity); // Semi-minor axis

        const x = centerX + a * Math.cos(angle) - planetElement.clientWidth / 2;
        const y = centerY + b * Math.sin(angle) - planetElement.clientHeight / 2;

        planetElement.style.left = `${x}px`;
        planetElement.style.top = `${y}px`;
    });
    requestAnimationFrame(updatePositions);
}

requestAnimationFrame(updatePositions);

window.addEventListener('resize', () => {
    window.location.reload();
});

// About Me page script
document.addEventListener("DOMContentLoaded", function() {
    fetch('aboutme.txt')
        .then(response => response.text())
        .then(text => {
            const lines = text.split('\n').filter(line => line.trim() !== '');

            // Create a weighted array where the probability decreases as the index increases
            const weights = lines.map((_, index) => lines.length - index);
            const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);

            // Generate a random number between 0 and totalWeight
            const randomNum = Math.random() * totalWeight;

            // Find the line based on the weighted random number
            let cumulativeWeight = 0;
            let selectedLine = lines[0];
            let selectedProbability = 0;
            for (let i = 0; i < lines.length; i++) {
                cumulativeWeight += weights[i];
                if (randomNum < cumulativeWeight) {
                    selectedLine = lines[i];
                    selectedProbability = (weights[i] / totalWeight) * 100;
                    break;
                }
            }

            // Log the probability of the selected line
            console.log(`Line: "${selectedLine}" has a probability of ${selectedProbability.toFixed(2)}%`);

            const aboutTextElement = document.getElementById("aboutText");
            if (aboutTextElement) {
                aboutTextElement.textContent = selectedLine;
            }
        })
        .catch(error => console.error('Error fetching aboutme.txt:', error));
});

