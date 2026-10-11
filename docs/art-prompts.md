# 花火主题美术生成记录

本项目的网页美术由 Codex 内置 `imagegen` 模式生成，并以用户提供的花火封面图作为美术方向参考。生成结果的无损源文件保存在 `docs/art-sources/`，网页优化版本位于 `public/art/`。

## 桌面游戏桌

用途：宽屏大厅与牌局背景。

提示词要点：

> Premium nocturnal Japanese lakeside garden; obsidian-black lacquer and restrained antique-gold foil; five distant red, amber, green, blue and ivory fireworks; low lacquer game table with subtle gold inlay; broad dark, low-contrast central negative space for UI; no people, cards, racks, chips, interface, text, logo or watermark; cinematic high-detail digital painting in a wide 16:9 composition.

## 手机游戏桌

用途：窄屏大厅与牌局背景。

提示词要点：

> Tall 9:16 mobile composition matching the same nocturnal Japanese lacquer-and-gold art direction; five fireworks in the upper third, moonlit lake and mountains in the middle distance, lacquer game table in the lower third; calm central vertical space for cards and UI; ornaments kept near the outer edges; no people, cards, interface, text, logo or watermark.

## 漆金卡背

用途：自己的隐藏手牌、发牌与补牌动画。

提示词要点：

> Straight-on portrait 2:3 card back; deep obsidian and midnight-indigo lacquer, fine antique-gold double border, seigaiha waves, centered chrysanthemum-firework crest, restrained ember specks, subtle washi fibers and lacquer sheen; symmetrical and legible at thumbnail size; no perspective, scene, hands, text, numbers, logo, watermark or outer shadow.

网页版本经过 WebP 压缩：

- `public/art/hanabi-lobby.webp`
- `public/art/hanabi-table-desktop.webp`
- `public/art/hanabi-table-mobile.webp`
- `public/art/hanabi-card-back.webp`

## 五色烟花素材图集（第二轮）

生成模式：Codex 内置 `imagegen`。

最终提示词：

> A premium game-asset atlas with five isolated Japanese fireworks arranged in one perfectly even horizontal row, from left to right red, golden yellow, emerald green, sapphire blue, and warm ivory white. Each firework is a different stage of ignition and grandeur suitable for Hanabi progress levels, rendered as refined luminous particles with long sparkling trails and a subtle gold-lacquer Japanese aesthetic. Uniform near-black background color #050407 across the entire canvas, generous clean spacing, no overlap, no frames, no cards, no interface, no text, no numbers, no symbols, no logo, no watermark. Straight-on asset sheet, high contrast clean silhouettes, consistent scale and lighting, production-quality digital game art.

源文件：`docs/art-sources/hanabi-fireworks-atlas-v2.png`。

网页切片：`public/art/firework-{red,yellow,green,blue,white}-v2.webp`。

## 桌面道具素材图集（第二轮）

生成模式：Codex 内置 `imagegen`。

最终提示词：

> A premium 2 by 2 game-asset atlas on one uniform near-black background #050407. Top left: an antique-gold round clue token with a chrysanthemum firework engraving and subtle amber glow. Top right: a red lacquer mistake token with a cracked ember core and restrained danger glow. Bottom left: a small upright stack of ornate obsidian-and-gold Hanabi card backs, straight-on three-quarter product view. Bottom right: an empty low black lacquer discard tray with delicate gold wave and plum-blossom inlay, seen from slightly above. Japanese nocturnal lacquer aesthetic, realistic hand-crafted materials, isolated objects, generous clean separation, consistent studio lighting, no overlap, no interface, no text, no numbers, no symbols, no logo, no watermark, production-quality game UI assets.

源文件：`docs/art-sources/hanabi-props-atlas-v2.png`。

网页切片：`public/art/clue-token-v2.webp`、`mistake-token-v2.webp`、`deck-stack-v2.webp`、`discard-tray-v2.webp`。

## 五色卡面素材图集（第二轮）

生成模式：Codex 内置 `imagegen`。

最终提示词：

> A premium game-asset atlas of five portrait Hanabi card face artworks arranged in one perfectly even horizontal row, from left to right red, golden yellow, emerald green, sapphire blue, and warm ivory white. Every card is straight-on with identical 5:7 proportions, an ornate antique-gold double border, obsidian lacquer base, subtle Japanese seigaiha waves and washi texture, and one elegant color-specific firework blooming in the center. Keep the upper-left corner visually quiet for a separately overlaid rank. No printed numbers, no letters, no text, no logos, no watermark, no hands, no perspective tilt, no overlap. Uniform near-black #050407 outside the cards, generous clean spacing, consistent lighting and scale, highly polished production-ready digital board-game art.

源文件：`docs/art-sources/hanabi-card-faces-atlas-v2.png`。

网页切片：`public/art/card-face-{red,yellow,green,blue,white}-v2.webp`。
