/**
 * Image asset manifest. Every image in the game is generated from an entry here.
 *
 *   id       -> output path (public/assets/images/<id>.png|jpg) and the key the game uses
 *   kind     -> 'sprite' (magenta chroma-keyed, transparent PNG) or 'picture' (opaque JPEG)
 *   base     -> id of another asset used as a reference image (edits keep characters consistent)
 *
 * Add an entry and run `npm run assets:images -- --only <id>` to create it.
 */

export interface ImageAsset {
  id: string;
  kind: 'sprite' | 'picture';
  model?: 'flash' | 'pro';
  prompt: string;
  aspect?: string;
  size?: '1K' | '2K';
  base?: string;
  /** sprite: fixed down-scale factor (rider frames share it so poses line up) */
  scale?: number;
  /** sprite: clamp the longest side */
  maxDim?: number;
  /** picture: output width */
  maxWidth?: number;
  /** picture: make horizontally seamless */
  tile?: boolean;
}

const STYLE = '16-bit Sega Genesis era arcade racing video game art, detailed pixel-art style with crisp dark outlines and rich shading, vibrant 1990s console colours.';
const KEY =
  'Isolated on a flat, solid, pure magenta (#FF00FF) background that fills the entire image. No shadow, no ground plane, no scenery, no text, no border, no watermark. The subject is fully in frame and centred with a small margin. Do not use any pink, magenta or purple colours on the subject itself.';
const REAR =
  'Viewed exactly from directly behind (rear view): the camera is behind the motorcycle, slightly above it, looking forward. The rear wheel is at the bottom centre of the image. The whole rider and motorcycle are visible, upright, not leaning.';

const sprite = (id: string, subject: string, extra: Partial<ImageAsset> = {}): ImageAsset => ({
  id,
  kind: 'sprite',
  model: 'flash',
  prompt: `${STYLE} ${subject} ${KEY}`,
  aspect: '1:1',
  maxDim: 512,
  ...extra,
});

const edit = (id: string, base: string, change: string, extra: Partial<ImageAsset> = {}): ImageAsset => ({
  id,
  kind: 'sprite',
  model: 'flash',
  base,
  prompt: `Edit this image. Keep the exact same character, outfit, colours, motorcycle, pixel-art style, rear camera angle, size and position in the frame; the motorcycle must not move, rotate or change size. ${change} Keep the flat solid pure magenta (#FF00FF) background everywhere else.`,
  aspect: '1:1',
  scale: 0.5,
  ...extra,
});

const reference = (id: string, base: string, subject: string, extra: Partial<ImageAsset> = {}): ImageAsset => ({
  id,
  kind: 'sprite',
  model: 'flash',
  base,
  prompt: `Use the character in this image as the reference: same outfit, colours, helmet and pixel-art style. ${subject} ${KEY}`,
  aspect: '1:1',
  scale: 0.5,
  ...extra,
});

// ---------------------------------------------------------------------------------------------
// Riders (rear view) - every design gets the same pose set so combat animations line up.
// ---------------------------------------------------------------------------------------------

export const RIDER_DESIGNS: Record<string, string> = {
  player:
    'A tough street racer wearing a black leather jacket, blue jeans, brown boots, black gloves and a glossy red full-face helmet, riding a blue and red sport motorcycle.',
  brawler:
    'A huge muscular biker wearing a sleeveless denim vest over a white t-shirt, bare tattooed arms, black gloves and a black open-face helmet with goggles, riding a heavy black and chrome motorcycle.',
  racer:
    'A motorcycle racer with a long blonde ponytail coming out of a teal full-face helmet, wearing a teal and white one-piece leather racing suit, riding a white and teal sport motorcycle.',
  punk:
    'A punk biker with a spiky green mohawk sticking out of a black half-helmet, wearing a black sleeveless t-shirt, silver chains, ripped black jeans and combat boots, riding an orange and black street motorcycle.',
  yellow:
    'A biker in yellow and black racing leathers with a yellow full-face helmet and black visor, riding a yellow and black sport motorcycle.',
  bomber:
    'A biker wearing a brown leather bomber jacket with a cream fur collar, khaki trousers and a white vintage helmet with aviator goggles, riding a dark green classic motorcycle.',
  rebel:
    'A biker wearing a red and white striped leather jacket, black leather trousers and a silver full-face helmet, riding a red and silver sport-touring motorcycle.',
  cop:
    'A highway patrol motorcycle police officer wearing a tan uniform shirt, dark brown trousers, tall black boots and a white police helmet, riding a white police motorcycle with red and blue emergency lights on the back.',
};

