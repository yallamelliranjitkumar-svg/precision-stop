# Precision Stop

A fast timing game for phones, tablets and laptops. A needle sweeps across a bar; stop it inside the green zone.

## How to play
- 5 chances per game. The green zone always moves, relative to the needle's speed: chance 1 slow (0.25×), chances 2–3 medium (0.375×), chances 4–5 fast (0.5×).
- **Win** (inside the zone): 50–100 points, more the closer you are to the center. 95+ is a PERFECT.
- **Near miss** (within 10 units of the zone): 10 points. Three in a row earns a sticker token.
- **Miss**: 0 points. Max score is 500. Your best score is saved in this browser.

## Controls
| Action | Touch / mouse | Keyboard |
|---|---|---|
| Start / stop | Tap the big button or the bar | Space or Enter |
| Restart | Restart icon | R |
| Sound on/off | Speaker icon | M |
| Menu | Menu icon | Esc |

## Run locally
Double-click `index.html`. No install or server needed. Fonts load from Google Fonts; offline it uses system fonts.

## Files
- `index.html`: screens and markup
- `style.css`: look and animations
- `script.js`: game logic. Settings are in `CFG` at the top (zone width, needle speed, chances, zone speed per chance, scoring).
- `favicon.svg`: browser tab icon
