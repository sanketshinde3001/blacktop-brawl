# Blacktop Brawl

A retro-inspired motorcycle combat racing game that runs in your browser. Race through a five-level career, fight rival riders, upgrade your bike, and try to reach the championship.

[![README views](https://hits.sh/github.com/sanketshinde3001/blacktop-brawl.svg?style=flat-square&label=README%20views&color=ef493b&labelColor=30363d)](https://hits.sh/github.com/sanketshinde3001/blacktop-brawl/)

**[Play the game](https://blacktop-brawl.vercel.app/)** · **[Visit the game website](https://sanketshinde3001.github.io/blacktop-brawl/)**

![Blacktop Brawl game artwork](public/og-image.jpg)

## Features

- Five career levels across five roads, with day, dusk, night, and rain conditions
- Bike shop, upgrades, rider records, and achievements
- Punches, kicks, weapons, traffic, rival racers, and police
- Chase, high, and first-person cameras, plus a rear-view mirror and look-back view
- Quick races, endless runs, daily challenges, and two-player split screen
- Keyboard, gamepad, and touch controls

## How to play

| Action | Keyboard |
| --- | --- |
| Accelerate / brake | ↑ / ↓ |
| Steer | ← / → |
| Hit left / right | A / D |
| Kick | S |
| Nitro | Space |
| Look behind (hold) | Q |
| Change camera | E |
| Pause | Esc |

Finish in fourth place or better to qualify for the next race. Earn cash for bike upgrades. Rain reduces grip, and crashing near a police officer can get you busted. On phones and tablets, use the on-screen controls in landscape orientation.

**Two-player split screen:** Player 1 uses W/A/S/D to ride, Q/E to hit, R to kick, and Left Shift for nitro. Player 2 uses the arrow keys, U/O to hit, H to kick, and N or Right Shift for nitro.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. To make a production build, run `npm run build`.

## Code at a glance

Built with TypeScript, Vite, Canvas 2D, and Web Audio. The race simulation is separate from drawing and menus, so gameplay can be tuned without changing the renderer.

- `src/race/` — bike physics, combat, rival AI, tracks, and rendering
- `src/scenes/` — title, menus, shop, race, and results
- `src/data/` — bikes, riders, tracks, and career settings
- `src/engine/` — game loop, input, assets, and audio
- `public/assets/` — game art and sound
- `docs/` — Blacktop Brawl website, published with GitHub Pages

## Safety and credits

Blacktop Brawl is an independent hobby game and is not affiliated with or endorsed by Electronic Arts. Code is MIT licensed; see [LICENSE](LICENSE) and [third-party asset credits](THIRD_PARTY_NOTICES.md).
## Support

If you enjoy the game, you can [support its development](https://buymeacoffee.com/sanketshinde).