const POSES: Record<string, string> = {
  punchL: 'Change only the pose: the rider throws a hard punch with the LEFT arm fully extended straight out to the LEFT side of the image, fist clenched; the right hand stays on the handlebar.',
  punchR: 'Change only the pose: the rider throws a hard punch with the RIGHT arm fully extended straight out to the RIGHT side of the image, fist clenched; the left hand stays on the handlebar.',
  kickL: 'Change only the pose: the rider kicks out hard to the LEFT side of the image with the left leg extended straight out sideways; both hands stay on the handlebars.',
  kickR: 'Change only the pose: the rider kicks out hard to the RIGHT side of the image with the right leg extended straight out sideways; both hands stay on the handlebars.',
  clubL: 'Change only the pose: the rider swings a short thick wooden club with the LEFT arm extended out to the LEFT side of the image, mid-swing; the right hand stays on the handlebar.',
  clubR: 'Change only the pose: the rider swings a short thick wooden club with the RIGHT arm extended out to the RIGHT side of the image, mid-swing; the left hand stays on the handlebar.',
};

const riderAssets: ImageAsset[] = [];
for (const [design, desc] of Object.entries(RIDER_DESIGNS)) {
  const base = `riders/${design}/ride`;
  riderAssets.push(sprite(base, `${desc} ${REAR}`, { scale: 0.5, maxDim: undefined }));
  const poses = design === 'cop' ? ['punchL', 'punchR', 'clubL', 'clubR'] : Object.keys(POSES);
  for (const pose of poses) {
    let change = POSES[pose];
    if (design === 'cop') change = change.replace('short thick wooden club', 'black police nightstick');
    riderAssets.push(edit(`riders/${design}/${pose}`, base, change));
  }
  riderAssets.push(
    reference(
      `riders/${design}/tumble`,
      base,
      'Draw ONLY the rider, without the motorcycle: thrown through the air after a crash, body horizontal and tumbling, arms and legs flailing, seen from the side.',
    ),
    reference(
      `riders/${design}/bikeDown`,
      base,
      'Draw ONLY the motorcycle from this image, without the rider: crashed and lying flat on its side on the ground, seen from behind at a slight three-quarter angle, a little scuffed.',
    ),
  );
}
// Front views for the look-back camera and the mirrors (the player is never seen from the front).
for (const design of Object.keys(RIDER_DESIGNS)) {
  if (design === 'player') continue;
  riderAssets.push(
    reference(
      `riders/${design}/front`,
      `riders/${design}/ride`,
      'Draw the same rider on the same motorcycle seen from directly in FRONT: the bike rides straight toward the camera, front wheel at the bottom centre, round headlight glowing. The rider also FACES THE CAMERA: we see the front of the helmet and the face or visor, the chest and front of the outfit, both hands gripping the handlebars and the knees either side of the tank; we do not see the rider\'s back. Long hair, if any, streams out behind the helmet and is mostly hidden. Same size in the frame as the reference.',
    ),
  );
}
// The player also needs on-foot frames for running back to the bike after a crash.
riderAssets.push(
  reference('riders/player/down', 'riders/player/ride', 'Draw ONLY the rider, without the motorcycle: lying sprawled face-down flat on the ground after a crash, seen from behind at a low angle.'),
  reference('riders/player/runBack1', 'riders/player/ride', 'Draw ONLY the rider, without the motorcycle: standing and running away from the camera, seen from directly behind, mid-stride with the LEFT leg forward, arms pumping.'),
  edit('riders/player/runBack2', 'riders/player/runBack1', 'Change only the legs and arms: mid-stride with the RIGHT leg forward instead, arms pumping the opposite way.'),
  reference('riders/player/runFront1', 'riders/player/ride', 'Draw ONLY the rider, without the motorcycle: running toward the camera, seen from the front with the helmet visor facing the viewer, mid-stride with the LEFT leg forward, arms pumping.'),
  edit('riders/player/runFront2', 'riders/player/runFront1', 'Change only the legs and arms: mid-stride with the RIGHT leg forward instead, arms pumping the opposite way.'),
);

// ---------------------------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------------------------
const carRear = (id: string, what: string) => sprite(`cars/${id}`, `${what}, seen exactly from directly behind (rear view) at road level, symmetrical, no brand logos, no licence plate text.`, { maxDim: 512 });
const carFront = (id: string, what: string) => sprite(`cars/${id}`, `${what}, seen exactly from the front (front view) at road level, symmetrical, headlights on, no brand logos, no licence plate text.`, { maxDim: 512 });

