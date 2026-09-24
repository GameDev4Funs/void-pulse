# VOID PULSE

**Break through the swarm. Reclaim the reactor. Survive to extraction.**

A neon sci-fi, top-down survival shooter. Pilot a drone across four hostile battlefields, collect shards, and build a loadout that turns a pulse gun into a swarm-piercing annihilation beam. Fly solo or form a squad of 2–4 players on your local network.

**[Play in your browser →](https://gamedev4funs.github.io/void-pulse/)** · [Play with friends](#play-with-friends) · [简体中文](README.md)

No installation or account needed for the solo browser version. LAN co-op requires a local server. **The game interface is currently in Chinese.**

![VOID PULSE gameplay: a drone facing the swarm at the energy station](assets/screenshots/gameplay.jpg)

## Build your way out

- **Survive, repair, extract.** Stay alive for at least 10 minutes and complete three reactor repairs to finish the mission. Keep your build and push into endless mode if you want to go further.
- **Find your combination.** Choose one of three upgrades each level. Mix fire, lightning, and void paths with five evolving weapons, from orbiting blades to chain lightning and homing missiles.
- **Fight for ground.** Push into the reactor ring to secure repairs, watch for environmental warnings, and save a dash or an overdrive blast for when the swarm closes in.
- **Share the fight, keep your build.** Co-op players share experience but pick their own upgrades. Stay near a downed teammate to speed up repairs. There is no friendly fire.

## Four battlefields

| Destination | What to expect |
| --- | --- |
| **Nexus · 能源母港** | Cover, mixed swarms, and periodic electrical discharges. A good first mission. |
| **Boreal · 霜环星** | Ice volleys and slowing cold fronts. Use your improved mobility to find a gap. |
| **Cinder · 熔核星** | Explosive enemies, heavy armor, and lava eruptions. Put the extra firepower to work. |
| **Verdant · 孢林星** | Splitting swarms, webs, and spore zones. Keep an escape route open. |

## First flight

Choose **能源母港 → 单机出击** to start solo. Weapons fire automatically, with auto-aim enabled by default. Move to collect green shards, choose your first upgrade, then follow the reactor guide.

| Action | Controls |
| --- | --- |
| Move | WASD / Arrow keys |
| Dash through enemies | Space / Shift |
| Overdrive blast / Annihilation protocol | Q / E, when charged |
| Toggle auto-aim / mouse aim | F |
| View your build and evolution recipes | B |
| Menu / pause in solo mode | Esc / P |

Touch devices have a virtual joystick and skill buttons. Settings (**设置**) include audio levels, low graphics, and reduced screen shake and flashes. The [pilot handbook](docs/PLAYER_GUIDE.md) has detailed rules and recipes in Chinese.

## Play with friends

For **2–4 player LAN co-op**, one player hosts on a computer with Python 3. Download and extract this repository, open its folder in a terminal, and run:

```bash
python3 scripts/server.py
```

On macOS, you can also double-click `start.command`. If npm is installed, `npm start` runs the same server.

1. Connect to the same local network. Everyone opens `http://<host-LAN-IP>:8123`; the host can also use `http://localhost:8123`.
2. The host selects **组队联机 → 创建房间** and shares the room name and password.
3. Teammates enter those details and select **加入房间**. The host picks a battlefield and starts the mission.

Combat continues while choosing co-op upgrades, so give your teammates some breathing room. The GitHub Pages demo has no multiplayer relay; use your host's local address for co-op.

## Feedback and development

Found a bug or have an idea? [Open an issue](https://github.com/GameDev4Funs/void-pulse/issues). For bugs, include your browser, device, solo or co-op mode, and steps to reproduce. Screenshots help too.

See [development and deployment](docs/DEVELOPMENT.md) (Chinese) to explore the implementation. Built with Three.js and released under the [MIT License](LICENSE). Third-party license: [Three.js](vendor/three/LICENSE).
