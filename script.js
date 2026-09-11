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
    const aboutTextElement = document.getElementById("aboutText");
    if (!aboutTextElement) return; // Every page loads this script; only About has the tag

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

            aboutTextElement.textContent = selectedLine;
        })
        .catch(error => console.error('Error fetching aboutme.txt:', error));
});

// Nav trays — a nav button that holds a set of links and pops them out. Opens
// on hover where there is a real cursor, and on tap/click everywhere. Trays can
// nest (Games holds K.A.C.S., which holds its own links).
document.addEventListener("DOMContentLoaded", function() {
    const trays = Array.from(document.querySelectorAll(".nav-tray"));
    if (trays.length === 0) return;

    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    // A tray the cursor opened closes again when the cursor leaves. Clicking one
    // latches it open instead, so it survives the mouse wandering off.
    const hoverOpened = new WeakSet();

    function setOpen(tray, open) {
        tray.classList.toggle("open", open);
        const toggle = tray.querySelector(":scope > .tray-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", String(open));
        if (!open) {
            hoverOpened.delete(tray);
            tray.querySelectorAll(".nav-tray.open").forEach(sub => setOpen(sub, false));
        }
    }

    // Only trays sharing a container close each other, so opening a nested tray
    // leaves the one holding it open.
    function closeSiblings(tray) {
        Array.from(tray.parentElement.children).forEach(sibling => {
            if (sibling !== tray && sibling.classList.contains("nav-tray")) {
                setOpen(sibling, false);
            }
        });
    }

    function closeAll() {
        trays.forEach(tray => setOpen(tray, false));
    }

    trays.forEach(tray => {
        const toggle = tray.querySelector(":scope > .tray-toggle");
        if (!toggle) return;

        toggle.addEventListener("click", function(event) {
            event.stopPropagation();
            if (!tray.classList.contains("open")) {
                closeSiblings(tray);
                setOpen(tray, true);
                return;
            }
            // The cursor got here first and opened it; this click means keep it.
            if (hoverOpened.has(tray)) {
                hoverOpened.delete(tray);
                return;
            }
            setOpen(tray, false);
        });

        if (canHover) {
            tray.addEventListener("mouseenter", function() {
                closeSiblings(tray);
                if (tray.classList.contains("open")) return;
                setOpen(tray, true);
                hoverOpened.add(tray);
            });
            tray.addEventListener("mouseleave", function() {
                if (hoverOpened.has(tray)) setOpen(tray, false);
            });
        }
    });

    document.addEventListener("click", function(event) {
        if (!event.target.closest(".nav-tray")) closeAll();
    });

    document.addEventListener("keydown", function(event) {
        if (event.key !== "Escape") return;
        const openTray = document.querySelector(".nav-tray.open");
        if (!openTray) return;
        closeAll();
        const toggle = openTray.querySelector(":scope > .tray-toggle");
        if (toggle) toggle.focus();
    });
});