const carAssets: ImageAsset[] = [
  carRear('sedanRear', 'A boxy 1980s red four-door sedan car'),
  carRear('pickupRear', 'A 1980s blue pickup truck'),
  carRear('sportsRear', 'A 1980s yellow two-door sports car'),
  carRear('vanRear', 'A 1980s white delivery van'),
  carRear('wagonRear', 'A 1980s station wagon with wood-panel sides, tan paint'),
  carRear('semiRear', 'A big grey semi-truck trailer with rear doors and mud flaps'),
  carFront('sedanFront', 'A boxy 1980s white four-door sedan car'),
  carFront('pickupFront', 'A 1980s brown pickup truck'),
  carFront('vanFront', 'A 1980s light blue passenger van'),
  carFront('sportsFront', 'A 1980s red two-door sports car with pop-up headlights'),
  carFront('semiFront', 'A big red semi-truck tractor (big rig) with a chrome grille and exhaust stacks'),
];

// ---------------------------------------------------------------------------------------------
// Roadside props
// ---------------------------------------------------------------------------------------------
const prop = (id: string, what: string, extra: Partial<ImageAsset> = {}) =>
  sprite(`props/${id}`, `${what}, seen from the front at road level, as a roadside object in a racing game.`, { maxDim: 640, ...extra });
const tall = { aspect: '9:16', maxDim: 900 } as const;
const wide = { aspect: '16:9', maxDim: 768 } as const;

const propAssets: ImageAsset[] = [
  // generic
  prop('pole', 'A tall wooden telephone pole with a crossbar and glass insulators', tall),
  prop('signCurve', 'A yellow diamond-shaped road warning sign with a bold black curved arrow bending to the LEFT, on a grey metal post'),
  prop('signSpeed', "A white rectangular road sign reading 'SPEED LIMIT 55' in black letters, on a grey metal post"),
  prop('billboard1', "A roadside billboard on wooden posts advertising \"JOE'S DINER - BEST PIE IN THE WEST\" with a slice of cherry pie, retro 1980s design", { ...wide, model: 'pro' }),
  prop('billboard2', 'A roadside billboard on wooden posts advertising "SUNSET MOTEL - VACANCY" with a palm tree and orange sun, retro 1980s design', { ...wide, model: 'pro' }),
  prop('billboard3', 'A roadside billboard on wooden posts advertising "THUNDER COLA" with a fizzing soda bottle and lightning bolt, retro 1980s design', { ...wide, model: 'pro' }),
  prop('billboard4', 'A roadside billboard on wooden posts advertising "RASH WEAR - LEATHER THAT LASTS" with a black leather jacket, retro 1980s design', { ...wide, model: 'pro' }),
  prop('mailbox', 'A rural metal mailbox on a wooden post'),
  prop('bush', 'A round leafy green shrub'),
  prop('rock', 'A grey granite boulder'),
  prop('flagmanUp', 'A race starter man in a sleeveless shirt, jeans and sunglasses, standing and holding a black-and-white checkered flag raised high above his head', { aspect: '3:4' }),
  edit('props/flagmanDown', 'props/flagmanUp', 'Change only the pose: the man swings the checkered flag down and out to his side, as if starting a race.', { scale: undefined, maxDim: 640 }),
  prop('crowd1', 'A small crowd of rowdy spectators (bikers in leather, rockers, fans) standing together and cheering with raised fists', wide),
  prop('crowd2', 'A small crowd of excited race fans standing together, waving and cheering, some holding cans and banners', wide),
  prop('bannerStart', "A wide race banner arch: two tall steel poles holding a long horizontal cloth banner with the word 'START' in huge bold white letters on red, with checkered edges", { aspect: '21:9', maxDim: 1400, model: 'pro' }),
  prop('bannerFinish', "A wide race banner arch: two tall steel poles holding a long horizontal cloth banner with the word 'FINISH' in huge bold black letters on a black-and-white checkered background", { aspect: '21:9', maxDim: 1400, model: 'pro' }),
  // Sierra Nevada
  prop('pine', 'A lush green pine tree', tall),
  prop('pineTall', 'A very tall narrow ponderosa pine tree', tall),
  prop('boulderSnow', 'A large granite boulder with patches of snow on top'),
  prop('cabin', 'A small rustic log cabin with a stone chimney', wide),
  prop('fenceWood', 'A section of rustic wooden split-rail fence', wide),
  prop('log', 'A fallen tree log', wide),
  prop('signSierra', "A brown wooden park sign on two posts reading 'SIERRA NEVADA' in carved yellow letters", { ...wide, model: 'pro' }),
  // Pacific Coast
  prop('palm', 'A tall slender palm tree', tall),
  prop('cypress', 'A windswept Monterey cypress tree with a flat top', { aspect: '4:3' }),
  prop('beachHouse', 'A colourful 1980s wooden beach house on stilts', { aspect: '4:3' }),
  prop('lighthouse', 'A white and red striped lighthouse', tall),
  prop('guardrail', 'A section of metal highway guardrail on short posts', wide),
  prop('coastalRock', 'A jagged dark coastal rock outcrop'),
  prop('surfShack', 'A small surf shop shack with surfboards leaning against it', wide),
  // Redwood Forest
  prop('redwood', 'An enormous redwood tree trunk, very tall, thick reddish-brown bark, a few branches at the top', tall),
  prop('redwood2', 'A giant sequoia tree with a massive reddish trunk and green canopy', tall),
  prop('fern', 'A lush green fern bush'),
  prop('stump', 'A huge old redwood tree stump'),
  prop('rangerStation', 'A small wooden forest ranger station with a flag pole', wide),
  prop('mossyRock', 'A mossy green boulder'),
  // Palm Desert
  prop('saguaro', 'A tall saguaro cactus with two arms', tall),
  prop('joshua', 'A spiky Joshua tree', { aspect: '3:4' }),
  prop('desertRock', 'A red sandstone rock formation'),
  prop('gasStation', "A small run-down 1980s desert gas station with one pump and a sign reading 'GAS'", { ...wide, model: 'pro' }),
  prop('skull', 'A bleached cow skull with horns lying on a small patch of sand'),
  prop('tumbleweed', 'A dry brown tumbleweed'),
  prop('barrelCactus', 'A round barrel cactus with yellow flowers'),
  // Grass Valley
  prop('oak', 'A big leafy green oak tree', { aspect: '3:4' }),
  prop('barn', 'A classic red wooden barn with white trim', wide),
  prop('farmhouse', 'A white two-storey farmhouse with a porch', wide),
  prop('cow', 'A black and white Holstein cow standing, side view'),
  prop('haybale', 'A round golden hay bale'),
  prop('windmill', 'A metal farm windmill on a tall lattice tower', tall),
  prop('silo', 'A tall grain silo with a domed roof', tall),
  prop('fenceWhite', 'A section of white wooden picket fence', wide),
];

