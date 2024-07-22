const planets = [
    { name: "Mercury", distance: 0.4, radius: 0.38, period: 88 },
    { name: "Venus", distance: 0.7, radius: 0.95, period: 225 },
    { name: "Earth", distance: 1.0, radius: 1.0, period: 365 },
    { name: "Mars", distance: 1.5, radius: 0.53, period: 687 },
    { name: "Jupiter", distance: 5.2, radius: 11.2, period: 4333 },
    { name: "Saturn", distance: 9.5, radius: 9.45, period: 10759 },
    { name: "Uranus", distance: 19.8, radius: 4.0, period: 30687 },
    { name: "Neptune", distance: 30.1, radius: 3.88, period: 60190 }
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
        const angle = (time / planet.period) * 2 * Math.PI * 0.25; // 10x real time

        const x = centerX + distance * Math.cos(angle) - planetElement.clientWidth / 2;
        const y = centerY + distance * Math.sin(angle) - planetElement.clientHeight / 2;

        planetElement.style.left = `${x}px`;
        planetElement.style.top = `${y}px`;
    });
    requestAnimationFrame(updatePositions);
}

requestAnimationFrame(updatePositions);

window.addEventListener('resize', () => {
    window.location.reload();
});