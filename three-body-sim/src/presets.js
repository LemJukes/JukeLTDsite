// presets.js — named initial conditions for the three-body system.
//
// Each preset's build() returns plain body configs plus recommended G, softening
// and a camera framing distance. NBodySystem.setBodies() will move everything to
// the centre-of-mass frame and recentre on the origin; because that is just a
// Galilean boost + translation, it preserves all relative dynamics, so presets
// can be written in whatever frame is most convenient.

import * as THREE from 'three';

// Phosphor palette: green, amber, cyan — the three CRT classics.
export const COLORS = [0x4dff88, 0xffc24d, 0x6fe0ff];

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Visual radius from mass at fixed density (radius ∝ mass^(1/3)).
const radiusOf = (mass) => 1.4 * Math.cbrt(mass);

function body(name, mass, pos, vel, color) {
  return { name, mass, radius: radiusOf(mass), pos, vel, color };
}

/**
 * Kepler scaling: blow positions up by `scale` while keeping G and masses fixed.
 * To traverse the identical orbit shape, velocities scale by 1/sqrt(scale).
 * Used to render the unit-scale figure-eight at a comfortable size.
 */
function scaleBodies(bodies, scale) {
  const vf = 1 / Math.sqrt(scale);
  for (const b of bodies) {
    b.pos.multiplyScalar(scale);
    b.vel.multiplyScalar(vf);
  }
  return bodies;
}

export const presets = {
  default: {
    label: 'DEFAULT',
    build() {
      // Equilateral triangle in the z=0 plane with gentle tangential velocities.
      // Not a periodic solution — it dissolves into the chaos that makes the
      // three-body problem famous, which is exactly the point of "default".
      const R = 12;
      const bodies = [];
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 2) + (i * 2 * Math.PI) / 3;
        const pos = v3(R * Math.cos(a), R * Math.sin(a), 0);
        // tangential (perpendicular to radius), same rotational sense
        const speed = 0.18;
        const vel = v3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(speed * R ** 0.5 * 0.1);
        bodies.push(body(`Body ${'ABC'[i]}`, 1, pos, vel, COLORS[i]));
      }
      return { bodies, G: 1, softening: 0.4, cameraDistance: 42 };
    },
  },

  figure8: {
    label: 'FIGURE-8',
    build() {
      // Chenciner–Montgomery figure-eight choreography (G=1, m=1). Three equal
      // masses chase each other around a single figure-eight curve. It is a
      // stable periodic solution and the cleanest possible proof that the
      // integrator and force law are correct.
      const bodies = [
        body('Body A', 1, v3(0.97000436, -0.24308753, 0), v3(0.4662036850, 0.4323657300, 0), COLORS[0]),
        body('Body B', 1, v3(-0.97000436, 0.24308753, 0), v3(0.4662036850, 0.4323657300, 0), COLORS[1]),
        body('Body C', 1, v3(0, 0, 0), v3(-0.93240737, -0.86473146, 0), COLORS[2]),
      ];
      scaleBodies(bodies, 12);
      // small softening so the close passes near the centre stay faithful
      return { bodies, G: 1, softening: 0.05, cameraDistance: 42 };
    },
  },

  lagrange: {
    label: 'LAGRANGE',
    build() {
      // Exact rotating equilateral triangle (Lagrange L4/L5 family). For three
      // equal masses at circumradius R, circular angular speed gives
      //   v = sqrt(G*m / (sqrt(3) * R)),  velocity perpendicular to the radius.
      const R = 11;
      const m = 1;
      const G = 1;
      const speed = Math.sqrt((G * m) / (Math.sqrt(3) * R));
      const bodies = [];
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 2) + (i * 2 * Math.PI) / 3;
        const pos = v3(R * Math.cos(a), R * Math.sin(a), 0);
        const vel = v3(-Math.sin(a), Math.cos(a), 0).multiplyScalar(speed);
        bodies.push(body(`Body ${'ABC'[i]}`, m, pos, vel, COLORS[i]));
      }
      return { bodies, G, softening: 0.2, cameraDistance: 40 };
    },
  },

  binary: {
    label: 'BINARY+3RD',
    build() {
      // A tight, heavy binary with a light companion on a wide orbit —
      // a hierarchical system that stays bound and readable for a long time.
      const bodies = [
        body('Body A', 4, v3(3, 0, 0), v3(0, 0.7, 0), COLORS[0]),
        body('Body B', 4, v3(-3, 0, 0), v3(0, -0.7, 0), COLORS[1]),
        body('Body C', 1, v3(45, 0, 6), v3(0, 0.55, 0.05), COLORS[2]),
      ];
      return { bodies, G: 1, softening: 0.3, cameraDistance: 130 };
    },
  },

  random: {
    label: 'RANDOM',
    build() {
      // Random masses, fully 3D positions and small velocities. Momentum is
      // zeroed by setBodies(); the camera auto-frames since extent is unknown.
      const rand = (a, b) => a + Math.random() * (b - a);
      const bodies = [];
      for (let i = 0; i < 3; i++) {
        const mass = rand(1, 8);
        const pos = v3(rand(-22, 22), rand(-22, 22), rand(-14, 14));
        const vel = v3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.3, 0.3));
        bodies.push(body(`Body ${'ABC'[i]}`, mass, pos, vel, COLORS[i]));
      }
      return { bodies, G: 1, softening: 0.5, cameraDistance: null /* auto-frame */ };
    },
  },
};

export const presetOrder = ['default', 'figure8', 'lagrange', 'binary', 'random'];