// ---------------------------------------------------------------------------------------------
// Parallax backgrounds (made horizontally seamless)
// ---------------------------------------------------------------------------------------------
const bg = (id: string, scene: string): ImageAsset => ({
  id: `bg/${id}`,
  kind: 'picture',
  model: 'flash',
  aspect: '21:9',
  size: '2K',
  tile: true,
  maxWidth: 2400,
  prompt: `${STYLE} Wide panoramic side-scrolling background layer for a racing game: ${scene} The horizon is a perfectly straight horizontal line at exactly 80% of the image height; everything below that line is flat, plain ground colour. No road, no vehicles, no people, no text, no border.`,
});

const bgAssets: ImageAsset[] = [
  bg('sierra', 'a majestic range of snow-capped granite mountains under a bright blue sky with a few white clouds, dark pine forests on the lower slopes. The ground below the horizon is dark green.'),
  bg('pacific', 'the sparkling blue Pacific Ocean stretching to the horizon, distant rocky headlands and sea stacks, a bright sky with fluffy clouds and a few seagulls. The ground below the horizon is sandy beige.'),
  bg('redwood', 'a wall of towering redwood trees fading into morning mist with sunbeams, misty green hills behind. The ground below the horizon is dark forest green.'),
  bg('desert', 'a vast desert with red rock mesas and buttes, hazy distant mountains, a hot pale blue sky. The ground below the horizon is orange-tan sand.'),
  bg('grass', 'rolling green hills and patchwork farmland with distant blue mountains, big fluffy white clouds in a blue sky. The ground below the horizon is bright grass green.'),
];

// ---------------------------------------------------------------------------------------------
// Menu / story art
// ---------------------------------------------------------------------------------------------
const art = (id: string, scene: string, extra: Partial<ImageAsset> = {}): ImageAsset => ({
  id: `ui/${id}`,
  kind: 'picture',
  model: 'pro',
  aspect: '16:9',
  size: '2K',
  maxWidth: 1920,
  prompt: `Dramatic 1990s video game illustration, bold comic-book painting with 16-bit era flair: ${scene} No text, no logos, no watermark.`,
  ...extra,
});

const uiAssets: ImageAsset[] = [
  art('title', 'a gang of motorcycle racers battling at high speed on a winding California mountain highway at sunset. One biker punches another, one swings a wooden club, a police motorcycle chases them with lights flashing. Strong perspective, motion blur, dust. Leave the top third of the image as open dramatic orange sky (space for a logo).'),
  {
    id: 'ui/logo',
    kind: 'sprite',
    model: 'pro',
    aspect: '21:9',
    maxDim: 1400,
    prompt:
      "A 1990s video game title logo: the words 'BLACKTOP BRAWL' in huge chunky, distressed, scratched chrome-and-red metallic block letters with a thick black outline and a slight italic slant, gritty biker style. Only the two words BLACKTOP BRAWL, spelled exactly. Isolated on a flat, solid, pure magenta (#FF00FF) background filling the entire image. No other text, no shadow on the background.",
  },
  art('lounge', 'the interior of a grungy roadside biker bar at night: glowing neon signs without readable words, a pool table, motorcycle helmets and license plates on the walls, dim smoky light, empty stools.'),
  art('shop', 'the interior of a 1990s motorcycle dealership showroom: bright lights, chrome, posters without readable text, a spotlit empty display platform in the centre.'),
  art('map', 'an illustrated vintage road map of a fictional West Coast region, seen from above: a rugged coastline with blue ocean along the left edge, a dark redwood forest in the upper-left, snowy mountains in the upper-right, a green farmland valley in the centre, and a red rock desert in the lower-right, connected by winding roads. Parchment texture. No text or labels at all.'),
  art('busted', 'a stern highway patrol officer with mirrored sunglasses writing a ticket beside a pulled-over motorcycle racer on the roadside, red and blue police lights flashing.'),
  art('wrecked', 'a totally wrecked, smoking motorcycle lying on the side of a highway, bent frame and broken parts scattered, a tow truck arriving in the background.'),
  art('victory', 'a triumphant motorcycle racer in a black leather jacket raising a huge golden trophy on a podium, confetti falling, a crowd of bikers cheering, sunset.'),
  art('gameover', 'a dejected biker sitting on a curb at night in the rain next to an impounded motorcycle behind a chain-link fence, a single street light.'),
];

// ---------------------------------------------------------------------------------------------
// Portraits (pre-race banter, results)
// ---------------------------------------------------------------------------------------------
export const PORTRAITS: Record<string, string> = {
  mongo: 'a huge bald biker with a thick black beard, neck tattoos, a sleeveless denim vest and a menacing grin',
  tanya: 'a fierce female motorcycle racer with long blonde hair in a ponytail, teal racing leathers, a confident smirk',
  razor: 'a punk rocker with a spiky green mohawk, pierced ears and a studded leather jacket, sneering',
  tank: 'a massive muscular biker with a shaved head, broken nose and scarred face, black leather vest',
  dixie: 'a tough southern woman biker with curly red hair, a brown bomber jacket with fur collar and aviator goggles pushed up on her forehead',
  jet: 'a cocky young hotshot racer with slicked-back hair, yellow and black racing leathers and mirrored sunglasses',
  blaze: 'a biker with a wild flaming-red pompadour and a red and white striped leather jacket, grinning',
  grinder: 'a skinny wild-eyed biker with stringy long hair, a torn t-shirt and chains around his neck, crazy grin',
  krystal: 'a cool female racer with a short black bob haircut, white racing leathers and a stern expression',
  buzz: 'a biker with a blonde buzz cut, square jaw, military dog tags and a green army jacket',
  knuckles: 'a grizzled older biker with a long grey beard, bandana, round sunglasses and a patched leather vest',
  roxy: 'a rockabilly female biker with jet-black hair in a pompadour, bold red lips and a black leather jacket',
  deacon: 'a stern older biker with a grey handlebar moustache, a black cowboy hat and a black leather duster coat',
  snake: 'a sly biker with slicked black hair, a thin moustache, a snakeskin leather jacket and a gold chain',
  cop: 'a stern highway patrol officer with mirrored sunglasses, a tan uniform and white helmet, holding a ticket book',
  mechanic: 'a greasy tow-truck mechanic with a cap, oil-stained overalls and a wrench over his shoulder, shaking his head',
  salesman: 'a smooth-talking motorcycle salesman with slicked-back hair, gold chains, a loud tropical shirt and a big grin',
};

const portraitAssets: ImageAsset[] = Object.entries(PORTRAITS).map(([id, who]) => ({
  id: `portraits/${id}`,
  kind: 'picture',
  model: 'flash',
  aspect: '1:1',
  maxWidth: 512,
  prompt: `${STYLE} Character portrait for a video game dialogue screen: head and shoulders of ${who}, facing the viewer, dark smoky biker-bar background. No text.`,
}));

// ---------------------------------------------------------------------------------------------
// Bike shop (side views)
// ---------------------------------------------------------------------------------------------
export const BIKE_LOOKS: Record<string, string> = {
  straycat: 'a small beat-up 1980s 350cc standard motorcycle with faded red paint, rust spots and a round headlight',
  mongrel: 'a scruffy 1980s 450cc street motorcycle with mismatched parts and a grey primer tank',
  jackal: 'a 1980s 500cc naked street motorcycle with dark blue paint and chrome exhaust',
  kestrel: 'a 1990s 600cc sport motorcycle with a full white and red fairing',
  raptor: 'a 1990s 750cc sport motorcycle with a green and black fairing',
  banshee: 'a 1990s 750cc race-replica sport motorcycle with a black and orange fairing',
  inferno: 'a powerful 1990s 900cc superbike with a red fairing and yellow flame decals',
  tempest: 'a sleek 1990s 1000cc superbike with a silver and blue fairing',
  nightmare: 'an aggressive 1990s 1100cc hyperbike with a matte black fairing, gold accents and twin exhausts',
};

const bikeAssets: ImageAsset[] = Object.entries(BIKE_LOOKS).map(([id, what]) =>
  sprite(`bikes/${id}`, `Side view of ${what}, facing right, no rider, no brand logos, no text.`, { aspect: '4:3', maxDim: 720 }),
);
// Later additions, drawn by editing an existing bike so the style and framing match.
const bikeEdit = (id: string, base: string, what: string): ImageAsset => ({
  id,
  kind: 'sprite',
  model: 'flash',
  base,
  prompt: `Edit this image. Keep the same pixel-art style, the exact same side-on camera angle facing right, the same size and position in the frame, and the flat solid pure magenta (#FF00FF) background. Replace the motorcycle with ${what}. No rider, no brand logos, no text.`,
  aspect: '4:3',
  maxDim: 720,
});
// Brand clean-ups: the generated art picked up real-world marks; these edits paint them out.
bikeAssets.push(
  {
    id: 'bikes/nightmare-clean',
    kind: 'sprite',
    model: 'flash',
    base: 'bikes/nightmare',
    prompt: 'Edit this image. Remove the gold Japanese character decal from the side fairing and any logo or emblem from the fuel tank, painting those areas plain matte black with one thin gold pinstripe along the fairing. Keep everything else exactly the same: the motorcycle, its shape, colours, pixel-art style, camera angle, size and position, and the flat solid pure magenta (#FF00FF) background. No text, no logos.',
    aspect: '4:3',
    maxDim: 720,
  },
  {
    id: 'props/billboard3-clean',
    kind: 'sprite',
    model: 'flash',
    base: 'props/billboard3',
    prompt: 'Edit this image. Replace only the glass soda bottle on the right of the billboard with a plain red aluminium soda can that has a white lightning bolt on it. Keep everything else exactly the same: the THUNDER COLA lettering, the billboard, posts, colours, pixel-art style, size and position, and the flat solid pure magenta (#FF00FF) background.',
    aspect: '4:3',
    maxDim: 640,
  },
);
bikeAssets.push(
  bikeEdit('bikes/mudcat', 'bikes/kestrel', 'a 1990s 650cc dual-sport enduro motorcycle with knobby off-road tyres, a high front fender, long-travel suspension and white and orange plastic bodywork'),
  bikeEdit('bikes/vandal', 'bikes/jackal', 'a heavy 1990s 883cc V-twin cruiser motorcycle with a long low frame, wide pulled-back handlebars, a dark red teardrop tank, a chrome engine and fat tyres'),
  bikeEdit('bikes/apex', 'bikes/nightmare', 'a 1990s 1300cc turbocharged hyperbike with a long sleek purple and black fairing, teal accents, a huge rear tyre and a single-sided swingarm'),
);

export const IMAGE_ASSETS: ImageAsset[] = [
  ...riderAssets,
  ...carAssets,
  ...propAssets,
  ...bgAssets,
  ...uiAssets,
  ...portraitAssets,
  ...bikeAssets,
];
